import logger from '../logger';
import config from '../config';
import ordpoolOtsRepository from '../repositories/OrdpoolOtsRepository';
import ordpoolOtsTxidSet from './ordpool-ots-txid-set';
import { KNOWN_CALENDARS } from './ordpool-ots-poller';
import { OTS_OUTBOUND_USER_AGENT } from './ordpool-ots-user-agent';

/**
 * One-shot wallet-graph walker. Backfills historical OTS calendar commits
 * by walking each calendar's wallet chain backward from a known recent
 * commit (seeded from the calendar's own /tx_history JSON or any anchor
 * txid), via electrs's /tx/:txid endpoint.
 *
 * Each calendar tx has shape:
 *   - 1 input (the previous calendar tx's change output — by induction
 *     itself a calendar tx)
 *   - 2 outputs:
 *     - vout[0]: P2WPKH change → next calendar address
 *     - vout[1]: OP_RETURN OP_PUSHBYTES_32 <32 bytes> (the Merkle root)
 *
 * Termination: the walk stops when (a) the previous tx no longer has the
 * calendar shape (we've reached the wallet's pre-calendar funding tx), or
 * (b) the txid is already in our set (idempotent re-runs short-circuit).
 *
 * Forward polling (OrdpoolOtsPoller) handles steady state from deploy
 * time onward; this module fills in the historical past once. ~225k tx
 * walks per full backfill, ~50ms per electrs round-trip = a few hours
 * wall-clock per calendar. Idempotent: rerun anytime.
 */

/** Minimum shape we read from electrs's /tx/:txid response. */
export interface ElectrsTxLite {
  txid: string;
  vin: Array<{ txid: string; prevout?: { scriptpubkey?: string; scriptpubkey_address?: string } }>;
  vout: Array<{ value: number; scriptpubkey: string; scriptpubkey_type?: string; scriptpubkey_address?: string }>;
  status?: { confirmed?: boolean; block_height?: number; block_hash?: string; block_time?: number };
  fee?: number;
  weight?: number;
}

/** Hex of `OP_RETURN (0x6a) OP_PUSHBYTES_32 (0x20)`, i.e. the canonical OTS scriptPubKey prefix. */
const OTS_OP_RETURN_PREFIX = '6a20';

/**
 * Decide whether `tx` looks like a calendar commit. Cheap structural test
 * matching opentimestamps-server stamper.py output (1 input, 2 outputs,
 * vout[1] is the canonical OP_RETURN+32-byte payload). False negatives are
 * acceptable (we just stop walking) -- false positives are not, so the
 * test is conservative.
 */
export function looksLikeCalendarCommit(tx: ElectrsTxLite): boolean {
  if (tx.vin.length !== 1) return false;
  if (tx.vout.length !== 2) return false;
  const opReturn = tx.vout[1];
  if (opReturn.value !== 0) return false;
  if (!opReturn.scriptpubkey) return false;
  // exactly 0x6a 0x20 + 32 bytes (64 hex chars) = 68 hex chars total
  if (opReturn.scriptpubkey.length !== 68) return false;
  if (!opReturn.scriptpubkey.startsWith(OTS_OP_RETURN_PREFIX)) return false;
  return true;
}

/** Extract the 32-byte Merkle root from a calendar-commit tx's OP_RETURN. */
export function extractMerkleRoot(tx: ElectrsTxLite): string {
  return tx.vout[1].scriptpubkey.slice(4);  // strip the '6a20' prefix
}

export interface BackfillStats {
  calendar: string;
  txsWalked: number;
  txsRecorded: number;
  stoppedReason: 'genesis' | 'already-seen' | 'fetch-error' | 'shape-mismatch' | 'limit';
}

/**
 * Module-level wrapper so unit tests can inject a deterministic fetch
 * implementation. Not exported as a singleton so tests can construct fresh
 * instances per test.
 */
export class OrdpoolOtsBackfill {

  private fetchImpl: typeof fetch = (...args) => fetch(...args);
  private esploraBase: string;

  constructor(esploraBase: string = config.ESPLORA.REST_API_URL) {
    this.esploraBase = esploraBase.replace(/\/$/, '');
  }

  setFetch(impl: typeof fetch): void {
    this.fetchImpl = impl;
  }

