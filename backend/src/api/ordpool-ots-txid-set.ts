import logger from '../logger';
import ordpoolOtsRepository from '../repositories/OrdpoolOtsRepository';

/**
 * In-memory set of every Bitcoin txid that's known to be an OpenTimestamps
 * calendar commit. Populated from `ordpool_stats_ots` on backend boot, kept
 * fresh by the poller after every successful insert.
 *
 * Per-tx labelling (`getOtsFlag(txid)` in `Common.getTransactionFlags`) does
 * an O(1) `has()` call against this set, never an SQL round-trip. Memory:
 * ~16 MB worst case (~225k txids × ~70 bytes per V8 string).
 *
 * The set is also observable: a callback registered via `subscribe(cb)`
 * fires whenever a NEW txid is added. The websocket-handler uses this to
 * push `otsCommitFlipped` to clients tracking the txid the moment the
 * poller learns about a calendar batch.
 *
 * Why a singleton: the OTS poller and every flag pre-enrichment call site
 * read/write the same set. There's no use case for multiple instances and
 * the boot-time bootstrap is idempotent.
 */
class OrdpoolOtsTxidSet {
  private readonly set = new Set<string>();
  private bootstrapped = false;
  private subscribers = new Set<(txid: string) => void>();

  /** Load every txid from the satellite table into memory. Idempotent.
   *
   *  Bootstrap uses the underlying native `Set.add` directly, NOT the
   *  public `add()` method, so the initial hydrate does not notify
   *  subscribers. (There are no subscribers at boot time anyway; this
   *  is defensive in case a future caller registers earlier.) */
  async bootstrap(): Promise<void> {
    if (this.bootstrapped) return;
    try {
      const txids = await ordpoolOtsRepository.getAllTxids();
      for (const t of txids) this.set.add(t);
      this.bootstrapped = true;
      logger.info(`OTS txid set bootstrapped with ${txids.length} entries`, 'Ordpool');
    } catch (e) {
      logger.err('Failed to bootstrap OTS txid set: ' + (e instanceof Error ? e.message : e), 'Ordpool');
      throw e;
    }
  }

  has(txid: string): boolean {
    return this.set.has(txid);
  }

  /** Insert a txid. Returns `true` if this was a NEW addition (and fires
   *  subscribers), `false` if the txid was already present. Subscribers
   *  receive the txid synchronously via callback. */
  add(txid: string): boolean {
    if (this.set.has(txid)) return false;
    this.set.add(txid);
    for (const cb of this.subscribers) {
      try {
        cb(txid);
      } catch (e) {
        logger.err('OTS txid-set subscriber threw: ' + (e instanceof Error ? e.message : e), 'Ordpool');
      }
    }
    return true;
  }

  size(): number {
    return this.set.size;
  }

  isBootstrapped(): boolean {
    return this.bootstrapped;
  }

  /** Register a listener called once per new txid addition. Returns an
   *  unsubscribe function. Subscriber exceptions are caught and logged
   *  so one bad listener can't poison the others. */
  subscribe(cb: (txid: string) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  /** Test-only: drop everything and reset bootstrap flag (subscribers too). */
  reset(): void {
    this.set.clear();
    this.bootstrapped = false;
    this.subscribers.clear();
  }
}

export default new OrdpoolOtsTxidSet();
