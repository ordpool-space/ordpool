import OrdpoolIndexer from './ordpool-indexer';
import OrdpoolMissingBlocks from './api/ordpool-missing-blocks';
import OrdpoolMissingStats from './api/ordpool-missing-stats';
import logger from './logger';

jest.mock('./api/ordpool-missing-blocks');
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
    // no automatic runs, because it returns a timeoutId
    mockSetTimeout.mockReturnValue(1);
  });

  it('processes tasks with initial batch size', async () => {

    (OrdpoolMissingBlocks.processMissingBlocks as jest.Mock).mockResolvedValueOnce(false);
    (OrdpoolMissingStats.processMissingStats as jest.Mock).mockResolvedValueOnce(false);

    await OrdpoolIndexer.run();

    expect(OrdpoolMissingBlocks.processMissingBlocks).toHaveBeenCalledWith(10); // Initial batch size
    expect(OrdpoolMissingStats.processMissingStats).toHaveBeenCalledWith(10); // Initial batch size
    expect(OrdpoolIndexer['batchSize']).toBe(10);
    expect(mockSetTimeout).toHaveBeenCalled(); // scheduleNextRun
  });

  it('increases batch size if tasks complete quickly', async () => {
    mockDateProvider.now
      .mockReturnValueOnce(0) // Start time
      .mockReturnValueOnce(1000); // 1 second duration

    (OrdpoolMissingBlocks.processMissingBlocks as jest.Mock).mockResolvedValueOnce(true);
    (OrdpoolMissingStats.processMissingStats as jest.Mock).mockResolvedValueOnce(true);

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['batchSize']).toBe(15); // Batch size increased
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Batch size increased to 15'), 'Ordpool');
    expect(mockSetTimeout).toHaveBeenCalled(); // scheduleNextRun
  });

  it('decreases batch size if tasks take too long', async () => {
    mockDateProvider.now
      .mockReturnValueOnce(0) // Start time
      .mockReturnValueOnce(16 * 60 * 1000); // 16 minutes duration

    (OrdpoolMissingBlocks.processMissingBlocks as jest.Mock).mockResolvedValueOnce(true); // Ensure termination
    (OrdpoolMissingStats.processMissingStats as jest.Mock).mockResolvedValueOnce(true); // Ensure termination

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['batchSize']).toBe(5); // Batch size decreased
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Batch size decreased to 5'), 'Ordpool');
    expect(mockSetTimeout).toHaveBeenCalled(); // scheduleNextRun
  });

  it('has no backoff after first error (OrdpoolBlocks will switch API)', async () => {
    mockDateProvider.now
      .mockReturnValueOnce(0); // Start time

    (OrdpoolMissingBlocks.processMissingBlocks as jest.Mock).mockRejectedValueOnce(new Error('Simulated failure'));
    // call to OrdpoolMissingStats will not be reached

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

    (OrdpoolMissingBlocks.processMissingBlocks as jest.Mock) .mockRejectedValueOnce(new Error('Simulated failure'));
    // call to OrdpoolMissingStats will not be reached

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['batchSize']).toBe(5); // Batch size halved on failure
    expect(OrdpoolIndexer['failureCount']).toBe(5); // Failure count incremented
    expect(OrdpoolIndexer['sleepUntil']).toBe(1000 + 2 * 60 * 1000); // 2-minute cooldown
    expect(mockSetTimeout).toHaveBeenCalled(); // scheduleNextRun
  });

  it('enters rest state after completion', async () => {
    (OrdpoolMissingStats.processMissingStats as jest.Mock)
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

    // prepare failing run
    (OrdpoolMissingBlocks.processMissingBlocks as jest.Mock).mockRejectedValueOnce(new Error('Simulated failure'));
    // call to OrdpoolMissingStats will not be reached

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['failureCount']).toBe(1); // Failure count must reset on success
    expect(OrdpoolIndexer['batchSize']).toBe(5); // Batch size decreased

    // prepare successfull run
    (OrdpoolMissingBlocks.processMissingBlocks as jest.Mock).mockResolvedValueOnce(true);
    (OrdpoolMissingStats.processMissingStats as jest.Mock).mockResolvedValueOnce(true);

    await OrdpoolIndexer.run();

    // results from second run
    expect(OrdpoolIndexer['failureCount']).toBe(0); // Failure count reset on success
    expect(OrdpoolIndexer['batchSize']).toBe(8); // Batch size increased in this scenario
  });
});
