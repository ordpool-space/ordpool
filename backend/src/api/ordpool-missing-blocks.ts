import { getFirstInscriptionHeight, IEsploraApi } from 'ordpool-parser';

import transactionUtils from '../api/transaction-utils';
import config from '../config';
import logger from '../logger';
import { BlockExtended, TransactionExtended } from '../mempool.interfaces';
import blocksRepository from '../repositories/BlocksRepository';
import ordpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import BitcoinApi from './bitcoin/bitcoin-api';
import bitcoinApi from './bitcoin/bitcoin-api-factory';
import { IBitcoinApi } from './bitcoin/bitcoin-api.interface';
import bitcoinCore from './bitcoin/bitcoin-client';
import blocks from './blocks';


/**
 * Processes ordpool stats for missing blocks in the database (`blocks` table).
 * Prefers the bitcoin RPC API over the esplora API
 *
 * Unfortunately, the original mempool implementation does not recover from an empty or lagging `blocks` table,
 * Therefore, this service tries to save the situation by brute force.
 *
 * Prefers the bitcoin RPC API over the esplora API
 * This code assumes that MEMPOOL.BACKEND === 'esplora' is set,
 * otherwise the fallback has no effect because the RPC is always used
 */
class OrdpoolMissingBlocks {
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
   * Collects missing blocks in the `blocks` table. OrdpoolMissingStats can then process stats later on.
   * Respects batch size and switches between Bitcoin RPC and Esplora fallback as needed.
   *
   * @param batchSize - Number of blocks to process in a single run.
   * @returns {Promise<boolean>} - True if at least one block was processed successfully, false otherwise.
   */
  async processMissingBlocks(batchSize: number): Promise<boolean> {

    if (this.isTaskRunning) {
      logger.info('Missing Blocks task is still running. Skipping new instance.', 'Ordpool');
      return false;
    }

    this.isTaskRunning = true;
    let processedAtLeastOneBlock = false;

    const firstInscriptionHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);

    try {
      for (let i = 0; i < batchSize; i++) {

        const blockchainInfo = await bitcoinCore.getBlockchainInfo();
        const currentBlockHeight = blockchainInfo.blocks;

        const missing = await blocksRepository.$getMissingBlocksBetweenHeights(currentBlockHeight, firstInscriptionHeight);
        const height = missing.length > 0 ? missing[missing.length - 1] : null;

        if (!height) {
          logger.debug('Missing Blocks: No more blocks to process.', 'Ordpool');
          break;
        }

        const now = Date.now();

        // Check if fallback period has expired
        if (this.fallbackUntil !== null && now > this.fallbackUntil) {
          logger.info('Missing Blocks: Fallback period expired. Switching back to Bitcoin RPC.', 'Ordpool');
          this.fallbackUntil = null;
        }

        // the fallowing code is mimicking blocks.$indexBlock()
        try {
          let block: IEsploraApi.Block;
          let coinbaseTransaction: TransactionExtended;

          if (this.fallbackUntil !== null) {

            logger.debug(`Missing Blocks: Using Esplora API for block #${height}.`, 'Ordpool');

            // this will use esplora, if MEMPOOL.BACKEND === 'esplora'

            const blockHash = await bitcoinApi.$getBlockHash(height);
            block = await bitcoinApi.$getBlock(blockHash);

            // onlyCoinbase: is set to true here, so it will load only the coinbase txn of the block
            coinbaseTransaction = await blocks['$getTransactionsExtended'](blockHash, block.height, block.timestamp, true)[0];

          } else {
            logger.debug(`Missing Blocks: Using Bitcoin RPC for block #${height}.`, 'Ordpool');

            const blockHash = await bitcoinCore.getBlockHash(height);
            const rawBlock: IBitcoinApi.Block = await bitcoinCore.getBlock(blockHash, 1);
            block = BitcoinApi.convertBlock(rawBlock); // just renames some properties

             // warning: the IBitcoinApi.Block interface is broken here! Property .tx is an array of strings!
            const coinbaseTxnHash = rawBlock.tx[0] as unknown as string;

            // forceCore: is set to true here, so it calls bitcoin core underneath!
            // will get query the RPC and convert the txn from `IBitcoinApi.Transaction` format to `IEsploraApi.Transaction` format via `$convertTransaction`
            // and then to TransactionExtended format via `extendTransaction`
            coinbaseTransaction = await transactionUtils.$getTransactionExtended(coinbaseTxnHash, false, false, true);
          }

          const blockExtended: BlockExtended = await blocks['$getBlockExtended'](block, [coinbaseTransaction]);
          await blocksRepository.$saveBlockInDatabase(blockExtended);

          processedAtLeastOneBlock = true;
        } catch (error) {
          logger.debug('Missing Blocks: Switching to Esplora fallback due to RPC failure.', 'Ordpool');
          this.fallbackUntil = Date.now() + OrdpoolMissingBlocks.fallbackCooldownMs;
          throw error;
        }
      }
    } finally {
      this.isTaskRunning = false;
    }

    return processedAtLeastOneBlock;
  }
}


export default new OrdpoolMissingBlocks();
