import { BlockExtended } from '../mempool.interfaces';
import blocksRepository from '../repositories/BlocksRepository';
import OrdpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import BitcoinApi from './bitcoin/bitcoin-api';
import bitcoinApi from './bitcoin/bitcoin-api-factory';
import bitcoinClient from './bitcoin/bitcoin-client';
import Blocks from './blocks';
import OrdpoolMissingBlocks from './ordpool-missing-blocks';
import transactionUtils from './transaction-utils';

jest.mock('./blocks');
jest.mock('./bitcoin/bitcoin-client');
jest.mock('./transaction-utils');
jest.mock('./bitcoin/bitcoin-api-factory');
jest.mock('../repositories/BlocksRepository');
jest.mock('../repositories/OrdpoolBlocksRepository');
jest.mock('./bitcoin/bitcoin-api');
jest.mock('../logger', () => ({
  err: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
}));

describe('OrdpoolMissingBlocks', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    OrdpoolMissingBlocks.fallbackUntil = null;
    OrdpoolMissingBlocks.isTaskRunning = false;
    (bitcoinClient.getBlockchainInfo as jest.Mock).mockResolvedValue({ blocks: 1002 });
  });

  it('should respect batch size and process with Bitcoin RPC', async () => {
    const mockHeights = [1002, 1001, 1000];
    const mockBlock = { height: 1000, id: 'hash', timestamp: 123 } as any;
    const mockTxn = { txid: 'cb', vin: [{ is_coinbase: true }] } as any;
    const mockBlockExtended: BlockExtended = { id: 'hash', height: 1000 } as any;

    (blocksRepository.$getMissingBlocksBetweenHeights as jest.Mock).mockResolvedValue(mockHeights);
    (bitcoinClient.getBlockHash as jest.Mock).mockResolvedValue('hash');
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue({ tx: ['cb'] });
    (BitcoinApi.convertBlock as jest.Mock).mockReturnValue(mockBlock);
    (transactionUtils.$getTransactionExtended as jest.Mock).mockResolvedValue(mockTxn);
    (Blocks['$getBlockExtended'] as jest.Mock).mockResolvedValue(mockBlockExtended);

    const result = await OrdpoolMissingBlocks.processMissingBlocks(2);

    expect(result).toBe(true);
    expect(blocksRepository.$saveBlockInDatabase).toHaveBeenCalledTimes(2);
    expect(transactionUtils.$getTransactionExtended).toHaveBeenCalledWith('cb', false, false, true);
  });

  it('should stop if no missing blocks are found', async () => {
    (blocksRepository.$getMissingBlocksBetweenHeights as jest.Mock).mockResolvedValue([]);

    const result = await OrdpoolMissingBlocks.processMissingBlocks(5);

    expect(result).toBe(false);
    expect(blocksRepository.$saveBlockInDatabase).not.toHaveBeenCalled();
  });

  it('should skip execution if already running', async () => {
    OrdpoolMissingBlocks.isTaskRunning = true;

    const result = await OrdpoolMissingBlocks.processMissingBlocks(3);

    expect(result).toBe(false);
    expect(blocksRepository.$saveBlockInDatabase).not.toHaveBeenCalled();
  });

  it('should use Esplora when fallback is active', async () => {
    OrdpoolMissingBlocks.fallbackUntil = Date.now() + 100000;

    const mockHeights = [1000];
    const mockBlock = { height: 1000, id: 'hash', timestamp: 123 } as any;
    const mockTxn = { txid: 'cb', vin: [{ is_coinbase: true }] } as any;
    const mockBlockExtended: BlockExtended = { id: 'hash', height: 1000 } as any;

    (blocksRepository.$getMissingBlocksBetweenHeights as jest.Mock).mockResolvedValue(mockHeights);
    (bitcoinApi.$getBlockHash as jest.Mock).mockResolvedValue('hash');
    (bitcoinApi.$getBlock as jest.Mock).mockResolvedValue(mockBlock);
    (Blocks['$getTransactionsExtended'] as jest.Mock).mockResolvedValue([mockTxn]);
    (Blocks['$getBlockExtended'] as jest.Mock).mockResolvedValue(mockBlockExtended);

    const result = await OrdpoolMissingBlocks.processMissingBlocks(1);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlockHash).not.toHaveBeenCalled();
    expect(blocksRepository.$saveBlockInDatabase).toHaveBeenCalledTimes(1);
  });

  it('should switch back from fallback when expired and use RPC', async () => {
    OrdpoolMissingBlocks.fallbackUntil = Date.now() - 1000;

    const mockHeights = [1000];
    const mockBlock = { height: 1000, id: 'hash', timestamp: 123 } as any;
    const mockTxn = { txid: 'cb', vin: [{ is_coinbase: true }] } as any;
    const mockBlockExtended: BlockExtended = { id: 'hash', height: 1000 } as any;

    (blocksRepository.$getMissingBlocksBetweenHeights as jest.Mock).mockResolvedValue(mockHeights);
    (bitcoinClient.getBlockHash as jest.Mock).mockResolvedValue('hash');
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue({ tx: ['cb'] });
    (BitcoinApi.convertBlock as jest.Mock).mockReturnValue(mockBlock);
    (transactionUtils.$getTransactionExtended as jest.Mock).mockResolvedValue(mockTxn);
    (Blocks['$getBlockExtended'] as jest.Mock).mockResolvedValue(mockBlockExtended);

    const result = await OrdpoolMissingBlocks.processMissingBlocks(1);

    expect(result).toBe(true);
    expect(OrdpoolMissingBlocks.fallbackUntil).toBeNull();
    expect(bitcoinClient.getBlock).toHaveBeenCalled();
  });

  it('should switch to fallback and throw on RPC error', async () => {
    const mockHeights = [1000];

    (blocksRepository.$getMissingBlocksBetweenHeights as jest.Mock).mockResolvedValue(mockHeights);
    (bitcoinClient.getBlockHash as jest.Mock).mockRejectedValue(new Error('RPC Error'));

    await expect(OrdpoolMissingBlocks.processMissingBlocks(1)).rejects.toThrow('RPC Error');

    expect(OrdpoolMissingBlocks.fallbackUntil).not.toBeNull();
  });
});
