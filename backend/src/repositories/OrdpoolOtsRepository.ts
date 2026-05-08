import DB from '../database';
import logger from '../logger';

/**
 * Row shape stored in ordpool_stats_ots. `txid` and `blockhash` are lower-case
 * hex strings (BIN-collated CHAR(64)). `merkleRoot` is the 32-byte OP_RETURN
 * payload, surfaced as a 64-char lower-case hex string for symmetry with the
 * other hash fields. `fee` is in sats (positive); the calendar JSON serves it
 * negatively, the poller normalises before insert.
 */
export interface OrdpoolOtsRow {
  txid: string;
  calendar: string;
  merkleRoot: string;
  firstSeenAt: Date;
  confirmedAt: Date | null;
  blockhash: string | null;
  blockheight: number | null;
  blocktime: number | null;
  fee: number | null;
  feerate: string | null;
}

export interface OrdpoolOtsConfirmFields {
  blockhash: string;
  blockheight: number;
  blocktime: number;
  fee: number;
  feerate: string;
}

export interface OrdpoolOtsCalendarStats {
  calendar: string;
  totalCommits: number;
  lastBlockheight: number | null;
  lastBlocktime: number | null;
  pendingCount: number;
}

function toHex(buf: Buffer | null | undefined): string | null {
  if (!buf) return null;
  return buf.toString('hex');
}

function rowToOrdpoolOts(r: any): OrdpoolOtsRow {
  return {
    txid:        r.txid,
    calendar:    r.calendar,
    merkleRoot:  toHex(r.merkle_root) ?? '',
    firstSeenAt: r.first_seen_at,
    confirmedAt: r.confirmed_at,
    blockhash:   r.blockhash,
    blockheight: r.blockheight,
    blocktime:   r.blocktime,
    fee:         r.fee,
    feerate:     r.feerate,
  };
}

class OrdpoolOtsRepository {

  /**
   * Insert a newly-observed pending OTS commit. Idempotent: re-inserting an
   * existing row is a no-op (we don't downgrade a confirmed row to pending).
   */
  async upsertPending(input: {
    txid: string;
    calendar: string;
    merkleRoot: string;
  }): Promise<void> {
    try {
      await DB.query(
        `INSERT INTO ordpool_stats_ots (txid, calendar, merkle_root)
         VALUES (?, ?, UNHEX(?))
         ON DUPLICATE KEY UPDATE txid = txid`,
        [input.txid, input.calendar, input.merkleRoot]
      );
    } catch (e) {
      logger.err('Cannot upsert pending ordpool_stats_ots row. Reason: ' + (e instanceof Error ? e.message : e), 'Ordpool');
      throw e;
    }
  }

  /**
   * Insert a confirmed OTS commit, or upgrade an existing pending row.
   * Idempotent: re-confirming preserves the original `first_seen_at` and
   * `confirmed_at`; only the chain-derived fields refresh.
   */
  async upsertConfirmed(input: {
    txid: string;
    calendar: string;
    merkleRoot: string;
    blockhash: string;
    blockheight: number;
    blocktime: number;
    fee: number;
    feerate: string;
  }): Promise<void> {
    try {
      await DB.query(
        `INSERT INTO ordpool_stats_ots
           (txid, calendar, merkle_root, confirmed_at, blockhash, blockheight, blocktime, fee, feerate)
         VALUES (?, ?, UNHEX(?), NOW(), ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           confirmed_at = COALESCE(confirmed_at, NOW()),
           blockhash = VALUES(blockhash),
           blockheight = VALUES(blockheight),
           blocktime = VALUES(blocktime),
           fee = VALUES(fee),
           feerate = VALUES(feerate)`,
        [
          input.txid, input.calendar, input.merkleRoot,
          input.blockhash, input.blockheight, input.blocktime, input.fee, input.feerate,
        ]
      );
    } catch (e) {
      logger.err('Cannot upsert confirmed ordpool_stats_ots row. Reason: ' + (e instanceof Error ? e.message : e), 'Ordpool');
      throw e;
    }
  }

  async getByTxid(txid: string): Promise<OrdpoolOtsRow | null> {
    const [rows] = await DB.query(
      `SELECT txid, calendar, merkle_root, first_seen_at, confirmed_at,
              blockhash, blockheight, blocktime, fee, feerate
         FROM ordpool_stats_ots WHERE txid = ?`,
      [txid]
    ) as any;
    if (!rows || rows.length === 0) return null;
    return rowToOrdpoolOts(rows[0]);
  }

  /**
   * Bulk read every txid in the table. Used to populate the in-memory set on
   * backend boot; never serves user-facing requests.
   */
  async getAllTxids(): Promise<string[]> {
    const [rows] = await DB.query(`SELECT txid FROM ordpool_stats_ots`) as any;
    return rows.map((r: any) => r.txid);
  }

  /** Per-calendar summary for the /ots/calendars dashboard. */
  async getCalendarStats(): Promise<OrdpoolOtsCalendarStats[]> {
    const [rows] = await DB.query(
      `SELECT
         calendar,
         COUNT(*) AS total_commits,
         MAX(blockheight) AS last_blockheight,
         MAX(blocktime)   AS last_blocktime,
         SUM(CASE WHEN confirmed_at IS NULL THEN 1 ELSE 0 END) AS pending_count
       FROM ordpool_stats_ots
       GROUP BY calendar
       ORDER BY total_commits DESC`
    ) as any;
    return rows.map((r: any) => ({
      calendar:        r.calendar,
      totalCommits:    Number(r.total_commits),
      lastBlockheight: r.last_blockheight === null ? null : Number(r.last_blockheight),
      lastBlocktime:   r.last_blocktime === null ? null : Number(r.last_blocktime),
      pendingCount:    Number(r.pending_count),
    }));
  }

  /** Most-recent confirmed commits across all calendars. */
  async getRecent(limit = 50): Promise<OrdpoolOtsRow[]> {
    const [rows] = await DB.query(
      `SELECT txid, calendar, merkle_root, first_seen_at, confirmed_at,
              blockhash, blockheight, blocktime, fee, feerate
         FROM ordpool_stats_ots
         WHERE confirmed_at IS NOT NULL
         ORDER BY blockheight DESC, blocktime DESC
         LIMIT ?`,
      [limit]
    ) as any;
    return rows.map(rowToOrdpoolOts);
  }

  /** All commits in a given block. Used by block-page enrichment. */
  async getByBlockheight(blockheight: number): Promise<OrdpoolOtsRow[]> {
    const [rows] = await DB.query(
      `SELECT txid, calendar, merkle_root, first_seen_at, confirmed_at,
              blockhash, blockheight, blocktime, fee, feerate
         FROM ordpool_stats_ots WHERE blockheight = ?`,
      [blockheight]
    ) as any;
    return rows.map(rowToOrdpoolOts);
  }
}

export default new OrdpoolOtsRepository();
