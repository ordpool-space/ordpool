import OrdpoolBlocks from './api/ordpool-blocks';
import logger from './logger';

/**
 * Class responsible for indexing missing Ordpool statistics.
 * Dynamically adjusts workload (batch size) and handles exceptions.
 */
class OrdpoolIndexer {

  /** Initial batch size for processing blocks */
  public batchSize = 10;

  /** Minimum processing duration threshold for dynamic scaling */
  private minDuration = 5 * 60 * 1000; // 5 minutes

  /** Maximum processing duration threshold for dynamic scaling */
  private maxDuration = 15 * 60 * 1000; // 15 minutes

  /** Timestamp until the next run is allowed */
  public sleepUntil: number = 0;

  /** Timeout handler, overrideable for testing */
  public setTimeoutFn: typeof setTimeout = setTimeout;

  /** Date provider, overrideable for testing */
  public dateProvider: { now: () => number } = { now: () => Date.now() };

  /**
   * Runs the indexing process. Adjusts workload based on processing time.
   * If all blocks are processed, the process enters a rest state for 10 minutes.
   */
  public async run(): Promise<void> {
    const now = this.dateProvider.now();

    // Check if the cooldown period is active
    if (now < this.sleepUntil) {
      logger.info(`Processing paused until ${new Date(this.sleepUntil).toISOString()}`);
      return;
    }

    const startTime = now;
    let hasMoreTasks = false;

    try {
      hasMoreTasks = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(this.batchSize);
    } catch (error) {
      logger.err(`Error during batch processing: ${error instanceof Error ? error.message : error}`);
      // Apply a backoff mechanism
      this.sleepUntil = this.dateProvider.now() + 30 * 1000; // 30 seconds
      return;
    }

    const duration = this.dateProvider.now() - startTime;

    // Adjust batch size based on duration
    if (duration < this.minDuration) {
      this.batchSize = Math.min(this.batchSize + Math.ceil(this.batchSize * 0.5), this.batchSize * 2);
      logger.info(`Batch size increased to ${this.batchSize}. Duration: ${duration}ms.`);
    } else if (duration > this.maxDuration) {
      this.batchSize = Math.max(Math.ceil(this.batchSize * 0.5), 1);
      logger.info(`Batch size decreased to ${this.batchSize}. Duration: ${duration}ms.`);
    } else {
      logger.info(`Batch size maintained at ${this.batchSize}. Duration: ${duration}ms.`);
    }

    // If no more tasks, enter rest state
    if (!hasMoreTasks) {
      this.sleepUntil = this.dateProvider.now() + 10 * 60 * 1000; // 10 minutes
      logger.info('No more tasks to process. Entering rest state for 10 minutes.');
      return;
    }

    // Schedule the next run dynamically
    this.scheduleNextRun();
  }

  /**
   * Schedules the next run dynamically based on the sleepUntil timestamp.
   */
  private scheduleNextRun(): void {
    const now = this.dateProvider.now();
    const remainingTime = Math.max(0, this.sleepUntil - now);
    const interval = Math.min(remainingTime, 10 * 1000); // Check every 10 seconds

    this.setTimeoutFn(() => this.run(), interval);
  }
}

export default new OrdpoolIndexer();
