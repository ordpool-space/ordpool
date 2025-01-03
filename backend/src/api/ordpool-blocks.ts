
import logger from '../logger';
import { DigitalArtifactAnalyserService, getFirstInscriptionHeight } from 'ordpool-parser';
import OrdpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import config from '../config';
import Blocks from './blocks';


const BATCH_SIZE = 10; // Number of blocks to process in each run
const BATCH_DELAY_MS = 5000; // Delay between batches in milliseconds

class OrdpoolBlocks {

  isTaskRunning = false;

  async processOrdpoolStatsForOldBlocks(): Promise<void> {
    if (this.isTaskRunning) {
      logger.info('Ordpool stats task is already running. Skipping new instance.');
      return;
    }

    this.isTaskRunning = true;

    try {
      const firstInscriptionHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);

      while (true) {
        // Get the lowest missing block
        const missingBlock = await OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats(firstInscriptionHeight);

        if (!missingBlock) {
          logger.info('No more blocks to process for Ordpool Stats. Task completed.');
          break;
        }

        const { height: startHeight } = missingBlock;
        const endHeight = startHeight + BATCH_SIZE - 1;

        const blocksToProcess = await Blocks.$getBlocksBetweenHeight(startHeight, endHeight);

        for (const block of blocksToProcess) {

          const transactions = await Blocks['$getTransactionsExtended'](block.id, block.height, block.timestamp, false);

          const ordpoolStats = await DigitalArtifactAnalyserService.analyseTransactions(transactions);

          await OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase({
            id: block.id,
            height: block.height,
            extras: {
              ordpoolStats
            }
          });
          logger.info(`Processed ordpool stats for block #${block.height}`);
        }

        // Delay before processing the next batch
        logger.info(`Completed batch up to block #${endHeight}. Waiting ${BATCH_DELAY_MS}ms before the next batch.`);
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    } catch (error) {
      logger.err(`Error while processing ordpool stats: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.isTaskRunning = false;
    }
  }


}

export default new OrdpoolBlocks();
