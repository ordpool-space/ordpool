import DB from '../database';
import logger from '../logger';

export interface AlkaneMetadataRow {
  alkaneId: string;
  name: string | null;
  symbol: string | null;
  totalSupply: string | null;        // u128 as decimal string
  fetchedAt: Date;
  lastError: string | null;
  fetchAttempts: number;
}

class AlkaneMetadataRepository {

  async $getByAlkaneId(alkaneId: string): Promise<AlkaneMetadataRow | null> {
    try {
      const [rows] = await DB.query(
        `SELECT alkane_id, name, symbol, total_supply, fetched_at, last_error, fetch_attempts
         FROM alkane_metadata WHERE alkane_id = ?`,
        [alkaneId],
      ) as any;
      const r = rows[0];
      if (!r) {
        return null;
      }
      return {
        alkaneId: r.alkane_id,
        name: r.name ?? null,
        symbol: r.symbol ?? null,
        totalSupply: r.total_supply != null ? String(r.total_supply) : null,
        fetchedAt: r.fetched_at instanceof Date ? r.fetched_at : new Date(r.fetched_at),
        lastError: r.last_error ?? null,
        fetchAttempts: Number(r.fetch_attempts ?? 0),
      };
    } catch (e) {
      logger.err(`AlkaneMetadataRepository.$getByAlkaneId: ${e instanceof Error ? e.message : e}`);
      throw e;
    }
  }

  async $upsert(row: Omit<AlkaneMetadataRow, 'fetchedAt' | 'fetchAttempts'> & { fetchAttempts?: number }): Promise<void> {
    try {
      await DB.query(
        `INSERT INTO alkane_metadata
           (alkane_id, name, symbol, total_supply, fetched_at, last_error, fetch_attempts)
         VALUES (?, ?, ?, ?, NOW(), ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           symbol = VALUES(symbol),
           total_supply = VALUES(total_supply),
           fetched_at = VALUES(fetched_at),
           last_error = VALUES(last_error),
           fetch_attempts = VALUES(fetch_attempts)`,
        [
          row.alkaneId,
          row.name,
          row.symbol,
          row.totalSupply,
          row.lastError,
          row.fetchAttempts ?? (row.lastError ? 1 : 0),
        ],
      );
    } catch (e) {
      logger.err(`AlkaneMetadataRepository.$upsert: ${e instanceof Error ? e.message : e}`);
      throw e;
    }
  }
}

export default new AlkaneMetadataRepository();
