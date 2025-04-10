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

          if (this.fallbackUntil !== null) {
            logger.debug(`Missing Stats: Using Esplora API for block #${block.height}.`, 'Ordpool');

            // this will use esplora, if MEMPOOL.BACKEND === 'esplora'
            // onlyCoinbase is set to false here, so it will load ALL transactions of the block
            transactions = await blocks['$getTransactionsExtended'](block.id, block.height, block.timestamp, false);

          } else {
            logger.debug(`Missing Stats: Using Bitcoin RPC for block #${block.height}.`, 'Ordpool');

            // uses the Bitcoin Core RPC's getblock method with verbosity level 2.
            // this will give us the block's raw data, including all transactions.
            const verboseBlock = await bitcoinCore.getBlock(block.id, 2);
            transactions = convertVerboseBlockToSimplePlus(verboseBlock);
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
