import OrdpoolBlocks from './api/ordpool-blocks';
import logger from './logger';

/**
 * Class responsible for indexing missing Ordpool statistics.
 * Dynamically adjusts workload (batch size) based on processing time and handles exceptions.
 */
class OrdpoolIndexer {

  /** Batch size for processing blocks */
  private batchSize = 10;

  /** Target processing duration for a batch in milliseconds */
  private targetDuration = 10 * 60 * 1000; // 10 minutes

  /** Minimum processing duration threshold for dynamic scaling */
  private minDuration = 5 * 60 * 1000; // 5 minutes

  /** Maximum processing duration threshold for dynamic scaling */
  private maxDuration = 15 * 60 * 1000; // 15 minutes

  /** Counter for consecutive failures */
  private failureCount = 0;

  /** Maximum allowed consecutive failures before entering cooldown */
  private maxFailures = 5;

  /** Base backoff time in milliseconds */
  private backoffTime = 1000; // 1 second

  /** Timestamp indicating when processing can resume after cooldown */
  private cooldownUntil: number = 0;

  /** Timeout handler, overrideable for testing */
  public setTimeoutFn: typeof setTimeout = setTimeout;

  /** Date provider, overrideable for testing */
  public dateProvider: { now: () => number } = { now: () => Date.now() };

  /**
   * Runs the indexing process. Dynamically adjusts workload based on performance and handles exceptions.
   */
  public async run(): Promise<void> {
    const startTime = this.dateProvider.now();

    // Check if the cooldown period is active
    if (this.cooldownUntil > startTime) {
      logger.warn(`Processing halted until ${new Date(this.cooldownUntil).toISOString()}`);
      return;
    }

    try {
      const hasMoreTasks = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(this.batchSize);

      // Reset failure count on success
      this.failureCount = 0;

      const endTime = this.dateProvider.now();
      const duration = endTime - startTime;

      this.adjustBatchSize(duration);

      if (!hasMoreTasks) {
        logger.info('No more tasks to process for Ordpool Stats.');
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Adjusts the batch size based on the processing duration.
   * @param duration - The total time taken for processing the batch.
   */
  private adjustBatchSize(duration: number): void {
    if (duration < this.minDuration) {
      this.batchSize = Math.min(this.batchSize + Math.ceil(this.batchSize * 0.5), this.batchSize * 2);
      logger.info(`Batch size increased to ${this.batchSize}. Duration: ${duration}ms.`);
    } else if (duration > this.maxDuration) {
      this.batchSize = Math.max(Math.ceil(this.batchSize * 0.5), 1);
      logger.info(`Batch size decreased to ${this.batchSize}. Duration: ${duration}ms.`);
    } else {
      logger.info(`Batch size maintained at ${this.batchSize}. Duration: ${duration}ms.`);
    }
  }

  /**
   * Handles errors during processing by adjusting batch size and applying backoff/cooldown logic.
   * @param error - The error encountered during processing.
   */
  private async handleError(error: unknown): Promise<void> {
    this.failureCount++;
    logger.err(`Error during batch processing: ${error instanceof Error ? error.message : error}`);

    // Reduce batch size and apply exponential backoff
    this.batchSize = Math.max(Math.ceil(this.batchSize * 0.5), 1);
    const backoff = Math.min(this.backoffTime * (2 ** this.failureCount), 10 * 1000); // Cap at 10s
    logger.warn(`Retrying in ${backoff / 1000}s. Consecutive failures: ${this.failureCount}`);
    await this.sleep(backoff);

    // Enter cooldown after max failures
    if (this.failureCount >= this.maxFailures) {
      this.cooldownUntil = this.dateProvider.now() + 5 * 60 * 1000; // Cooldown for 5 minutes
      logger.err(`Max failures reached. Halting processing until ${new Date(this.cooldownUntil).toISOString()}`);
    }
  }

  /**
   * Pauses execution for the specified duration.
   * @param ms - The duration to sleep in milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.setTimeoutFn(resolve, ms));
  }
}

export default new OrdpoolIndexer();
