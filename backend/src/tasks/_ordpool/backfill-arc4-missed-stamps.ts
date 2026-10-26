/**
 * ONE-OFF BACKFILL RUNNER for the ARC4 missed-stamp fix -- PREPARED, NOT RUN.
 *
 * MUTATES PRODUCTION DATA. Execute ONLY with the maintainer's explicit go, and
 * only against the affected heights/days emitted by detect-arc4-missed-stamps.ts.
 * Guarded behind EXECUTE=1 so an accidental run is a no-op.
 *
 * It uses existing machinery only; it adds no indexing logic:
 *   1. DELETE the affected blocks' ordpool_stats rows (and clear any poison in
 *      ordpool_stats_skipped), so the running missing-stats loop re-indexes them
 *      with the fixed parser -- a full per-block recompute, which fixes an
 *      additive MISS and a garbled rewrite identically.
 *   2. WAIT until those heights are re-indexed (poll; do not double-drive the
 *      live indexer).
 *   3. Refresh the daily rollups for the affected DAYS.
 *
 * CRITICAL scoping rule: the rollup refresh is bounded by DAY, never by the
 * affected heights. The daily + satellite rollups GROUP BY DATE(blockTimestamp)
 * over `blocks`, so a day's row must be recomputed from ALL of that day's blocks;
 * bounding by the affected heights alone would sum only those and undercount the
 * day. Week/month/year need no refresh -- they are read-time GROUP BYs over the
 * (now-corrected) daily rows, not stored tiers.
 *
 *   EXECUTE=1 INPUT=/path/to/detection-output.json \
 *     node dist/tasks/_ordpool/backfill-arc4-missed-stamps.js
 * where INPUT is { heights: number[], days: string[] } from the detection pass.
 */
import { getFirstInscriptionHeight } from 'ordpool-parser';

import ordpoolMissingStats from '../../api/ordpool-missing-stats';
import { buildUpsertQuery, buildSatelliteUpsert, SATELLITE_ROLLUPS } from '../../api/explorer/_ordpool/ordpool-stats-daily';
import config from '../../config';
import DB from '../../database';
import logger from '../../logger';

/** `?,?,...` placeholders so heights/days are bound, never interpolated. */
function placeholders(n: number): string {
  return new Array(n).fill('?').join(',');
}

/** Count how many of the given heights still have no ordpool_stats row. */
async function stillMissing(heights: number[]): Promise<number> {
  const [rows] = await DB.query(
    `SELECT COUNT(*) AS n FROM blocks b
       WHERE b.height IN (${placeholders(heights.length)})
         AND NOT EXISTS (SELECT 1 FROM ordpool_stats s WHERE s.hash = b.hash)`,
    heights,
  ) as [Array<{ n: number }>, unknown];
  return rows[0]?.n ?? 0;
}

export async function backfill(heights: number[], days: string[]): Promise<void> {
  if (!heights.length) { logger.info('backfill-arc4: nothing to do (no heights)', 'Ordpool'); return; }
  const first = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);

  // 1. Drop the stale rows so the missing-stats loop re-indexes them fresh.
  await DB.query(`DELETE FROM ordpool_stats WHERE hash IN (
      SELECT hash FROM blocks WHERE height IN (${placeholders(heights.length)}))`, heights);
  await DB.query(`DELETE FROM ordpool_stats_skipped WHERE height IN (${placeholders(heights.length)})`, heights);
  logger.info(`backfill-arc4: dropped ordpool_stats for ${heights.length} heights; waiting for re-index`, 'Ordpool');

  // 2. Let the LIVE indexer re-index them (they are now the missing set). Poll
  //    rather than calling processMissingStats here, so we never run two indexer
  //    passes at once (it self-guards with isTaskRunning and would no-op anyway).
  for (let waited = 0; ; waited += 15) {
    const missing = await stillMissing(heights);
    if (missing === 0) { break; }
    logger.info(`backfill-arc4: ${missing}/${heights.length} heights still re-indexing (${waited}s)`, 'Ordpool');
    await new Promise((r) => setTimeout(r, 15_000));
  }
  logger.info('backfill-arc4: all heights re-indexed', 'Ordpool');

  // 3. Refresh the daily rollups for the affected DAYS (each day recomputed from
  //    ALL its blocks, not just the affected ones -- see the scoping rule above).
  const dayList = days.map((d) => `'${d}'`).join(',');           // days are YYYY-MM-DD, validated by the detection pass
  const dayBound = `\n        AND DATE(b.blockTimestamp) IN (${dayList})`;
  await DB.query({ sql: buildUpsertQuery(first, dayBound), timeout: 600_000 });
  for (const cfg of SATELLITE_ROLLUPS) {
    await DB.query({ sql: buildSatelliteUpsert(cfg, first, dayBound), timeout: 600_000 });
  }
  logger.info(`backfill-arc4: refreshed daily + ${SATELLITE_ROLLUPS.length} satellite rollups over ${days.length} days. DONE.`, 'Ordpool');
}

if (require.main === module) {
  if (process.env.EXECUTE !== '1') {
    // eslint-disable-next-line no-console
    console.error('refusing to run without EXECUTE=1 (this MUTATES production data; needs the maintainer go)');
    process.exit(1);
  }
  const input = process.env.INPUT;
  if (!input) { console.error('INPUT=/path/to/detection-output.json required'); process.exit(1); }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { heights, days } = require(input) as { heights: number[]; days: string[] };
  backfill(heights, days)
    .then(() => process.exit(0))
    .catch((e) => { logger.err(`backfill-arc4 failed: ${e instanceof Error ? e.message : e}`, 'Ordpool'); process.exit(1); });
}
