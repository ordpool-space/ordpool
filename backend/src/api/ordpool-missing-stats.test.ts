import { convertVerboseBlockToSimplePlus, DigitalArtifactAnalyserService } from 'ordpool-parser';
import bitcoinClient from './bitcoin/bitcoin-client';
import OrdpoolMissingStats from './ordpool-missing-stats';
import Blocks from './blocks';
import OrdpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';

jest.mock('./bitcoin/bitcoin-client');
jest.mock('./blocks');
jest.mock('ordpool-parser');
jest.mock('../repositories/OrdpoolBlocksRepository');
jest.mock('../logger', () => ({
  err: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
}));

describe('OrdpoolMissingStats', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    OrdpoolMissingStats.fallbackUntil = null;
    OrdpoolMissingStats.isTaskRunning = false;
  });

  it('should process a batch using Bitcoin RPC', async () => {
    const blocks = [{ id: 'id', height: 1000, timestamp: 123 }];
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue(blocks);
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([{ txid: 'a' }]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockResolvedValue({});

    const result = await OrdpoolMissingStats.processMissingStats(1);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).toHaveBeenCalledTimes(1);
    expect(OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase).toHaveBeenCalledWith({
      id: 'id',
      height: 1000,
      extras: { ordpoolStats: {} },
    });
  });

  it('should respect batch size', async () => {
    const blocks = [
      { id: 'id1', height: 1000, timestamp: 123 },
      { id: 'id2', height: 1001, timestamp: 124 },
    ];
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue(blocks);
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([{ txid: 'a' }]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockResolvedValue({});

    const result = await OrdpoolMissingStats.processMissingStats(2);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).toHaveBeenCalledTimes(2);
    expect(OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase).toHaveBeenCalledTimes(2);
  });

  it('should skip if already running', async () => {
    OrdpoolMissingStats.isTaskRunning = true;
    const result = await OrdpoolMissingStats.processMissingStats(5);
    expect(result).toBe(false);
  });

  it('should return false if no blocks found', async () => {
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue([]);
    const result = await OrdpoolMissingStats.processMissingStats(5);
    expect(result).toBe(false);
  });

  it('should fallback to esplora and throw error', async () => {
    const blocks = [{ id: 'id', height: 1000, timestamp: 123 }];
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue(blocks);
    (bitcoinClient.getBlock as jest.Mock).mockRejectedValue(new Error('RPC Error'));

    await expect(OrdpoolMissingStats.processMissingStats(1)).rejects.toThrow('RPC Error');
    expect(OrdpoolMissingStats.fallbackUntil).not.toBeNull();
  });

  it('should use esplora when fallback is active', async () => {
    OrdpoolMissingStats.fallbackUntil = Date.now() + 10000;
    const blocks = [{ id: 'id', height: 1000, timestamp: 123 }];
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue(blocks);
    (Blocks['$getTransactionsExtended'] as jest.Mock).mockResolvedValue([{ txid: 'a' }]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockResolvedValue({});

    const result = await OrdpoolMissingStats.processMissingStats(1);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).not.toHaveBeenCalled();
    expect(Blocks['$getTransactionsExtended']).toHaveBeenCalledTimes(1);
  });

  it('should switch back to Bitcoin RPC when fallback expired', async () => {
    OrdpoolMissingStats.fallbackUntil = Date.now() - 1000;
    const blocks = [{ id: 'id', height: 1000, timestamp: 123 }];
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue(blocks);
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([{ txid: 'a' }]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockResolvedValue({});

    const result = await OrdpoolMissingStats.processMissingStats(1);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).toHaveBeenCalledTimes(1);
    expect(OrdpoolMissingStats.fallbackUntil).toBeNull();
  });
});
