import logger from '../logger';
import ordpoolOtsRepository from '../repositories/OrdpoolOtsRepository';
import ordpoolOtsTxidSet from './ordpool-ots-txid-set';

/**
 * One known OTS calendar. URL hardcoded -- python-opentimestamps's
 * DEFAULT_CALENDAR_WHITELIST has been stable for ~10 years and the four
 * canonical operators are unchanged. Promote to mempool-config.json if
 * a fifth ever emerges.
 */
export interface OtsCalendar {
  name: string;       // 'alice' | 'bob' | 'finney' | 'catallaxy'
  url: string;        // base URL ending in '/'
  operator: string;   // for telemetry
}

export const KNOWN_CALENDARS: OtsCalendar[] = [
  { name: 'alice',     url: 'https://alice.btc.calendar.opentimestamps.org/',  operator: 'Peter Todd' },
  { name: 'bob',       url: 'https://bob.btc.calendar.opentimestamps.org/',    operator: 'Peter Todd' },
  { name: 'finney',    url: 'https://finney.calendar.eternitywall.com/',       operator: 'Eternity Wall' },
  { name: 'catallaxy', url: 'https://btc.calendar.catallaxy.com/',             operator: 'Bull Bitcoin' },
];

/**
 * Shape of a single entry in the calendar's `transactions[]` array. The
 * server filters server-side to confirmations > 0 so every entry here is
 * confirmed; mempool/pending data lives in `most_recent_tx` on the parent
 * response (see CalendarResponse below). See opentimestamps-server's
 * `otsserver/rpc.py:225-227` for the source-of-truth shape.
 */
export interface CalendarTransaction {
  txid: string;
  blockhash?: string;
  blockheight?: number;
  blocktime?: number;
  confirmations: number;
  fee: number;            // negative sats in the raw JSON; we normalise to positive on insert
  feerate?: string | number;
}

export interface CalendarResponse {
  version?: string;
  pending_commitments?: string;          // human-readable string with commas
  txs_waiting_for_confirmation?: number;
  most_recent_tx?: string;               // either a hex txid or 'None'
  tip?: string;                          // 64-char hex of current Merkle tip
  block_height?: number;
  transactions?: CalendarTransaction[];
}

/** Result of one poll cycle, useful for the test suite + future telemetry. */
export interface PollResult {
  calendar: string;
  ok: boolean;
  errorMessage?: string;
  newConfirmed: number;
  newPending: number;
  upgraded: number;
  totalSeen: number;
}

/** Default poll cadence. Sub-RBF-interval keeps every replaced txid catchable. */
const DEFAULT_INTERVAL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 12 * 1000;

