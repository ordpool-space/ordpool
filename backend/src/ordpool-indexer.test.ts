import OrdpoolBlocks from './api/ordpool-blocks';
import logger from './logger';

import OrdpoolIndexer from './ordpool-indexer';

jest.mock('./api/ordpool-blocks');
jest.mock('./logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  err: jest.fn(),
}));

describe('OrdpoolIndexer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock).mockResolvedValue(false);
  });

  it('should process tasks with initial batch size', async () => {
    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await OrdpoolIndexer.run();

    expect(OrdpoolBlocks.processOrdpoolStatsForOldBlocks).toHaveBeenCalledWith(10); // Default batch size
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('No more tasks to process for Ordpool Stats.'));
  });

  it('should increase batch size if tasks complete too quickly', async () => {
    jest.spyOn(global.Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1000); // 1 second duration

    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await OrdpoolIndexer.run();

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Batch size increased to 15'));
  });

  it('should decrease batch size if tasks take too long', async () => {
    jest.spyOn(global.Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(16 * 60 * 1000); // 16 minutes duration

    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await OrdpoolIndexer.run();

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Batch size decreased to 5'));
  });

  it('should apply exponential backoff on failure', async () => {
    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockRejectedValue(new Error('Simulated failure'))
      .mockRejectedValue(new Error('Simulated failure'));

    await OrdpoolIndexer.run();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Retrying in 1s'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Retrying in 2s'));
  });

  it('should enter cooldown after max failures', async () => {
    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock).mockRejectedValue(new Error('Simulated failure'));

    for (let i = 0; i < 5; i++) {
      await OrdpoolIndexer.run();
    }

    expect(logger.err).toHaveBeenCalledWith(expect.stringContaining('Max failures reached.'));
    expect(OrdpoolIndexer['cooldownUntil']).toBeGreaterThan(Date.now());
  });

  it('should not process tasks during cooldown', async () => {
    OrdpoolIndexer['cooldownUntil'] = Date.now() + 10 * 60 * 1000; // Cooldown for 10 minutes

    await OrdpoolIndexer.run();

    expect(OrdpoolBlocks.processOrdpoolStatsForOldBlocks).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Processing halted'));
  });

  it('should reset failure count on success', async () => {
    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockRejectedValueOnce(new Error('Simulated failure'))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await OrdpoolIndexer.run();

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Batch size maintained'));
    expect(OrdpoolIndexer['failureCount']).toBe(0);
  });

  it('should sleep to maintain target duration', async () => {
    jest.spyOn(global.Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(5 * 60 * 1000); // 5 minutes duration

    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const sleepSpy = jest.spyOn(OrdpoolIndexer as any, 'sleep');
    await OrdpoolIndexer.run();

    expect(sleepSpy).toHaveBeenCalledWith(5 * 60 * 1000); // Sleep for remaining 5 minutes
  });

  it('should maintain batch size within target duration', async () => {
    jest.spyOn(global.Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(10 * 60 * 1000); // 10 minutes duration

    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await OrdpoolIndexer.run();

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Batch size maintained'));
  });
});
