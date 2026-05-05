import { getEmptyStats, OrdpoolStats } from 'ordpool-parser';
import DB from '../database';
import OrdpoolBlocksRepository, {
  ORDPOOL_BLOCK_DB_FIELDS,
  ORDPOOL_STATS_COLUMNS,
  OrdpoolDatabaseBlock,
} from '../repositories/OrdpoolBlocksRepository';
import {
  cleanupOrdpoolStats,
  cleanupTestData,
  insertTestBlock,
  insertTestPool,
  setupOrdpoolTestDatabase,
  waitForDatabase,
} from './test-helpers';

/**
 * Real-DB round-trip for OrdpoolBlocksRepository.
 *
 * Builds a fully-populated OrdpoolStats with unique sentinel values per
 * column, calls saveBlockOrdpoolStatsInDatabase to write it via the
 * declarative ORDPOOL_STATS_COLUMNS spec, runs the same SELECT shape that
 * production uses, and pipes the row through formatDbBlockIntoOrdpoolStats.
 *
 * Asserts that every field round-trips exactly. Catches: column
 * misalignment, missing v3 columns, type mismatches, NULL coercion bugs.
 * The unit-level spec test (OrdpoolBlocksRepository.spec.test.ts) only
 * verifies the in-memory val/set symmetry — this one verifies the SQL
 * actually carries the values through MariaDB.
 */