class OrdpoolOtsPoller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private intervalMs = DEFAULT_INTERVAL_MS;
  private inFlight = false;          // de-overlap if a poll runs long
  private fetchImpl: typeof fetch = (...args) => fetch(...args);

  /** Test-only: swap in a deterministic fetch. */
  setFetch(impl: typeof fetch): void {
    this.fetchImpl = impl;
  }

  /** Start the periodic polling loop. Idempotent: calling twice is a no-op. */
  start(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    if (this.running) return;
    this.intervalMs = intervalMs;
    this.running = true;
    logger.info(`OTS poller starting; interval=${this.intervalMs}ms; calendars=${KNOWN_CALENDARS.length}`, 'Ordpool');
    // First poll immediately so we don't wait an interval on cold start.
    this.tick().catch(e => logger.err('OTS poll tick failed: ' + (e instanceof Error ? e.message : e), 'Ordpool'));
    this.timer = setInterval(() => {
      this.tick().catch(e => logger.err('OTS poll tick failed: ' + (e instanceof Error ? e.message : e), 'Ordpool'));
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  /** One poll across every calendar. Returns per-calendar stats. */
  async tick(): Promise<PollResult[]> {
    if (this.inFlight) return [];
    this.inFlight = true;
    try {
      const out: PollResult[] = [];
      for (const cal of KNOWN_CALENDARS) {
        out.push(await this.pollOne(cal));
      }
      return out;
    } finally {
      this.inFlight = false;
    }
  }

  private async pollOne(cal: OtsCalendar): Promise<PollResult> {
    let body: CalendarResponse;
    try {
      body = await this.fetchCalendarJson(cal.url);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(`OTS poll ${cal.name}: fetch failed -- ${message}`, 'Ordpool');
      return { calendar: cal.name, ok: false, errorMessage: message, newConfirmed: 0, newPending: 0, upgraded: 0, totalSeen: 0 };
    }

    // The calendar's tip is the canonical 32-byte merkle root we'll attach to
    // every newly-seen tx in this poll cycle. Pre-existing rows already have a
    // merkle_root from when they were first inserted.
    const tipHex = body.tip && body.tip !== 'None' ? body.tip : null;

    let newConfirmed = 0;
    let newPending = 0;
    let upgraded = 0;
    const txList = Array.isArray(body.transactions) ? body.transactions : [];

    // Confirmed-only batch (server filters confirmations > 0).
    for (const tx of txList) {
      if (!tx.txid) continue;
      const merkleRoot = tipHex ?? tx.txid; // fallback: use txid as a stable filler if tip absent (rare)
      const inSet = ordpoolOtsTxidSet.has(tx.txid);

      if (!inSet) {
        // Newly-seen tx that's already confirmed at the calendar.
        if (tx.blockheight !== undefined && tx.blockhash !== undefined && tx.blocktime !== undefined) {
          await ordpoolOtsRepository.upsertConfirmed({
            txid: tx.txid,
            calendar: cal.name,
            merkleRoot,
            blockhash: tx.blockhash,
            blockheight: tx.blockheight,
            blocktime: tx.blocktime,
            fee: Math.abs(typeof tx.fee === 'number' ? tx.fee : 0),  // normalise calendar-served negative fees
            feerate: typeof tx.feerate === 'string' ? tx.feerate : (tx.feerate !== undefined ? String(tx.feerate) : '0'),
          });
          ordpoolOtsTxidSet.add(tx.txid);
          newConfirmed++;
        }
      } else {
        // Already in our set. If the row is still pending in the DB but the
        // calendar now reports confirmation data, upgrade it.
        if (tx.blockheight !== undefined && tx.blockhash !== undefined && tx.blocktime !== undefined) {
          const existing = await ordpoolOtsRepository.getByTxid(tx.txid);
          if (existing && !existing.confirmedAt) {
            await ordpoolOtsRepository.upsertConfirmed({
              txid: tx.txid,
              calendar: cal.name,
              merkleRoot: existing.merkleRoot,
              blockhash: tx.blockhash,
              blockheight: tx.blockheight,
              blocktime: tx.blocktime,
              fee: Math.abs(typeof tx.fee === 'number' ? tx.fee : 0),
              feerate: typeof tx.feerate === 'string' ? tx.feerate : (tx.feerate !== undefined ? String(tx.feerate) : '0'),
            });
            upgraded++;
          }
        }
      }
    }

    // Mempool: the server only surfaces the LATEST unconfirmed via most_recent_tx
    // (older RBF-replaced versions count via prior_versions, no txids exposed).
    // Our short polling interval catches each version when it's the current most_recent_tx.
    const mr = body.most_recent_tx;
    if (mr && mr !== 'None' && !ordpoolOtsTxidSet.has(mr)) {
      const merkleRoot = tipHex ?? mr;
      await ordpoolOtsRepository.upsertPending({ txid: mr, calendar: cal.name, merkleRoot });
      ordpoolOtsTxidSet.add(mr);
      newPending++;
    }

    return { calendar: cal.name, ok: true, newConfirmed, newPending, upgraded, totalSeen: txList.length };
  }

  private async fetchCalendarJson(url: string): Promise<CalendarResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json() as CalendarResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}

export default new OrdpoolOtsPoller();
