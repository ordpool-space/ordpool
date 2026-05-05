import DB from '../database';
import logger from '../logger';

class OrdpoolSkippedBlocksRepository {

  async upsertSkippedBlock(height: number, hash: string, lastError: string): Promise<void> {
    try {
      await DB.query(
        `INSERT INTO ordpool_stats_skipped (height, hash, failure_count, last_error)
         VALUES (?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           hash = VALUES(hash),
           failure_count = failure_count + 1,
           last_error = VALUES(last_error)`,
        [height, hash, lastError]
      );
    } catch (e) {
      logger.err('Cannot upsert ordpool_stats_skipped row. Reason: ' + (e instanceof Error ? e.message : e), 'Ordpool');
      throw e;
    }
  }

  async getSkippedCount(): Promise<number> {
    const [rows] = await DB.query(`SELECT COUNT(*) AS c FROM ordpool_stats_skipped`) as any;
    return rows[0]?.c ?? 0;
  }
}

export default new OrdpoolSkippedBlocksRepository();
