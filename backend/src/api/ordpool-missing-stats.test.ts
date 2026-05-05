import { convertVerboseBlockToSimplePlus, DigitalArtifactAnalyserService } from 'ordpool-parser';
import bitcoinClient from './bitcoin/bitcoin-client';
import OrdpoolMissingStats from './ordpool-missing-stats';
import Blocks from './blocks';
import OrdpoolBlocksRepository from '../repositories/OrdpoolBlocksRepository';
import OrdpoolSkippedBlocksRepository from '../repositories/OrdpoolSkippedBlocksRepository';

jest.mock('./bitcoin/bitcoin-client');
jest.mock('./blocks');
jest.mock('ordpool-parser');
jest.mock('../repositories/OrdpoolBlocksRepository');
jest.mock('../repositories/OrdpoolSkippedBlocksRepository');
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
    // Reset per-block failure tracking + lastSuccessAt between tests.
    (OrdpoolMissingStats as any).failureCount = new Map<number, number>();
    (OrdpoolMissingStats as any).lastSuccessAt = null;
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

  it('engages esplora fallback on RPC failure and throws when whole batch failed', async () => {
    // Single-block batch where the only block fails: nothing got processed,
    // so the batch escalates to a thrown error so the indexer can cool down.
    const blocks = [{ id: 'id', height: 1000, timestamp: 123 }];
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue(blocks);
    (bitcoinClient.getBlock as jest.Mock).mockRejectedValue(new Error('RPC Error'));

    await expect(OrdpoolMissingStats.processMissingStats(1)).rejects.toThrow(/All 1 blocks in batch failed/);
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

/**
 * Behavioural tests for the poison-block escape hatch added 2026-05-05 after
 * block 869,599's corrupt brotli inscription crashed the parser and the
 * indexer looped on it for hours.
 *
 * The contract:
 *   - One bad block in a batch must NOT take down the rest of the batch.
 *   - Per-block failure counter increments per consecutive same-block failure.
 *   - On the K-th (POISON_THRESHOLD) consecutive same-block failure, the
 *     block is upserted into ordpool_stats_skipped via the repository.
 *   - On success, the per-height counter clears AND lastSuccessAt advances.
 *   - Mixed batches (some succeed, some fail) return true (made progress)
 *     and do NOT throw — the indexer keeps going.
 *   - All-fail batches throw, so the indexer's cooldown still kicks in for
 *     catastrophic conditions like a DB outage.
 */
describe('OrdpoolMissingStats — poison-block tracking', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    OrdpoolMissingStats.fallbackUntil = null;
    OrdpoolMissingStats.isTaskRunning = false;
    (OrdpoolMissingStats as any).failureCount = new Map<number, number>();
    (OrdpoolMissingStats as any).lastSuccessAt = null;
  });

  it('upserts to ordpool_stats_skipped after K consecutive failures on the same height', async () => {
    const blocks = [{ id: 'poison-id', height: 869599, timestamp: 999 }];
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue(blocks);
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([{ txid: 'corrupt-tx' }]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockRejectedValue(
      new Error('Corrupted Huffman code histogram'),
    );

    // First two batches fail but stay below threshold — no skip yet.
    await expect(OrdpoolMissingStats.processMissingStats(1)).rejects.toThrow(/All 1 blocks in batch failed/);
    expect(OrdpoolSkippedBlocksRepository.upsertSkippedBlock).not.toHaveBeenCalled();

    await expect(OrdpoolMissingStats.processMissingStats(1)).rejects.toThrow(/All 1 blocks in batch failed/);
    expect(OrdpoolSkippedBlocksRepository.upsertSkippedBlock).not.toHaveBeenCalled();

    // Third consecutive failure on the same height: the block gets poison-skipped.
    await expect(OrdpoolMissingStats.processMissingStats(1)).rejects.toThrow(/All 1 blocks in batch failed/);
    expect(OrdpoolSkippedBlocksRepository.upsertSkippedBlock).toHaveBeenCalledTimes(1);
    expect(OrdpoolSkippedBlocksRepository.upsertSkippedBlock).toHaveBeenCalledWith(
      869599,
      'poison-id',
      expect.stringContaining('Corrupted Huffman'),
    );

    // After the skip, the per-height counter is cleared so the next attempt starts fresh.
    expect(((OrdpoolMissingStats as any).failureCount as Map<number, number>).has(869599)).toBe(false);
  });

  it('a single bad block does NOT take down the rest of the batch', async () => {
    const blocks = [
      { id: 'good1', height: 1000, timestamp: 100 },
      { id: 'poison', height: 1001, timestamp: 101 },
      { id: 'good2', height: 1002, timestamp: 102 },
    ];
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue(blocks);
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([{ txid: 'a' }]);

    // Parser fails ONLY on the poison block; the other two succeed.
    let call = 0;
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockImplementation(async () => {
      call++;
      if (call === 2) { throw new Error('parser exploded'); }
      return {};
    });

    const result = await OrdpoolMissingStats.processMissingStats(3);

    // Two good blocks made progress, the bad one was tolerated.
    expect(result).toBe(true);
    expect(OrdpoolBlocksRepository.saveBlockOrdpoolStatsInDatabase).toHaveBeenCalledTimes(2);
    // Below threshold: no skip yet.
    expect(OrdpoolSkippedBlocksRepository.upsertSkippedBlock).not.toHaveBeenCalled();
    // Per-height counter shows one failure on 1001.
    expect(((OrdpoolMissingStats as any).failureCount as Map<number, number>).get(1001)).toBe(1);
  });

  it('lastSuccessAt advances on every per-block success and stays put on failure', async () => {
    const blocks = [{ id: 'good', height: 2000, timestamp: 200 }];
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue(blocks);
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([{ txid: 'a' }]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockResolvedValue({});

    expect(OrdpoolMissingStats.getLastSuccessAt()).toBeNull();

    const before = Date.now();
    await OrdpoolMissingStats.processMissingStats(1);
    const after = Date.now();

    const ts = OrdpoolMissingStats.getLastSuccessAt();
    expect(ts).not.toBeNull();
    expect(ts!.getTime()).toBeGreaterThanOrEqual(before);
    expect(ts!.getTime()).toBeLessThanOrEqual(after);

    // Now run a failing batch — lastSuccessAt must NOT advance.
    const tsBeforeFail = ts!.getTime();
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue([
      { id: 'bad', height: 2001, timestamp: 201 },
    ]);
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock).mockRejectedValue(new Error('boom'));

    await expect(OrdpoolMissingStats.processMissingStats(1)).rejects.toThrow();
    expect(OrdpoolMissingStats.getLastSuccessAt()!.getTime()).toBe(tsBeforeFail);
  });

  it('successful processing of a height clears its per-block failure counter', async () => {
    const blocks = [{ id: 'flaky', height: 3000, timestamp: 300 }];
    (OrdpoolBlocksRepository.getBlocksWithoutOrdpoolStatsInRange as jest.Mock).mockResolvedValue(blocks);
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue('verbose-block');
    (convertVerboseBlockToSimplePlus as jest.Mock).mockReturnValue([{ txid: 'a' }]);

    // First call: parser throws (transient). Second call: succeeds.
    (DigitalArtifactAnalyserService.analyseTransactions as jest.Mock)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({});

    await expect(OrdpoolMissingStats.processMissingStats(1)).rejects.toThrow();
    expect(((OrdpoolMissingStats as any).failureCount as Map<number, number>).get(3000)).toBe(1);

    // Reset the mock so the second call uses the success queue
    const result = await OrdpoolMissingStats.processMissingStats(1);
    expect(result).toBe(true);
    // After success, the failure counter for 3000 is cleared.
    expect(((OrdpoolMissingStats as any).failureCount as Map<number, number>).has(3000)).toBe(false);
    // No skip emitted (we never reached threshold).
    expect(OrdpoolSkippedBlocksRepository.upsertSkippedBlock).not.toHaveBeenCalled();
  });
});
