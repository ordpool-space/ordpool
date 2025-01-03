
import logger from '../logger';
import { convertVerboseBlockToSimplePlus, DigitalArtifactAnalyserService, getFirstInscriptionHeight, TransactionSimplePlus } from 'ordpool-parser';
import OrdpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import config from '../config';
import Blocks from './blocks';
import bitcoinClient from './bitcoin/bitcoin-client';


class OrdpoolBlocks {

  isTaskRunning = false;

  async processOrdpoolStatsForOldBlocks(): Promise<void> {
    if (this.isTaskRunning) {
      logger.info('Ordpool stats task is already running. Skipping new instance.');
      return;
    }

    this.isTaskRunning = true;
    var useEsplora = false;

    try {
      const firstInscriptionHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);
      const block = await OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats(firstInscriptionHeight);

      if (!block) {
        // logger.info('No more blocks to process for Ordpool Stats. Task completed.');
        return;
      }

      let transactions: TransactionSimplePlus[];
      if (useEsplora) {
        transactions = await Blocks['$getTransactionsExtended'](block.id, block.height, block.timestamp, false);
      } else {
        const verboseBlock = await bitcoinClient.getBlock(block.id, 2);
        transactions = convertVerboseBlockToSimplePlus(verboseBlock);
      }

      const ordpoolStats = await DigitalArtifactAnalyserService.analyseTransactions(transactions);

      await OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase({
        id: block.id,
        height: block.height,
        extras: {
          ordpoolStats
        }
      });
      logger.info(`Processed Ordpool Stats for block #${block.height}`);

    } catch (error) {
      logger.err(`Error while processing Ordpool Stats: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.isTaskRunning = false;
    }
  }
}

export default new OrdpoolBlocks();
