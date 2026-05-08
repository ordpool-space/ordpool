import DB from '../database';
import { setupOrdpoolTestDatabase, waitForDatabase } from './test-helpers';
import { ORDPOOL_STATS_COLUMNS } from '../repositories/OrdpoolBlocksRepository';

/**
 * Real-DB verification that the ordpool migration runs cleanly and produces
 * exactly the schema saveBlockOrdpoolStatsInDatabase expects.
 *
 * Catches: missing column, misspelled column name, wrong column type for
 * server-side casts, missing satellite tables, missing primary keys.
 */
describe('Ordpool Database Migration Integration Tests', () => {
  beforeAll(async () => {
    await waitForDatabase();
    await setupOrdpoolTestDatabase();
  }, 120000);

  test('ordpool_schema_version row records the latest version', async () => {
    const [rows]: any = await DB.query(
      `SELECT number FROM state WHERE name = 'ordpool_schema_version'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].number).toBeGreaterThanOrEqual(3);
  });

  test('ordpool_stats table exists with expected primary key', async () => {
    const [rows]: any = await DB.query(
      `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = 'mempool_test'
         AND TABLE_NAME = 'ordpool_stats'
         AND CONSTRAINT_NAME = 'PRIMARY'`
    );
    expect(rows.map((r: any) => r.COLUMN_NAME)).toEqual(['hash']);
  });

  test('every column in ORDPOOL_STATS_COLUMNS exists on ordpool_stats', async () => {
    const [rows]: any = await DB.query(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'mempool_test' AND TABLE_NAME = 'ordpool_stats'`
    );
    const present = new Set(rows.map((r: any) => r.COLUMN_NAME as string));

    const missing: string[] = [];
    for (const c of ORDPOOL_STATS_COLUMNS) {
      if (!present.has(c.col)) {
        missing.push(c.col);
      }
    }
    expect(missing).toEqual([]);
  });

  test('v3 dropped labitbu columns are gone', async () => {
    const [rows]: any = await DB.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'mempool_test' AND TABLE_NAME = 'ordpool_stats'
         AND COLUMN_NAME IN ('amounts_labitbu', 'fees_labitbus')`
    );
    expect(rows).toEqual([]);
  });

  test('v3 satellite tables exist with correct columns', async () => {
    const [atomicalOp]: any = await DB.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'mempool_test' AND TABLE_NAME = 'ordpool_stats_atomical_op'
       ORDER BY ORDINAL_POSITION`
    );
    expect(atomicalOp.map((r: any) => r.COLUMN_NAME)).toEqual([
      'id', 'hash', 'height', 'txid', 'operation', 'ticker',
    ]);

    const [counterparty]: any = await DB.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'mempool_test' AND TABLE_NAME = 'ordpool_stats_counterparty'
       ORDER BY ORDINAL_POSITION`
    );
    expect(counterparty.map((r: any) => r.COLUMN_NAME)).toEqual([
      'id', 'hash', 'height', 'txid', 'message_type', 'message_type_id',
    ]);

    const [skipped]: any = await DB.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'mempool_test' AND TABLE_NAME = 'ordpool_stats_skipped'
       ORDER BY ORDINAL_POSITION`
    );
    expect(skipped.map((r: any) => r.COLUMN_NAME)).toEqual([
      'height', 'hash', 'first_failed_at', 'last_failed_at', 'failure_count', 'last_error',
    ]);
  });

  test('cat21 fee-rate columns are nullable DOUBLE (per-block aggregate, null when no cats)', async () => {
    const [rows]: any = await DB.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'mempool_test' AND TABLE_NAME = 'ordpool_stats'
         AND COLUMN_NAME IN ('cat21_avg_fee_rate', 'cat21_min_fee_rate', 'cat21_max_fee_rate')`
    );
    expect(rows).toHaveLength(3);
    for (const r of rows as Array<{ COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string }>) {
      expect(r.DATA_TYPE).toBe('double');
      expect(r.IS_NULLABLE).toBe('YES');
    }
  });

  test('v6 ordpool_stats_ots table exists with correct columns', async () => {
    const [rows]: any = await DB.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = 'mempool_test' AND TABLE_NAME = 'ordpool_stats_ots'
        ORDER BY ORDINAL_POSITION`
    );
    expect(rows.map((r: any) => r.COLUMN_NAME)).toEqual([
      'txid', 'calendar', 'merkle_root',
      'first_seen_at', 'confirmed_at',
      'blockhash', 'blockheight', 'blocktime', 'fee', 'feerate',
    ]);
    const byCol: Record<string, any> = Object.fromEntries(rows.map((r: any) => [r.COLUMN_NAME, r]));
    // Required fields are NOT NULL.
    expect(byCol.txid.IS_NULLABLE).toBe('NO');
    expect(byCol.calendar.IS_NULLABLE).toBe('NO');
    expect(byCol.merkle_root.IS_NULLABLE).toBe('NO');
    expect(byCol.first_seen_at.IS_NULLABLE).toBe('NO');
    // Confirmation-derived fields are NULL until the tx confirms.
    expect(byCol.confirmed_at.IS_NULLABLE).toBe('YES');
    expect(byCol.blockhash.IS_NULLABLE).toBe('YES');
    expect(byCol.blockheight.IS_NULLABLE).toBe('YES');
    // 32-byte raw payload, not hex.
    expect(byCol.merkle_root.DATA_TYPE).toBe('binary');
  });

  test('v6 ordpool_stats_ots primary key is txid', async () => {
    const [rows]: any = await DB.query(
      `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = 'mempool_test'
          AND TABLE_NAME = 'ordpool_stats_ots'
          AND CONSTRAINT_NAME = 'PRIMARY'`
    );
    expect(rows.map((r: any) => r.COLUMN_NAME)).toEqual(['txid']);
  });

  test('v6 ordpool_stats_ots indexes exist', async () => {
    const [rows]: any = await DB.query(
      `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = 'mempool_test' AND TABLE_NAME = 'ordpool_stats_ots'`
    );
    const names = rows.map((r: any) => r.INDEX_NAME).sort();
    expect(names).toEqual(['PRIMARY', 'idx_blockheight', 'idx_calendar_blockheight', 'idx_first_seen']);
  });

  test('migration is idempotent — re-running does not error', async () => {
    // setupOrdpoolTestDatabase already ran in beforeAll. Re-run; should
    // detect schema_version === currentVersion and short-circuit cleanly.
    await setupOrdpoolTestDatabase();
    const [rows]: any = await DB.query(
      `SELECT number FROM state WHERE name = 'ordpool_schema_version'`
    );
    expect(rows[0].number).toBeGreaterThanOrEqual(3);
  });
});
