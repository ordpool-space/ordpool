/**
 * ONE-OFF DETECTION SKETCH -- read-only, writes NOTHING, wired into no task.
 *
 * Finds the blocks where the fixed parser (ordpool-parser >= 3488f70) decodes a
 * STAMP / SRC-721 / SRC-101 that the pre-fix parser (315f0a3) missed, so a
 * backfill can target EXACTLY those heights instead of re-indexing the whole
 * SRC-20/STAMP era.
 *
 * Why a full-era scan, not a cheap table lookup: the bug's signature is
 * ABSENCE. A missed stamp was decoded as null and never stored, so no table
 * lists the missed ones -- they are only found by RE-PARSING. The backend keeps
 * no raw transactions, so every era block must be re-fetched over Bitcoin RPC.
 * The cheap half is the DECODE (the parser only ARC4-decodes Counterparty-
 * envelope txs, a small fraction per block; the envelope test is upstream of the
 * ARC4 length-prefix bug and so is reliable); the FETCH is the cost floor.
 *
 * Do NOT narrow the scan to "blocks that already show stamp activity": whole
 * payload-length bands were missed at 100% (floor(len/128) odd, and any
 * len >= 32768), so an all-high-byte block is stored as zero stamps and looks
 * like a non-stamp block. That pre-filter is not complete and would re-introduce
 * the undercount it is meant to find.
 *
 * Output: the affected heights plus the distinct calendar days they fall on
 * (the inputs a backfill needs -- delete+reindex those heights, then re-run the
 * ordpool_stats_daily backfill bounded to them, then the coarser rollups).
 *
 * Running it against production RPC competes with the live indexer, so that is
 * the maintainer's call. Size it on a subrange first: the per-block timing print
 * extrapolates to the full era. Invoke deliberately, e.g.
 *   START=793068 END=<tip> node dist/tasks/_ordpool/detect-arc4-missed-stamps.js
 * START must be the ARC4-path start height -- the parser's documented ARC4 /
 * Counterparty-multisig boundary, 793068 (the parser session measured the first
 * actually-decoded ARC4 stamp at 793487, so the documented constant sits
 * conservatively below it). It is the ERA boundary, not the first on-chain STAMP
 * (pre-OLGA Counterparty issuances run a different, unaffected path) and not the
 * first observed miss (a stride can hide earlier ones). START is required, never
 * defaulted, so the floor is a cited input: pass the authoritative value.
 */
import { convertVerboseBlockToSimplePlus, DigitalArtifactAnalyserService } from 'ordpool-parser';

import bitcoinCore from '../../api/bitcoin/bitcoin-client';
import DB from '../../database';
import logger from '../../logger';

/** The ARC4-governed per-block counts the length-prefix bug could suppress.
 *  Compared field-wise, never summed: `stamp` is the STAMP total while the
 *  per-content-type and src721/src101 fields are distinct or breakdown counts,
 *  so a sum would double-count. Any field where the fixed parser now reports a
 *  different value than the stored row is a missed (or garbled) decode. */
const FIELDS = ['stamp', 'src721', 'src101'] as const;
type Field = typeof FIELDS[number];

/** Stored per-block counts, keyed by the parser's field name. Absent row -> the
 *  block was never indexed; left for the normal missing-stats loop, not a miss. */
async function storedCounts(hash: string): Promise<Record<Field, number> | null> {
  const [rows] = await DB.query(
    `SELECT amounts_stamp AS stamp, amounts_src721 AS src721, amounts_src101 AS src101
       FROM ordpool_stats WHERE hash = ?`,
    [hash],
  ) as [Array<Record<Field, number>>, unknown];
  return rows.length ? rows[0] : null;
}

export interface MissedBlock {
  height: number;
  hash: string;
  day: string;                       // YYYY-MM-DD of the block time (rollup bucket)
  deltas: Partial<Record<Field, { stored: number; fixed: number }>>;
}

export async function detectMissedStamps(startHeight: number, endHeight: number): Promise<MissedBlock[]> {
  const affected: MissedBlock[] = [];
  const t0 = Date.now();
  let scanned = 0;

  for (let height = startHeight; height <= endHeight; height++) {
    const hash: string = await bitcoinCore.getBlockHash(height);
    // Verbosity 2 = full transactions, the exact shape the indexer re-indexes
    // from, so the detection and a later re-index see identical input.
    const verboseBlock = await bitcoinCore.getBlock(hash, 2);
    const transactions = convertVerboseBlockToSimplePlus(verboseBlock);
    const fixed = (await DigitalArtifactAnalyserService.analyseTransactions(transactions)).amounts;

    const stored = await storedCounts(hash);
    scanned++;

    // No stored row: not a miss, just an unindexed block -- skip (the running
    // missing-stats loop indexes it fresh with the fixed parser anyway).
    if (stored) {
      const deltas: MissedBlock['deltas'] = {};
      for (const f of FIELDS) {
        // `!==`, not `>`: additive misses raise the count, but a garbled
        // (non-UTF-8) decode could change it either way, and both need the block.
        if (fixed[f] !== stored[f]) { deltas[f] = { stored: stored[f], fixed: fixed[f] }; }
      }
      if (Object.keys(deltas).length) {
        const day = new Date(verboseBlock.time * 1000).toISOString().slice(0, 10);
        affected.push({ height, hash, day, deltas });
        logger.info(`detect-arc4: block #${height} (${day}) differs: ${JSON.stringify(deltas)}`, 'Ordpool');
      }
    }

    if (scanned % 500 === 0) {
      const perBlockMs = (Date.now() - t0) / scanned;
      const remaining = endHeight - height;
      logger.info(`detect-arc4: scanned ${scanned}, affected ${affected.length}, ${perBlockMs.toFixed(1)}ms/block, ~${(perBlockMs * remaining / 60000).toFixed(0)}min left`, 'Ordpool');
    }
  }

  const days = Array.from(new Set(affected.map((a) => a.day))).sort();
  logger.info(`detect-arc4: DONE. scanned ${scanned}, affected ${affected.length} blocks over ${days.length} days in ${((Date.now() - t0) / 60000).toFixed(1)}min`, 'Ordpool');
  logger.info(`detect-arc4: affected heights = ${JSON.stringify(affected.map((a) => a.height))}`, 'Ordpool');
  logger.info(`detect-arc4: affected rollup days = ${JSON.stringify(days)}`, 'Ordpool');
  return affected;
}

if (require.main === module) {
  const start = Number(process.env.START);
  const end = Number(process.env.END);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
    // eslint-disable-next-line no-console
    console.error('Usage: START=<firstStampHeight> END=<height> node detect-arc4-missed-stamps.js');
    process.exit(1);
  }
  detectMissedStamps(start, end)
    .then(() => process.exit(0))
    .catch((e) => { logger.err(`detect-arc4 failed: ${e instanceof Error ? e.message : e}`, 'Ordpool'); process.exit(1); });
}
