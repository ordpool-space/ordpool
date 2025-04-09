import { convertVerboseBlockToSimplePlus, DigitalArtifactAnalyserService } from 'ordpool-parser';

import OrdpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import bitcoinClient from './bitcoin/bitcoin-client';
import Blocks from './blocks';
import OrdpoolMissingBlocks from './ordpool-missing-blocks';


jest.mock('./blocks');
jest.mock('./bitcoin/bitcoin-client');
jest.mock('../repositories/OrdpoolBlocksRepository');
jest.mock('ordpool-parser');
jest.mock('../repositories/BlocksRepository');

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


    const result = await OrdpoolMissingBlocks.processMissingBlocks(5);

  });

  it('should switch to Esplora fallback on RPC failure', async () => {
    const mockHeight = 111;



    await expect(OrdpoolMissingBlocks.processMissingBlocks(5)).rejects.toThrow('RPC Error');

  });

  it('should respect fallback cooldown and use Esplora API', async () => {
    OrdpoolMissingBlocks.fallbackUntil = Date.now() + 1000 * 60; // Active fallback

    const mockHeight = 111;


    const result = await OrdpoolMissingBlocks.processMissingBlocks(5);


  });

  it('should switch back to Bitcoin RPC after fallback period expires', async () => {
    OrdpoolMissingBlocks.fallbackUntil = Date.now() - 1000; // Expired fallback

    const mockHeight = 111;


    const result = await OrdpoolMissingBlocks.processMissingBlocks(5);

  });

  it('should stop processing if no blocks are found', async () => {
    (OrdpoolBlocksRepository.getLowestMissingBlockHeight as jest.Mock).mockResolvedValue(null);

    const result = await OrdpoolMissingBlocks.processMissingBlocks(5);


  });

  it('should respect isTaskRunning flag to prevent overlapping tasks', async () => {
    OrdpoolMissingBlocks.isTaskRunning = true;

    const result = await OrdpoolMissingBlocks.processMissingBlocks(5);


  });

  it('should process multiple blocks in a batch', async () => {
    const mockHeight = 111;

    (OrdpoolBlocksRepository.getLowestMissingBlockHeight as jest.Mock)
      .mockResolvedValueOnce(mockHeight)
      .mockResolvedValueOnce(mockHeight)
      .mockResolvedValueOnce(mockHeight);



    const result = await OrdpoolMissingBlocks.processMissingBlocks(3);


  });
});
