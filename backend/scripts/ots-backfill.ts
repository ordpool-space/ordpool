#!/usr/bin/env -S node --experimental-strip-types
/**
 * One-shot OTS backfill runner. Reads ESPLORA.REST_API_URL from
 * mempool-config.json, walks each calendar's wallet chain backward
 * via electrs, and records every commit in ordpool_stats_ots. Idempotent
 * -- safe to interrupt and re-run.
 *
 * Usage:
 *   cd backend
 *   ./node_modules/.bin/ts-node scripts/ots-backfill.ts
 *
 * Or via npm script (added to backend/package.json):
 *   npm run ots-backfill
 */

import { OrdpoolOtsBackfill } from '../src/api/ordpool-ots-backfill';
import ordpoolOtsTxidSet from '../src/api/ordpool-ots-txid-set';
import DB from '../src/database';
import logger from '../src/logger';

(async () => {
  try {
    await DB.checkDbConnection();
    await ordpoolOtsTxidSet.bootstrap();

    const backfill = new OrdpoolOtsBackfill();
    const results = await backfill.run();

    let totalRecorded = 0;
    for (const r of results) {
      totalRecorded += r.txsRecorded;
      console.log(`${r.calendar.padEnd(10)}  walked=${String(r.txsWalked).padStart(7)}  recorded=${String(r.txsRecorded).padStart(7)}  stopped=${r.stoppedReason}`);
    }
    console.log(`\nTotal new rows: ${totalRecorded}`);
    process.exit(0);
  } catch (e) {
    logger.err('OTS backfill failed: ' + (e instanceof Error ? e.message : e), 'Ordpool');
    console.error(e);
    process.exit(1);
  }
})();
