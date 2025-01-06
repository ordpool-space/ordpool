import OrdpoolBlocks from './api/ordpool-blocks';
import logger from './logger';


/**
 * Class responsible for indexing missing Ordpool statistics.
 * Dynamically adjusts workload based on performance and handles exceptions.
 */
class OrdpoolIndexer {

  /** Minimum processing duration threshold for dynamic scaling */
  private static readonly MIN_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  /** Maximum processing duration threshold for dynamic scaling */
  private static readonly MAX_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  /** Cooldown time after no more work is left */
  private static readonly REST_INTERVAL_WORK_DONE_MS = 10 * 60 * 1000; // 10 minutes

  /** Cooldown time after consecutive errors */
  private static readonly REST_INTERVAL_ERROR_MS = 2 * 60 * 1000; // 2 minutes

  /** Initial batch size for processing blocks */
  private batchSize = 10;

  /** Counter for consecutive failures */
  private failureCount = 0;

  /** Maximum allowed consecutive failures before entering cooldown */
  private maxFailures = 5;

  /** Timestamp indicating when processing can resume */
  private sleepUntil = 0;

  /** Timeout ID for scheduling the next run */
  private timeoutId: NodeJS.Timeout | null = null;

  /** Indicates if a task is currently running */
  private isRunning = false;

  /** Timeout handler, overrideable for testing */
  public setTimeoutFn: typeof setTimeout = setTimeout;

  /** Date provider, overrideable for testing */
  public dateProvider: { now: () => number } = { now: () => Date.now() };

  /**
   * Runs the indexing process. Dynamically adjusts workload based on performance and handles exceptions.
   */
  public async run(): Promise<void> {
    if (this.isRunning) {
      logger.debug('Indexer is already running. Skipping new invocation.');
      return;
    }

    const now = this.dateProvider.now();

    // Check if sleepUntil is active
    if (now < this.sleepUntil) {
      logger.debug(`Processing paused until ${new Date(this.sleepUntil).toISOString()}`);
      this.scheduleNextRun(this.sleepUntil - now);
      return;
    }

    this.isRunning = true;
    const startTime = now;

    try {
      const hasMoreWork = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(this.batchSize);

      const duration = this.dateProvider.now() - startTime;

      if (!hasMoreWork) {
        logger.info('No more tasks to process. Entering rest state.');
        this.sleepUntil = this.dateProvider.now() + OrdpoolIndexer.REST_INTERVAL_WORK_DONE_MS;
        this.isRunning = false;
        return;
      }

      // Reset failure count on success
      this.failureCount = 0;

      // Adjust batch size based on processing duration
      if (duration < OrdpoolIndexer.MIN_DURATION_MS) {
        this.batchSize = Math.min(this.batchSize + Math.ceil(this.batchSize * 0.5), this.batchSize * 2);
        logger.info(`Batch size increased to ${this.batchSize}. Duration: ${duration}ms.`);
      } else if (duration > OrdpoolIndexer.MAX_DURATION_MS) {
        this.batchSize = Math.max(Math.ceil(this.batchSize * 0.5), 1);
        logger.info(`Batch size decreased to ${this.batchSize}. Duration: ${duration}ms.`);
      } else {
        logger.info(`Batch size maintained at ${this.batchSize}. Duration: ${duration}ms.`);
      }
    } catch (error) {
      this.failureCount++;
      logger.err(`Error during batch processing: ${error instanceof Error ? error.message : error}`);

      // Reduce batch size on failure
      this.batchSize = Math.max(Math.ceil(this.batchSize * 0.5), 1);
      logger.warn(`Batch size reduced to ${this.batchSize}. Consecutive failures: ${this.failureCount}`);

      // Enter cooldown after max failures
      if (this.failureCount >= this.maxFailures) {
        this.sleepUntil = this.dateProvider.now() + OrdpoolIndexer.REST_INTERVAL_ERROR_MS;
        logger.err(`Max failures reached. Pausing until ${new Date(this.sleepUntil).toISOString()}`);
      }
    } finally {
      this.isRunning = false;
      this.scheduleNextRun(10 * 1000); // Check again in 10 seconds
    }
  }

  /**
   * Schedules the next run of the indexer.
   * Ensures that only one timeout is active at any time.
   * @param interval - Time in milliseconds until the next run.
   */
  private scheduleNextRun(interval: number): void {
    if (this.timeoutId) {
      return; // do nothing
    }

    this.timeoutId = this.setTimeoutFn(() => {
      this.timeoutId = null;
      this.run();
    }, interval);
  }
}

export default new OrdpoolIndexer();

