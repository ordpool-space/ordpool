
import logger from '../logger';
import { convertVerboseBlockToSimplePlus, DigitalArtifactAnalyserService, getFirstInscriptionHeight, TransactionSimplePlus } from 'ordpool-parser';
import OrdpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import config from '../config';
import Blocks from './blocks';
import bitcoinClient from './bitcoin/bitcoin-client';


class OrdpoolBlocks {
  isTaskRunning = false;
  useEsploraFallback = false;
  lastSwitchTime: number | null = null;
  switchCooldownMs = 5 * 60 * 1000; // 5 minutes cooldown

  /**
   * Processes ordpool stats for missing blocks in the database.
   * Dynamically retrieves and analyzes transactions for blocks without ordpool stats.
   * Switches between Bitcoin RPC and Esplora upon errors.
   *
   * @param batchSize - Number of blocks to process in a single run.
   * @returns True if at least one block was processed, otherwise false.
   * @throws Propagates critical errors for handling by the caller.
   */
  async processOrdpoolStatsForOldBlocks(batchSize: number): Promise<boolean> {

    if (this.isTaskRunning) {
      logger.info('Ordpool stats task is already running. Skipping new instance.');
      return false;
    }

    this.isTaskRunning = true;
    let processedAtLeastOneBlock = false;

    try {
      const firstInscriptionHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);

      for (let i = 0; i < batchSize; i++) {
        const block = await OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats(firstInscriptionHeight);

        if (!block) {
          logger.info('No more blocks to process for Ordpool Stats. Task completed.');
          break;
        }

        let transactions: TransactionSimplePlus[];

        try {
          // Use Bitcoin RPC or Esplora based on the current state
          if (this.useEsploraFallback) {
            logger.debug(`Fetching transactions for block ${block.height} via Esplora.`);
            transactions = await Blocks['$getTransactionsExtended'](
              block.id,
              block.height,
              block.timestamp,
              false
            );
          } else {
            logger.debug(`Fetching transactions for block ${block.height} via Bitcoin RPC.`);
            const verboseBlock = await bitcoinClient.getBlock(block.id, 2);
            transactions = convertVerboseBlockToSimplePlus(verboseBlock);
          }

          const ordpoolStats = await DigitalArtifactAnalyserService.analyseTransactions(transactions);

          await OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase({
            id: block.id,
            height: block.height,
            extras: {
              ordpoolStats,
            },
          });

          logger.info(`Processed Ordpool Stats for block #${block.height}`);
          processedAtLeastOneBlock = true;
        } catch (blockError) {
          logger.err(`Error processing block #${block.height}: ${blockError}`);
          this.handleDataSourceError();
          throw blockError;
        }
      }
    } finally {
      this.isTaskRunning = false;
    }

    return processedAtLeastOneBlock;
  }

  /**
   * Handles data source errors by switching between Bitcoin RPC and Esplora.
   */
  private handleDataSourceError(): void {
    const now = Date.now();

    if (!this.useEsploraFallback && (!this.lastSwitchTime || now - this.lastSwitchTime >= this.switchCooldownMs)) {
      logger.warn('Switching to Esplora due to Bitcoin RPC failures.');
      this.useEsploraFallback = true;
      this.lastSwitchTime = now;
    } else if (this.useEsploraFallback && (!this.lastSwitchTime || now - this.lastSwitchTime >= this.switchCooldownMs)) {
      logger.warn('Switching back to Bitcoin RPC after Esplora fallback.');
      this.useEsploraFallback = false;
      this.lastSwitchTime = now;
    }
  }
}

export default new OrdpoolBlocks();
