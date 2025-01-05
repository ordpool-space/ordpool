import { convertVerboseBlockToSimplePlus, DigitalArtifactAnalyserService } from 'ordpool-parser';

import OrdpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import bitcoinClient from './bitcoin/bitcoin-client';
import Blocks from './blocks';
import OrdpoolBlocks from './ordpool-blocks';


jest.mock('./blocks');
jest.mock('./bitcoin/bitcoin-client');
jest.mock('../repositories/OrdpoolBlocksRepository');
jest.mock('ordpool-parser');

jest.mock('../logger', () => ({
  err: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
}));


describe('OrdpoolBlocks', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    OrdpoolBlocks.fallbackUntil = null;
    OrdpoolBlocks.isTaskRunning = false;
  });

  it('should process a batch of blocks using Bitcoin RPC', async () => {
    const mockBlock = {
      id: 'test-block-id',
      height: 840000,
      timestamp: 1713571767,
    };

    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock).mockResolvedValueOnce(mockBlock);
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('mocked-verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockResolvedValue({});

    const result = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(5);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).toHaveBeenCalledTimes(1);
    expect(OrdpoolBlocks.fallbackUntil).toBeNull();
  });

  it('should switch to Esplora fallback on RPC failure', async () => {
    const mockBlock = {
      id: 'test-block-id',
      height: 840000,
      timestamp: 1713571767,
    };

    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock).mockResolvedValueOnce(mockBlock);
    (bitcoinClient.getBlock as jest.Mock).mockRejectedValue(new Error('RPC Error'));
    (Blocks['$getTransactionsExtended'] as jest.Mock).mockResolvedValue([]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockResolvedValue({});

    await expect(OrdpoolBlocks.processOrdpoolStatsForOldBlocks(5)).rejects.toThrow('RPC Error');

    expect(OrdpoolBlocks.fallbackUntil).not.toBeNull();
    expect(Blocks['$getTransactionsExtended']).not.toHaveBeenCalled(); // No further calls after failure
  });

  it('should respect fallback cooldown and use Esplora API', async () => {
    OrdpoolBlocks.fallbackUntil = Date.now() + 1000 * 60; // Active fallback

    const mockBlock = {
      id: 'test-block-id',
      height: 840000,
      timestamp: 1713571767,
    };

    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock).mockResolvedValueOnce(mockBlock);
    (Blocks['$getTransactionsExtended'] as jest.Mock).mockResolvedValue([]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockResolvedValue({});

    const result = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(5);

    expect(result).toBe(true);
    expect(Blocks['$getTransactionsExtended']).toHaveBeenCalledTimes(1);
    expect(bitcoinClient.getBlock).not.toHaveBeenCalled();
  });

  it('should switch back to Bitcoin RPC after fallback period expires', async () => {
    OrdpoolBlocks.fallbackUntil = Date.now() - 1000; // Expired fallback

    const mockBlock = {
      id: 'test-block-id',
      height: 840000,
      timestamp: 1713571767,
    };

    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock).mockResolvedValueOnce(mockBlock);
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('mocked-verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockResolvedValue({});

    const result = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(5);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).toHaveBeenCalledTimes(1);
    expect(OrdpoolBlocks.fallbackUntil).toBeNull();
  });

  it('should stop processing if no blocks are found', async () => {
    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock).mockResolvedValue(null);

    const result = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(5);

    expect(result).toBe(false);
    expect(bitcoinClient.getBlock).not.toHaveBeenCalled();
    expect(Blocks['$getTransactionsExtended']).not.toHaveBeenCalled();
  });

  it('should respect isTaskRunning flag to prevent overlapping tasks', async () => {
    OrdpoolBlocks.isTaskRunning = true;

    const result = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(5);

    expect(result).toBe(false);
    expect(bitcoinClient.getBlock).not.toHaveBeenCalled();
    expect(Blocks['$getTransactionsExtended']).not.toHaveBeenCalled();
  });

  it('should process multiple blocks in a batch', async () => {
    const mockBlock = {
      id: 'test-block-id',
      height: 840000,
      timestamp: 1713571767,
    };

    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock)
      .mockResolvedValueOnce(mockBlock)
      .mockResolvedValueOnce(mockBlock)
      .mockResolvedValueOnce(mockBlock);

    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('mocked-verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockResolvedValue({});

    const result = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(3);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).toHaveBeenCalledTimes(3);
  });
});
