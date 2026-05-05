import {
  convertVerboseBlockToSimplePlus,
  DigitalArtifactAnalyserService,
  getFirstInscriptionHeight,
  TransactionSimplePlus,
} from 'ordpool-parser';

import config from '../config';
import logger from '../logger';
import ordpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import ordpoolSkippedBlocksRepository from '../repositories/OrdpoolSkippedBlocksRepository';
import bitcoinCore from './bitcoin/bitcoin-client';
import blocks from './blocks';


// HACK -- Ordpool: Hard timeout for RPC calls.
// The built-in RPC timeout (60s) only covers "no response at all."
// It does NOT cover slow responses where bitcoind starts sending data
// but trickles it in slowly (e.g., when ord is hammering it).
// This wraps any promise with a hard deadline.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Processes ordpool stats for entries in the `blocks` table
 * that do not have corresponding data in the `ordpool_stats` table.
 *
 * Prefers the bitcoin RPC API over the esplora API
 * This code assumes that MEMPOOL.BACKEND === 'esplora' is set,
 * otherwise the fallback has no effect because the RPC is always used
 */
class OrdpoolMissingStats {
  /**
   * The timestamp until which the Esplora fallback is active.
   * If null, Bitcoin RPC is used as the default data source.
   */
  fallbackUntil: number | null = null;

  /**
   * The cooldown period (in milliseconds) before switching back to Bitcoin RPC.
   */
  static readonly fallbackCooldownMs = 5 * 60 * 1000; // 5 minutes

  /**
   * Hard timeout for a single block's RPC call (2 minutes).
   * Covers slow responses that the built-in 60s connection timeout misses.
   */
  static readonly rpcHardTimeoutMs = 2 * 60 * 1000;

  /**
   * Per-block failure counter. Keyed by block height. Cleared on success
   * for that height, AND cleared once we poison-skip the block. Prevents
   * the "stuck forever on block 869,599" loop from 2026-05-05 by giving up
   * on a specific height after a small number of consecutive failures.
   */
  private failureCount: Map<number, number> = new Map();

  /**
   * After this many consecutive failures on the *same* block height, the
   * block is upserted into ordpool_stats_skipped and excluded from the
   * missing-stats query. Recovery: DELETE FROM ordpool_stats_skipped;
   */
  static readonly POISON_THRESHOLD = 3;

  /**
   * Wall-clock timestamp of the last per-block successful save. Read by the
   * /api/v1/health/indexer-progress route to prove the indexer is making
   * progress; the heartbeat script alerts when this goes stale.
   */
  private lastSuccessAt: number | null = null;

  getLastSuccessAt(): Date | null {
    return this.lastSuccessAt === null ? null : new Date(this.lastSuccessAt);
  }

  /**
   * Rolling window of recent successful save timestamps (ms since epoch),
   * capped at RATE_WINDOW_SIZE. Used to compute blocks-per-minute for the
   * /health/indexer-progress endpoint so the frontend can show an ETA on
   * queued blocks. Bounded array; oldest entry shifts off when full.
   */
  private static readonly RATE_WINDOW_SIZE = 50;
  private static readonly RATE_MIN_SAMPLES = 5;
  private successWindow: number[] = [];

  /**
   * Returns the current indexing rate in blocks-per-minute over the rolling
   * window, or `null` when there aren't enough recent samples (e.g. shortly
   * after process start, or after a long idle period).
   */
  getBlocksPerMinute(): number | null {
    if (this.successWindow.length < OrdpoolMissingStats.RATE_MIN_SAMPLES) {
      return null;
    }
    const oldest = this.successWindow[0];
    const newest = this.successWindow[this.successWindow.length - 1];
    const spanMs = newest - oldest;
    if (spanMs <= 0) {
      return null;
    }
    // (n-1) intervals across spanMs gives the per-block period.
    const blocks = this.successWindow.length - 1;
    return (blocks / spanMs) * 60_000;
  }

  /**
   * Indicates whether a task is currently running.
   * Prevents overlapping task executions.
   */
  isTaskRunning = false;

  /**
   * Processes ordpool statistics for blocks without ordpool stats.
   * Respects batch size and switches between Bitcoin RPC and Esplora fallback as needed.
   *
   * @param batchSize - Number of blocks to process in a single run.
   * @returns {Promise<boolean>} - True if at least one block was processed successfully, false otherwise.
   */
  async processMissingStats(batchSize: number): Promise<boolean> {

    if (this.isTaskRunning) {
      logger.info('Missing Stats task is still running. Skipping new instance.', 'Ordpool');
      return false;
    }

    this.isTaskRunning = true;
    let processedCount = 0;
    let failedCount = 0;

    const firstInscriptionHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);