  /** Fetch the most-recent confirmed calendar tx from the calendar's own JSON. */
  async getSeedTxid(calendarUrl: string): Promise<string | null> {
    const res = await this.fetchImpl(calendarUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': OTS_OUTBOUND_USER_AGENT,
      },
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    const txs: Array<{ txid?: string; confirmations?: number }> = Array.isArray(body.transactions) ? body.transactions : [];
    // The calendar's transactions[] is newest-first AND server-filtered to
    // confirmations > 0. The OLDEST entry (last in the array) gives us the
    // furthest-back seed we can reach without electrs.
    for (let i = txs.length - 1; i >= 0; i--) {
      if (txs[i].txid) return txs[i].txid!;
    }
    return null;
  }

  /** Fetch one tx from electrs in our minimal shape. */
  async fetchTx(txid: string): Promise<ElectrsTxLite | null> {
    try {
      const res = await this.fetchImpl(`${this.esploraBase}/tx/${txid}`);
      if (!res.ok) return null;
      return await res.json() as ElectrsTxLite;
    } catch {
      return null;
    }
  }

  /** Walk backward from a seed tx, recording every calendar commit in the chain. */
  async walkBackward(calendar: string, seedTxid: string, maxDepth = 100_000): Promise<BackfillStats> {
    const stats: BackfillStats = { calendar, txsWalked: 0, txsRecorded: 0, stoppedReason: 'limit' };

    let currentTxid: string | null = seedTxid;

    while (currentTxid && stats.txsWalked < maxDepth) {
      // Idempotent short-circuit: if we already have this one, the chain
      // beyond it is already backfilled (each step's predecessor is fixed).
      if (ordpoolOtsTxidSet.has(currentTxid)) {
        stats.stoppedReason = 'already-seen';
        break;
      }

      const tx: ElectrsTxLite | null = await this.fetchTx(currentTxid);
      if (!tx) {
        stats.stoppedReason = 'fetch-error';
        break;
      }
      stats.txsWalked++;

      if (!looksLikeCalendarCommit(tx)) {
        // We've reached the wallet's pre-calendar funding tx (or the chain
        // diverges into something we don't recognise). Stop, don't record.
        stats.stoppedReason = 'shape-mismatch';
        break;
      }

      const merkleRoot: string = extractMerkleRoot(tx);
      if (tx.status?.confirmed && tx.status?.block_hash && tx.status?.block_height !== undefined && tx.status?.block_time !== undefined) {
        const fee = tx.fee ?? 0;
        const feerate = tx.weight ? (fee / (tx.weight / 4)).toFixed(2) : '0';
        await ordpoolOtsRepository.upsertConfirmed({
          txid: tx.txid,
          calendar,
          merkleRoot,
          blockhash: tx.status.block_hash,
          blockheight: tx.status.block_height,
          blocktime: tx.status.block_time,
          fee,
          feerate,
        });
      } else {
        // Unconfirmed historical tx is impossible (we only walk backward from
        // confirmed seeds). Record as pending defensively.
        await ordpoolOtsRepository.upsertPending({ txid: tx.txid, calendar, merkleRoot });
      }
      ordpoolOtsTxidSet.add(tx.txid);
      stats.txsRecorded++;

      // Move backward to the previous calendar tx (vin[0] is its change UTXO).
      currentTxid = tx.vin[0]?.txid ?? null;
      if (!currentTxid) {
        stats.stoppedReason = 'genesis';
        break;
      }
    }

    return stats;
  }

  /** Backfill every known calendar. */
  async run(maxDepth = 100_000): Promise<BackfillStats[]> {
    if (!ordpoolOtsTxidSet.isBootstrapped()) {
      await ordpoolOtsTxidSet.bootstrap();
    }
    const out: BackfillStats[] = [];
    for (const cal of KNOWN_CALENDARS) {
      logger.info(`OTS backfill: starting ${cal.nickname} (${cal.url})`, 'Ordpool');
      const seed = await this.getSeedTxid(cal.url);
      if (!seed) {
        logger.warn(`OTS backfill: no seed txid for ${cal.nickname}; skipping`, 'Ordpool');
        out.push({ calendar: cal.nickname, txsWalked: 0, txsRecorded: 0, stoppedReason: 'fetch-error' });
        continue;
      }
      const stats = await this.walkBackward(cal.nickname, seed, maxDepth);
      logger.info(`OTS backfill: ${cal.nickname} walked=${stats.txsWalked} recorded=${stats.txsRecorded} stopped=${stats.stoppedReason}`, 'Ordpool');
      out.push(stats);
    }
    return out;
  }
}
