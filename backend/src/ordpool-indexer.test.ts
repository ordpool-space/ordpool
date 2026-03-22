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
    // no automatic runs, because it returns a timeoutId
    mockSetTimeout.mockReturnValue(1);
  });

  it('processes tasks with initial batch size', async () => {
    (OrdpoolMissingStats.processMissingStats as jest.Mock).mockResolvedValueOnce(false);

    await OrdpoolIndexer.run();

    expect(OrdpoolMissingStats.processMissingStats).toHaveBeenCalledWith(10);
    expect(OrdpoolIndexer['batchSize']).toBe(10);
    expect(mockSetTimeout).toHaveBeenCalled();
  });

  it('increases batch size if tasks complete quickly', async () => {
    mockDateProvider.now
      .mockReturnValueOnce(0) // Start time
      .mockReturnValueOnce(1000); // 1 second duration

    (OrdpoolMissingStats.processMissingStats as jest.Mock).mockResolvedValueOnce(true);

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['batchSize']).toBe(15); // Batch size increased
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Batch size increased to 15'), 'Ordpool');
    expect(mockSetTimeout).toHaveBeenCalled();
  });

  it('decreases batch size if tasks take too long', async () => {
    mockDateProvider.now
      .mockReturnValueOnce(0) // Start time
      .mockReturnValueOnce(16 * 60 * 1000); // 16 minutes duration

    (OrdpoolMissingStats.processMissingStats as jest.Mock).mockResolvedValueOnce(true);

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['batchSize']).toBe(5); // Batch size decreased
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Batch size decreased to 5'), 'Ordpool');
    expect(mockSetTimeout).toHaveBeenCalled();
  });

  it('reduces batch size on error', async () => {
    mockDateProvider.now.mockReturnValueOnce(0);

    (OrdpoolMissingStats.processMissingStats as jest.Mock).mockRejectedValueOnce(new Error('Simulated failure'));

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['batchSize']).toBe(5); // Batch size halved on failure
    expect(OrdpoolIndexer['failureCount']).toBe(1);
    expect(OrdpoolIndexer['sleepUntil']).toBe(0);
    expect(mockSetTimeout).toHaveBeenCalled();
  });

  it('handles backoff after 5 failures', async () => {
    OrdpoolIndexer['failureCount'] = 4;

    mockDateProvider.now
      .mockReturnValueOnce(0)  // Start time
      .mockReturnValueOnce(1000); // For the sleep until

    (OrdpoolMissingStats.processMissingStats as jest.Mock).mockRejectedValueOnce(new Error('Simulated failure'));

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['batchSize']).toBe(5);
    expect(OrdpoolIndexer['failureCount']).toBe(5);
    expect(OrdpoolIndexer['sleepUntil']).toBe(1000 + 2 * 60 * 1000); // 2-minute cooldown
    expect(mockSetTimeout).toHaveBeenCalled();
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

    expect(mockSetTimeout).toHaveBeenCalledWith(expect.any(Function), 10 * 1000);
  });

  it('resets failure count on success', async () => {
    mockDateProvider.now.mockReturnValue(0);

    // prepare failing run
    (OrdpoolMissingStats.processMissingStats as jest.Mock).mockRejectedValueOnce(new Error('Simulated failure'));

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer['failureCount']).toBe(1);
    expect(OrdpoolIndexer['batchSize']).toBe(5);

    // prepare successful run
    (OrdpoolMissingStats.processMissingStats as jest.Mock).mockResolvedValueOnce(true);

    await OrdpoolIndexer.run();

    // results from second run
    expect(OrdpoolIndexer['failureCount']).toBe(0);
    expect(OrdpoolIndexer['batchSize']).toBe(8); // Batch size increased
  });
});
