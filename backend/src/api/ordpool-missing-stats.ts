
import logger from '../logger';
import { convertVerboseBlockToSimplePlus, DigitalArtifactAnalyserService, getFirstInscriptionHeight, TransactionSimplePlus } from 'ordpool-parser';
import ordpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import config from '../config';
import blocks from './blocks';
import bitcoinClient from './bitcoin/bitcoin-client';

/**
 * Processes ordpool stats for missing blocks in the database.
 * Prefers the bitcoin RPC API over the esplora API
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
  async processOrdpoolStatsForOldBlocks(batchSize: number): Promise<boolean> {

    if (this.isTaskRunning) {
      logger.info('Ordpool Stats task is still running. Skipping new instance.', 'Ordpool');
      return false;
    }

    this.isTaskRunning = true;
    let processedAtLeastOneBlock = false;

    try {
      for (let i = 0; i < batchSize; i++) {

        const firstInscriptionHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);
        const block = await ordpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats(firstInscriptionHeight);

        if (!block) {
          logger.debug('No more blocks to process for Ordpool Stats.', 'Ordpool');
          break;
        }

        const now = Date.now();

        // Check if fallback period has expired
        if (this.fallbackUntil !== null && now > this.fallbackUntil) {
          logger.info('Fallback period expired. Switching back to Bitcoin RPC.', 'Ordpool');
          this.fallbackUntil = null;
        }

        try {
          let transactions: TransactionSimplePlus[];

          if (this.fallbackUntil !== null) {
            logger.debug(`Using Esplora API for block #${block.height}.`, 'Ordpool');
            transactions = await blocks['$getTransactionsExtended'](block.id, block.height, block.timestamp, false);
          } else {
            logger.debug(`Using Bitcoin RPC for block #${block.height}.`, 'Ordpool');
            const verboseBlock = await bitcoinClient.getBlock(block.id, 2);
            transactions = convertVerboseBlockToSimplePlus(verboseBlock);
          }

          const ordpoolStats = await DigitalArtifactAnalyserService.analyseTransactions(transactions);

          await ordpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase({
            id: block.id,
            height: block.height,
            extras: {
              ordpoolStats,
            },
          });

          // logger.debug(`Processed Ordpool Stats for block #${block.height}`, 'Ordpool');
          processedAtLeastOneBlock = true;
        } catch (error) {
          logger.debug('Switching to Esplora fallback due to RPC failure.', 'Ordpool');
          this.fallbackUntil = Date.now() + OrdpoolMissingStats.fallbackCooldownMs;
          throw error;
        }
      }
    } finally {
      this.isTaskRunning = false;
    }

    return processedAtLeastOneBlock;
  }

  //  /**
  //  * Processes missing blocks (header-only) starting from the first known ordinal block.
  //  * Fills any gaps in the blocks table up to the current chain tip.
  //  *
  //  * @param batchSize - Maximum number of missing blocks to process in one run.
  //  * @returns True if at least one block was added, false otherwise.
  //  */
  //  async processMissingBlocks(batchSize: number): Promise<boolean> {
  //   const tip = await bitcoinClient.getBlockCount();
  //   let count = 0;

  //   for (let i = 0; i < batchSize; i++) {
  //     const missingHeight = await ordpoolBlocksRepository.getLowestMissingBlockHeight();
  //     if (missingHeight === null || missingHeight > tip) break;

  //     try {
  //       const blockHash = await bitcoinClient.getBlockHash(missingHeight);
  //       const header = await bitcoinClient.getBlock(blockHash, 0); // verbosity 0 or 1 is enough
  //       await blocks.$addBlockHeaderOnly(header, missingHeight);  // implement this as a lightweight insert
  //       logger.info(`Added missing block header #${missingHeight}`, 'Ordpool');
  //       count++;
  //     } catch (e) {
  //       logger.warn(`Failed to add missing block at height ${missingHeight}: ${e instanceof Error ? e.message : e}`, 'Ordpool');
  //       break; // fail-fast so indexer can slow down
  //     }
  //   }

  //   return count > 0;
  // }
}


export default new OrdpoolMissingStats();