    try {
      const blocksToProcess = await ordpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange(
        firstInscriptionHeight,
        batchSize
      );

      if (!blocksToProcess.length) {
        logger.debug('Missing Stats: No more blocks to process.', 'Ordpool');
        return false;
      }

      for (const block of blocksToProcess) {
        const now = Date.now();

        // Check if fallback period has expired
        if (this.fallbackUntil !== null && now > this.fallbackUntil) {
          logger.info('Missing Stats: Fallback period expired. Switching back to Bitcoin RPC.', 'Ordpool');
          this.fallbackUntil = null;
        }

        try {
          let transactions: TransactionSimplePlus[];
          const t0 = Date.now();

          if (this.fallbackUntil !== null) {
            logger.debug(`Missing Stats: Using Esplora API for block #${block.height}.`, 'Ordpool');

            // this will use esplora, if MEMPOOL.BACKEND === 'esplora'
            // onlyCoinbase is set to false here, so it will load ALL transactions of the block
            transactions = await blocks['$getTransactionsExtended'](block.id, block.height, block.timestamp, false);

            const ordpoolStats = await DigitalArtifactAnalyserService.analyseTransactions(transactions);

            await ordpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase({
              id: block.id,
              height: block.height,
              extras: { ordpoolStats },
            });
          } else {
            // uses the Bitcoin Core RPC's getblock method with verbosity level 2.
            // this will give us the block's raw data, including all transactions.
            // HACK -- Ordpool: wrapped with hard timeout to prevent hanging on slow responses.
            // bitcoinCore is untyped JS (require'd) so getBlock() returns any.
            // Assign to typed variable first so withTimeout<T> infers the correct T.
            const rpcCall: Promise<Parameters<typeof convertVerboseBlockToSimplePlus>[0]> = bitcoinCore.getBlock(block.id, 2);
            const verboseBlock = await withTimeout(rpcCall, OrdpoolMissingStats.rpcHardTimeoutMs, `RPC getblock #${block.height}`);
            const t1 = Date.now();
            transactions = convertVerboseBlockToSimplePlus(verboseBlock);
            const t2 = Date.now();

            const ordpoolStats = await DigitalArtifactAnalyserService.analyseTransactions(transactions);
            const t3 = Date.now();

            await ordpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase({
              id: block.id,
              height: block.height,
              extras: { ordpoolStats },
            });
            const t4 = Date.now();

            logger.info(`Missing Stats: Block #${block.height} | ${transactions.length} txs | RPC: ${t1-t0}ms | convert: ${t2-t1}ms | analyse: ${t3-t2}ms | save: ${t4-t3}ms | total: ${t4-t0}ms`, 'Ordpool');
          }

          processedCount++;
          this.lastSuccessAt = Date.now();
          this.successWindow.push(this.lastSuccessAt);
          if (this.successWindow.length > OrdpoolMissingStats.RATE_WINDOW_SIZE) {
            this.successWindow.shift();
          }
          this.failureCount.delete(block.height);
        } catch (error) {
          // Per-block failure path (introduced 2026-05-05 after block 869,599's
          // corrupt brotli inscription crashed the parser and the indexer
          // looped on it for hours). Track failures per height; after K
          // consecutive same-block failures, poison-skip the block and move on.
          // Only catastrophic *batch-wide* failure (e.g. DB outage where every
          // block fails) bubbles up to the indexer for cooldown — the case
          // where `processedCount === 0 && failedCount > 0` at end of batch.
          failedCount++;
          const errMsg = error instanceof Error ? error.message : String(error);

          const count = (this.failureCount.get(block.height) ?? 0) + 1;
          this.failureCount.set(block.height, count);

          logger.warn(`Missing Stats: block #${block.height} failed (attempt ${count}/${OrdpoolMissingStats.POISON_THRESHOLD}): ${errMsg}`, 'Ordpool');

          // Trigger Esplora fallback for the next block(s) in case the RPC is unhappy.
          this.fallbackUntil = Date.now() + OrdpoolMissingStats.fallbackCooldownMs;

          if (count >= OrdpoolMissingStats.POISON_THRESHOLD) {
            logger.err(`Missing Stats: POISON-SKIPPING block #${block.height} after ${count} consecutive failures. Last error: ${errMsg}`, 'Ordpool');
            try {
              await ordpoolSkippedBlocksRepository.upsertSkippedBlock(block.height, block.id, errMsg);
              this.failureCount.delete(block.height);
            } catch (skipErr) {
              const skipMsg = skipErr instanceof Error ? skipErr.message : String(skipErr);
              logger.err(`Missing Stats: failed to write to ordpool_stats_skipped for block #${block.height}: ${skipMsg}`, 'Ordpool');
            }
          }
        }
      }
    } finally {
      this.isTaskRunning = false;
    }

    if (processedCount === 0 && failedCount > 0) {
      throw new Error(`All ${failedCount} blocks in batch failed; aborting batch for indexer cooldown`);
    }

    return processedCount > 0;
  }
}


export default new OrdpoolMissingStats();
