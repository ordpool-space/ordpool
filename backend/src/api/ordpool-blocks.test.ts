
import { convertVerboseBlockToSimplePlus, DigitalArtifactAnalyserService, getFirstInscriptionHeight, TransactionSimplePlus } from 'ordpool-parser';
import OrdpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import Blocks from './blocks';
import bitcoinClient from './bitcoin/bitcoin-client';
import OrdpoolBlocks from './ordpool-blocks';


jest.mock('../repositories/OrdpoolBlocksRepository');
jest.mock('ordpool-parser');
jest.mock('./bitcoin/bitcoin-client');
jest.mock('./blocks');

jest.mock('../logger', () => ({
  err: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
}));

describe('OrdpoolBlocks - Switching Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should start with Bitcoin RPC and process successfully', async () => {
    OrdpoolBlocks.useEsploraFallback = false;

    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock).mockResolvedValue({
      id: 'test-block-id',
      height: 840000,
      timestamp: 1713571767,
    });
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('mocked-verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([]);
    (OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase as jest.Mock).mockResolvedValue([]);

    const result = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(1);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).toHaveBeenCalled();
    expect(OrdpoolBlocks.useEsploraFallback).toBe(false);
  });

  it('should switch to Esplora after Bitcoin RPC fails', async () => {
    OrdpoolBlocks.useEsploraFallback = false;

    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock).mockResolvedValue({
      id: 'test-block-id',
      height: 840000,
      timestamp: 1713571767,
    });
    (bitcoinClient.getBlock as jest.Mock).mockRejectedValue(new Error('RPC failure'));
    (Blocks['$getTransactionsExtended'] as jest.Mock).mockResolvedValue([]);

    await expect(OrdpoolBlocks.processOrdpoolStatsForOldBlocks(1)).rejects.toThrow('RPC failure');

    expect(OrdpoolBlocks.useEsploraFallback).toBe(true);
    expect(Blocks['$getTransactionsExtended']).not.toHaveBeenCalled();
  });

  it('should process using Esplora after switching', async () => {
    OrdpoolBlocks.useEsploraFallback = true;

    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock).mockResolvedValue({
      id: 'test-block-id',
      height: 840000,
      timestamp: 1713571767,
    });
    (Blocks['$getTransactionsExtended'] as jest.Mock).mockResolvedValue([]);
    (OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase as jest.Mock).mockResolvedValue([]);

    const result = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(1);

    expect(result).toBe(true);
    expect(Blocks['$getTransactionsExtended']).toHaveBeenCalled();
    expect(OrdpoolBlocks.useEsploraFallback).toBe(true);
  });

  it('should switch back to Bitcoin RPC after cooldown', async () => {
    OrdpoolBlocks.useEsploraFallback = true;
    OrdpoolBlocks.lastSwitchTime = Date.now() - OrdpoolBlocks.switchCooldownMs;

    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock).mockResolvedValue({
      id: 'test-block-id',
      height: 840000,
      timestamp: 1713571767,
    });
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('mocked-verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([]);
    (OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase as jest.Mock).mockResolvedValue([]);

    const result = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(1);

    expect(result).toBe(true);
    expect(bitcoinClient.getBlock).toHaveBeenCalled();
    expect(OrdpoolBlocks.useEsploraFallback).toBe(false);
  });

  it('should not switch back to Bitcoin RPC before cooldown expires', async () => {
    OrdpoolBlocks.useEsploraFallback = true;
    OrdpoolBlocks.lastSwitchTime = Date.now();

    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock).mockResolvedValue({
      id: 'test-block-id',
      height: 840000,
      timestamp: 1713571767,
    });
    (Blocks['$getTransactionsExtended'] as jest.Mock).mockResolvedValue([]);
    (OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase as jest.Mock).mockResolvedValue([]);

    const result = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(1);

    expect(result).toBe(true);
    expect(Blocks['$getTransactionsExtended']).toHaveBeenCalled();
    expect(OrdpoolBlocks.useEsploraFallback).toBe(true);
  });

  it('should stop processing if no blocks are left', async () => {
    OrdpoolBlocks.useEsploraFallback = false;

    (OrdpoolBlocksRepository.getLowestBlockWithoutOrdpoolStats as jest.Mock).mockResolvedValue(null);

    const result = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(1);

    expect(result).toBe(false);
    expect(bitcoinClient.getBlock).not.toHaveBeenCalled();
  });
});
