import OrdpoolBlocks from './api/ordpool-blocks';
import OrdpoolIndexer from './ordpool-indexer';

jest.mock('./api/ordpool-blocks');
jest.mock('./logger', () => ({
  info: jest.fn(),
  err: jest.fn(),
}));

describe('OrdpoolIndexer', () => {
  let mockDateProvider: { now: jest.Mock };
  let mockSetTimeout: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDateProvider = { now: jest.fn() };
    mockSetTimeout = jest.fn();

    OrdpoolIndexer.batchSize = 10;
    OrdpoolIndexer.sleepUntil = 0;
    OrdpoolIndexer.setTimeoutFn = mockSetTimeout as any;
    OrdpoolIndexer.dateProvider = mockDateProvider;

    mockDateProvider.now.mockReturnValue(0); // Start time
  });

  it('processes tasks with initial batch size', async () => {
    mockDateProvider.now.mockReturnValueOnce(0).mockReturnValueOnce(6 * 60 * 1000); // 6 minutes duration
    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock).mockResolvedValue(true);

    await OrdpoolIndexer.run();

    expect(OrdpoolBlocks.processOrdpoolStatsForOldBlocks).toHaveBeenCalledWith(10); // Initial batch size
    expect(OrdpoolIndexer.sleepUntil).toBe(0); // No sleep needed after processing
  });

  it('increases batch size if tasks complete quickly', async () => {
    mockDateProvider.now.mockReturnValueOnce(0).mockReturnValueOnce(1 * 60 * 1000); // 1 minute duration
    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock).mockResolvedValue(true);

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer.batchSize).toBe(15); // Batch size increased
    expect(OrdpoolIndexer.sleepUntil).toBe(0); // No sleep needed
  });

  it('decreases batch size if tasks take too long', async () => {
    mockDateProvider.now.mockReturnValueOnce(0).mockReturnValueOnce(16 * 60 * 1000); // 16 minutes duration
    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock).mockResolvedValue(true);

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer.batchSize).toBe(5); // Batch size decreased
    expect(OrdpoolIndexer.sleepUntil).toBe(0); // No sleep needed
  });

  it('handles backoff after failure', async () => {
    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock).mockRejectedValue(new Error('Simulated failure'));

    await OrdpoolIndexer.run();

    expect(OrdpoolIndexer.batchSize).toBe(10); // Batch size not halved on failure (due to the early exit)
    expect(OrdpoolIndexer.sleepUntil).toBe(30_000); // 30 seconds backoff applied
  });

  it('enters rest state after completion', async () => {
    (OrdpoolBlocks.processOrdpoolStatsForOldBlocks as jest.Mock).mockResolvedValue(false); // No tasks left

    await OrdpoolIndexer.run();

    const expectedRestTime = 10 * 60 * 1000; // 10 minutes rest
    expect(OrdpoolIndexer.sleepUntil).toBe(mockDateProvider.now() + expectedRestTime);
    expect(mockSetTimeout).not.toHaveBeenCalled(); // No recursive scheduling
  });

  it('schedules the next run dynamically', async () => {
    OrdpoolIndexer.sleepUntil = 10 * 1000; // 10 seconds in the future
    mockDateProvider.now.mockReturnValue(1);

    await OrdpoolIndexer.run();

    expect(mockSetTimeout).toHaveBeenCalledWith(expect.any(Function), 10 * 1000); // Schedule in 10 seconds
  });
});
