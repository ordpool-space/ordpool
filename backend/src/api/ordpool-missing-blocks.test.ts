import blocksRepository from '../repositories/BlocksRepository';
import OrdpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import bitcoinApi from './bitcoin/bitcoin-api-factory';
import bitcoinClient from './bitcoin/bitcoin-client';
import Blocks from './blocks';
import OrdpoolMissingBlocks from './ordpool-missing-blocks';
import transactionUtils from './transaction-utils';

jest.mock('./blocks');
jest.mock('./bitcoin/bitcoin-client');
jest.mock('./bitcoin/bitcoin-api-factory');
jest.mock('../repositories/OrdpoolBlocksRepository');
jest.mock('../repositories/BlocksRepository');
jest.mock('./transaction-utils');
jest.mock('ordpool-parser');

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
  });

  it('should process a batch of blocks using Bitcoin RPC', async () => {
    const mockHeight = 111;

    (OrdpoolBlocksRepository.getLowestMissingBlockHeight as jest.Mock).mockResolvedValueOnce(mockHeight);
    (bitcoinClient.getBlockHash as jest.Mock).mockResolvedValueOnce('mock-block-hash');
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValueOnce({ tx: ['coinbase-txid'] });
    (transactionUtils.$getTransactionExtended as jest.Mock).mockResolvedValueOnce({ txid: 'coinbase-txid' });
    (Blocks['$getBlockExtended'] as jest.Mock).mockResolvedValueOnce({ id: 'mock-block-hash' });
    (blocksRepository.$saveBlockInDatabase as jest.Mock).mockResolvedValueOnce(undefined);

    const result = await OrdpoolMissingBlocks.processMissingBlocks(5);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).toHaveBeenCalledTimes(1);
    expect(transactionUtils.$getTransactionExtended).toHaveBeenCalledWith('coinbase-txid', false, false, true);
    expect(blocksRepository.$saveBlockInDatabase).toHaveBeenCalledWith({ id: 'mock-block-hash' });
  });

  it('should switch to Esplora fallback on RPC failure', async () => {
    const mockHeight = 111;

    (OrdpoolBlocksRepository.getLowestMissingBlockHeight as jest.Mock).mockResolvedValueOnce(mockHeight);
    (bitcoinClient.getBlockHash as jest.Mock).mockRejectedValueOnce(new Error('RPC Error'));

    await expect(OrdpoolMissingBlocks.processMissingBlocks(5)).rejects.toThrow('RPC Error');

    expect(OrdpoolMissingBlocks.fallbackUntil).not.toBeNull();
    expect(bitcoinApi.$getBlockHash).not.toHaveBeenCalled(); // fallback will trigger next round
  });

  it('should respect fallback cooldown and use Esplora API', async () => {
    OrdpoolMissingBlocks.fallbackUntil = Date.now() + 1000 * 60; // Active fallback

    const mockHeight = 111;
    const mockBlock = { height: mockHeight, id: 'mock-block-hash', timestamp: 1234567890 };

    (OrdpoolBlocksRepository.getLowestMissingBlockHeight as jest.Mock).mockResolvedValueOnce(mockHeight);
    (bitcoinApi.$getBlockHash as jest.Mock).mockResolvedValueOnce('mock-block-hash');
    (bitcoinApi.$getBlock as jest.Mock).mockResolvedValueOnce(mockBlock);
    (Blocks['$getTransactionsExtended'] as jest.Mock).mockResolvedValueOnce([{ txid: 'coinbase-txid' }]);
    (Blocks['$getBlockExtended'] as jest.Mock).mockResolvedValueOnce({ id: 'mock-block-hash' });
    (blocksRepository.$saveBlockInDatabase as jest.Mock).mockResolvedValueOnce(undefined);

    const result = await OrdpoolMissingBlocks.processMissingBlocks(5);

    expect(result).toBe(true);
    expect(bitcoinApi.$getBlockHash).toHaveBeenCalled();
    expect(Blocks['$getTransactionsExtended']).toHaveBeenCalled();
  });

  it('should switch back to Bitcoin RPC after fallback period expires', async () => {
    OrdpoolMissingBlocks.fallbackUntil = Date.now() - 1000; // Expired fallback

    const mockHeight = 111;

    (OrdpoolBlocksRepository.getLowestMissingBlockHeight as jest.Mock).mockResolvedValueOnce(mockHeight);
    (bitcoinClient.getBlockHash as jest.Mock).mockResolvedValueOnce('mock-block-hash');
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValueOnce({ tx: ['coinbase-txid'] });
    (transactionUtils.$getTransactionExtended as jest.Mock).mockResolvedValueOnce({ txid: 'coinbase-txid' });
    (Blocks['$getBlockExtended'] as jest.Mock).mockResolvedValueOnce({ id: 'mock-block-hash' });
    (blocksRepository.$saveBlockInDatabase as jest.Mock).mockResolvedValueOnce(undefined);

    const result = await OrdpoolMissingBlocks.processMissingBlocks(5);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).toHaveBeenCalled();
    expect(OrdpoolMissingBlocks.fallbackUntil).toBeNull();
  });

  it('should stop processing if no blocks are found', async () => {
    (OrdpoolBlocksRepository.getLowestMissingBlockHeight as jest.Mock).mockResolvedValue(null);

    const result = await OrdpoolMissingBlocks.processMissingBlocks(5);

    expect(result).toBe(false);
    expect(bitcoinClient.getBlock).not.toHaveBeenCalled();
    expect(bitcoinApi.$getBlock).not.toHaveBeenCalled();
  });

  it('should respect isTaskRunning flag to prevent overlapping tasks', async () => {
    OrdpoolMissingBlocks.isTaskRunning = true;

    const result = await OrdpoolMissingBlocks.processMissingBlocks(5);

    expect(result).toBe(false);
    expect(bitcoinClient.getBlock).not.toHaveBeenCalled();
    expect(bitcoinApi.$getBlock).not.toHaveBeenCalled();
  });

  it('should process multiple blocks in a batch', async () => {
    const mockHeight = 111;

    (OrdpoolBlocksRepository.getLowestMissingBlockHeight as jest.Mock)
      .mockResolvedValueOnce(mockHeight)
      .mockResolvedValueOnce(mockHeight)
      .mockResolvedValueOnce(null); // simulate stopping condition

    (bitcoinClient.getBlockHash as jest.Mock).mockResolvedValue('mock-block-hash');
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue({ tx: ['coinbase-txid'] });
    (transactionUtils.$getTransactionExtended as jest.Mock).mockResolvedValue({ txid: 'coinbase-txid' });
    (Blocks['$getBlockExtended'] as jest.Mock).mockResolvedValue({ id: 'mock-block-hash' });
    (blocksRepository.$saveBlockInDatabase as jest.Mock).mockResolvedValue(undefined);

    const result = await OrdpoolMissingBlocks.processMissingBlocks(3);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).toHaveBeenCalledTimes(2);
    expect(blocksRepository.$saveBlockInDatabase).toHaveBeenCalledTimes(2);
  });
});
