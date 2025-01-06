
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
class OrdpoolBlocks {
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
            logger.info(`Using Esplora API for block #${block.height}.`, 'Ordpool');
            transactions = await blocks['$getTransactionsExtended'](block.id, block.height, block.timestamp, false);
          } else {
            logger.info(`Using Bitcoin RPC for block #${block.height}.`, 'Ordpool');
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

          logger.debug(`Processed Ordpool Stats for block #${block.height}`, 'Ordpool');
          processedAtLeastOneBlock = true;
        } catch (error) {
          logger.debug('Switching to Esplora fallback due to RPC failure.', 'Ordpool');
          this.fallbackUntil = Date.now() + OrdpoolBlocks.fallbackCooldownMs;
          throw error;
        }
      }
    } finally {
      this.isTaskRunning = false;
    }

    return processedAtLeastOneBlock;
  }
}

export default new OrdpoolBlocks();
