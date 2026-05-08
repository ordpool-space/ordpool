import logger from '../logger';
import ordpoolOtsRepository from '../repositories/OrdpoolOtsRepository';

/**
 * In-memory set of every Bitcoin txid that's known to be an OpenTimestamps
 * calendar commit. Populated from `ordpool_stats_ots` on backend boot, kept
 * fresh by the poller after every successful insert.
 *
 * Per-tx labelling (the `addOtsFlag` pre-enrichment) does an O(1) `has()`
 * call against this set, never an SQL round-trip. Memory: ~16 MB worst case
 * (~225k txids × ~70 bytes per V8 string).
 *
 * Why a singleton: the OTS poller and every flag pre-enrichment call site
 * read/write the same set. There's no use case for multiple instances and
 * the boot-time bootstrap is idempotent.
 */
class OrdpoolOtsTxidSet {
  private readonly set = new Set<string>();
  private bootstrapped = false;

  /** Load every txid from the satellite table into memory. Idempotent. */
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

  add(txid: string): void {
    this.set.add(txid);
  }

  size(): number {
    return this.set.size;
  }

  isBootstrapped(): boolean {
    return this.bootstrapped;
  }

  /** Test-only: drop everything and reset bootstrap flag. */
  reset(): void {
    this.set.clear();
    this.bootstrapped = false;
  }
}

export default new OrdpoolOtsTxidSet();
