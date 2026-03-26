import {
  convertVerboseBlockToSimplePlus,
  DigitalArtifactAnalyserService,
  getFirstInscriptionHeight,
  TransactionSimplePlus,
} from 'ordpool-parser';

import config from '../config';
import logger from '../logger';
import ordpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
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
    let processedAtLeastOneBlock = false;

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

            processedAtLeastOneBlock = true;
            continue;
          }

          const ordpoolStats = await DigitalArtifactAnalyserService.analyseTransactions(transactions);

          await ordpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase({
            id: block.id,
            height: block.height,
            extras: { ordpoolStats },
          });

          processedAtLeastOneBlock = true;
        } catch (error) {
          logger.debug('Missing Stats: Switching to Esplora fallback due to RPC failure.', 'Ordpool');
          this.fallbackUntil = Date.now() + OrdpoolMissingStats.fallbackCooldownMs;
          throw error;
        }
      }
    } finally {
      this.isTaskRunning = false;
    }

    return processedAtLeastOneBlock;
  }
}


export default new OrdpoolMissingStats();