describe('OrdpoolBlocksRepository — real-DB round-trip', () => {
  let defaultPoolId: number;
  const TEST_HASH = '00000000000000000000aaaa00000000000000000000000000000000ordpool00';
  const TEST_HEIGHT = 870_000;

  beforeAll(async () => {
    await waitForDatabase();
    await setupOrdpoolTestDatabase();
  }, 120000);

  beforeEach(async () => {
    await cleanupTestData();
    await cleanupOrdpoolStats();
    defaultPoolId = await insertTestPool({
      name: 'Unknown',
      slug: 'unknown',
    });
  });

  afterAll(async () => {
    await cleanupOrdpoolStats();
    await cleanupTestData();
  });

  /** Build a populated OrdpoolStats. Each column gets a unique sentinel
   *  value derived from its position in ORDPOOL_STATS_COLUMNS. The unit
   *  spec test already verifies val/set symmetry; here we use the spec's
   *  set() to plant values and the spec's val() to read them back, so any
   *  mid-pipeline drift (SQL serialization, MariaDB type coercion)
   *  surfaces as a per-field comparison failure. */
  function buildSentinelStats(): OrdpoolStats {
    const stats = getEmptyStats();
    ORDPOOL_STATS_COLUMNS.forEach((c, i) => {
      const sentinel: unknown = c.col.includes('_inscription_id') || c.col.includes('most_active')
        ? `sentinel-${i}`
        : i + 1;
      c.set(stats, sentinel);
    });
    return stats;
  }

  /** Re-create the production SELECT (BlocksRepository joins blocks +
   *  ordpool_stats + satellite tables). For this test we only care about
   *  the ordpool_stats columns, so we run the projection part of
   *  ORDPOOL_BLOCK_DB_FIELDS against blocks LEFT JOIN ordpool_stats. */
  async function readBack(): Promise<OrdpoolDatabaseBlock> {
    // Trim out the GROUP_CONCAT'd satellite projections — the upstream JOINs
    // they reference (rune_mint, brc20_mint, etc.) would need additional
    // setup, and they're not part of the column round-trip we're testing.
    const projection = ORDPOOL_STATS_COLUMNS
      .map(c => `ordpool_stats.${c.col} AS ${c.alias}`)
      .join(',\n  ');
    const [rows]: any = await DB.query(
      `SELECT blocks.hash AS id, blocks.height AS height, ${projection}
       FROM blocks
       LEFT JOIN ordpool_stats ON blocks.hash = ordpool_stats.hash
       WHERE blocks.height = ?`,
      [TEST_HEIGHT]
    );
    expect(rows).toHaveLength(1);
    // Satellite GROUP_CONCAT fields aren't covered here; format function
    // tolerates undefined/null compactor inputs.
    return rows[0] as OrdpoolDatabaseBlock;
  }

  test('fully-populated OrdpoolStats round-trips via INSERT/SELECT/format', async () => {
    await insertTestBlock({
      height: TEST_HEIGHT,
      hash: TEST_HASH,
      poolId: defaultPoolId,
    });

    const source = buildSentinelStats();
    await OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase({
      id: TEST_HASH,
      height: TEST_HEIGHT,
      extras: { ordpoolStats: source },
    });

    const dbBlk = await readBack();
    const formatted = OrdpoolBlocksRepository.formatDbBlockIntoOrdpoolStats(dbBlk);
    expect(formatted).toBeDefined();

    // Compare every spec column. For server-side LEFT(?, 20) columns the
    // sentinel is shorter than 20 chars so truncation is a no-op.
    for (const c of ORDPOOL_STATS_COLUMNS) {
      const expected = c.val(source);
      const actual = c.val(formatted!);
      expect(actual).toEqual(expected);
    }
  });

  test('formatDbBlockIntoOrdpoolStats returns undefined when analyser_version is 0', async () => {
    // Block exists, no ordpool_stats row written → LEFT JOIN gives NULLs,
    // the format function uses analyserVersion as the "indexed?" marker.
    await insertTestBlock({
      height: TEST_HEIGHT,
      hash: TEST_HASH,
      poolId: defaultPoolId,
    });

    const dbBlk = await readBack();
    expect(dbBlk.analyserVersion).toBeFalsy();
    expect(OrdpoolBlocksRepository.formatDbBlockIntoOrdpoolStats(dbBlk)).toBeUndefined();
  });

  test('LEFT(?, 20) truncates over-long mostActiveMint values server-side', async () => {
    await insertTestBlock({
      height: TEST_HEIGHT,
      hash: TEST_HASH,
      poolId: defaultPoolId,
    });

    const stats = getEmptyStats();
    // 30-char rune ID; should land in DB as the first 20 chars.
    stats.runes.mostActiveMint = '12345678901234567890OVERFLOW';
    stats.runes.mostActiveNonUncommonMint = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    stats.brc20.mostActiveMint = 'aaaaabbbbbcccccdddddTAIL';
    stats.src20.mostActiveMint = '0000000000111111111122222';
    stats.version = 1; // mark indexed

    await OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase({
      id: TEST_HASH,
      height: TEST_HEIGHT,
      extras: { ordpoolStats: stats },
    });

    const dbBlk = await readBack();
    expect(dbBlk.runesMostActiveMint).toBe('12345678901234567890');
    expect(dbBlk.runesMostActiveNonUncommonMint).toBe('ABCDEFGHIJKLMNOPQRST');
    expect(dbBlk.brc20MostActiveMint).toBe('aaaaabbbbbcccccddddd');
    expect(dbBlk.src20MostActiveMint).toBe('00000000001111111111');
  });

  test('NULL inscription IDs round-trip as null (not "null" string)', async () => {
    await insertTestBlock({
      height: TEST_HEIGHT,
      hash: TEST_HASH,
      poolId: defaultPoolId,
    });

    const stats = getEmptyStats();
    stats.version = 1;
    // largestEnvelopeInscriptionId on a block with no inscriptions is
    // structurally null. Verify it stays null through the round-trip.
    stats.inscriptions.largestEnvelopeInscriptionId = null;
    stats.inscriptions.image.largestContentInscriptionId = null;
    stats.cat21.avgFeeRate = null;
    stats.cat21.minFeeRate = null;
    stats.cat21.maxFeeRate = null;

    await OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase({
      id: TEST_HASH,
      height: TEST_HEIGHT,
      extras: { ordpoolStats: stats },
    });

    const dbBlk = await readBack();
    const formatted = OrdpoolBlocksRepository.formatDbBlockIntoOrdpoolStats(dbBlk)!;
    expect(formatted.inscriptions.largestEnvelopeInscriptionId).toBeNull();
    expect(formatted.inscriptions.image.largestContentInscriptionId).toBeNull();
    expect(formatted.cat21.avgFeeRate).toBeNull();
    expect(formatted.cat21.minFeeRate).toBeNull();
    expect(formatted.cat21.maxFeeRate).toBeNull();
  });

  test('ORDPOOL_BLOCK_DB_FIELDS exists (sanity — used by BlocksRepository production query)', () => {
    // Static check — the constant must be a non-empty string. Real
    // production-shape testing is out of scope here (would need pools +
    // satellite-table setup); BlocksRepository's own tests cover the JOIN.
    expect(typeof ORDPOOL_BLOCK_DB_FIELDS).toBe('string');
    expect(ORDPOOL_BLOCK_DB_FIELDS.length).toBeGreaterThan(100);
  });
});
