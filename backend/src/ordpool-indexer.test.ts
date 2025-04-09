import OrdpoolIndexer from './ordpool-indexer';
import OrdpoolMissingStats from './api/ordpool-missing-stats';
import logger from './logger';

jest.mock('./api/ordpool-missing-stats');
jest.mock('./logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  err: jest.fn(),
}));

describe('OrdpoolIndexer', () => {
  const mockDateProvider = { now: jest.fn() };
  const mockSetTimeout = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();

    // Reset internal properties
    OrdpoolIndexer['batchSize'] = 10;
    OrdpoolIndexer['failureCount'] = 0;
    OrdpoolIndexer['sleepUntil'] = 0;
    OrdpoolIndexer['timeoutId'] = null;
    OrdpoolIndexer['isRunning'] = false;

    // Override dateProvider and setTimeoutFn
    OrdpoolIndexer.dateProvider = mockDateProvider;
    OrdpoolIndexer.setTimeoutFn = mockSetTimeout as any;

    // Mock setTimeout behavior
    mockSetTimeout.mockReturnValue(1);
  });

  it('processes tasks with initial batch size', async () => {
    (OrdpoolMissingStats.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockResolvedValueOnce(false);

    await OrdpoolIndexer.run();

    expect(OrdpoolMissingStats.processOrdpoolStatsForOldBlocks).toHaveBeenCalledWith(10); // Initial batch size
    expect(OrdpoolIndexer['batchSize']).toBe(10);
    expect(mockSetTimeout).toHaveBeenCalled(); // scheduleNextRun
  });

  it('increases batch size if tasks complete quickly', async () => {
    mockDateProvider.now
      .mockReturnValueOnce(0) // Start time
      .mockReturnValueOnce(1000); // 1 second duration

    (OrdpoolMissingStats.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockResolvedValueOnce(true);

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['batchSize']).toBe(15); // Batch size increased
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Batch size increased to 15'), 'Ordpool');
    expect(mockSetTimeout).toHaveBeenCalled(); // scheduleNextRun
  });

  it('decreases batch size if tasks take too long', async () => {
    mockDateProvider.now
      .mockReturnValueOnce(0) // Start time
      .mockReturnValueOnce(16 * 60 * 1000); // 16 minutes duration

    (OrdpoolMissingStats.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockResolvedValueOnce(true); // Ensure termination

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['batchSize']).toBe(5); // Batch size decreased
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Batch size decreased to 5'), 'Ordpool');
    expect(mockSetTimeout).toHaveBeenCalled(); // scheduleNextRun
  });

  it('has no backoff after first error (OrdpoolBlocks will switch API)', async () => {
    mockDateProvider.now
      .mockReturnValueOnce(0); // Start time

    (OrdpoolMissingStats.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockRejectedValueOnce(new Error('Simulated failure'));

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['batchSize']).toBe(5); // Batch size halved on failure
    expect(OrdpoolIndexer['failureCount']).toBe(1); // Failure count incremented
    expect(OrdpoolIndexer['sleepUntil']).toBe(0);
    expect(mockSetTimeout).toHaveBeenCalled(); // scheduleNextRun
  });

  it('handles backoff after 5 failures', async () => {
    OrdpoolIndexer['failureCount'] = 4;

    mockDateProvider.now
      .mockReturnValueOnce(0)  // Start time
      .mockReturnValueOnce(1000); // For the sleep until;

    (OrdpoolMissingStats.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockRejectedValueOnce(new Error('Simulated failure'));

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['batchSize']).toBe(5); // Batch size halved on failure
    expect(OrdpoolIndexer['failureCount']).toBe(5); // Failure count incremented
    expect(OrdpoolIndexer['sleepUntil']).toBe(1000 + 2 * 60 * 1000); // 2-minute cooldown
    expect(mockSetTimeout).toHaveBeenCalled(); // scheduleNextRun
  });

  it('enters rest state after completion', async () => {
    (OrdpoolMissingStats.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockResolvedValueOnce(false); // No more tasks

    await OrdpoolIndexer.run();

    const expectedRestTime = 10 * 60 * 1000; // 10 minutes rest
    expect(OrdpoolIndexer['sleepUntil']).toBe(mockDateProvider.now() + expectedRestTime);
    expect(mockSetTimeout).toHaveBeenCalled();
  });

  it('schedules the next run dynamically', async () => {
    OrdpoolIndexer['sleepUntil'] = 10 * 1000; // 10 seconds in the future
    mockDateProvider.now.mockReturnValue(0);

    await OrdpoolIndexer.run();

    expect(mockSetTimeout).toHaveBeenCalledWith(expect.any(Function), 10 * 1000); // Schedule in 10 seconds
  });

  it('resets failure count on success', async () => {
    mockDateProvider.now.mockReturnValue(0);

    (OrdpoolMissingStats.processOrdpoolStatsForOldBlocks as jest.Mock)
      .mockRejectedValueOnce(new Error('Simulated failure'));

    // one additional run
    mockSetTimeout.mockImplementation((callback, ms) => {

      expect(OrdpoolIndexer['failureCount']).toBe(1); // Failure count reset on success
      expect(OrdpoolIndexer['batchSize']).toBe(5); // Batch size decreased

      (OrdpoolMissingStats.processOrdpoolStatsForOldBlocks as jest.Mock)
        .mockResolvedValueOnce(true);

      // no more runs
      mockSetTimeout.mockReturnValue(1);

      callback();
    });

    await OrdpoolIndexer.run();

    // results from second run
    expect(OrdpoolIndexer['failureCount']).toBe(0); // Failure count reset on success
    expect(OrdpoolIndexer['batchSize']).toBe(8); // Batch size increased in this scenario
  });
});
