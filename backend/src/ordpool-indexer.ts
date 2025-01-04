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

  /**
   * Runs the indexing process. Dynamically adjusts workload based on performance and handles exceptions.
   */
  public async run(): Promise<void> {
    const now = Date.now();

    // Check if the cooldown period is active
    if (this.cooldownUntil > now) {
      logger.warn(`Processing halted until ${new Date(this.cooldownUntil).toISOString()}`);
      return;
    }

    let hasMoreTasks = true;

    while (hasMoreTasks) {
      const startTime = Date.now();

      try {
        hasMoreTasks = await OrdpoolBlocks.processOrdpoolStatsForOldBlocks(this.batchSize);
        const lastDuration = Date.now() - startTime;

        // Reset failure count on success
        this.failureCount = 0;

        // Adjust batch size based on processing time
        if (lastDuration < this.minDuration) {
          this.batchSize = Math.min(this.batchSize + Math.ceil(this.batchSize * 0.5), this.batchSize * 2);
          logger.info(`Batch size increased to ${this.batchSize}. Last duration: ${lastDuration}ms.`);
        } else if (lastDuration > this.maxDuration) {
          this.batchSize = Math.max(Math.ceil(this.batchSize * 0.5), 1);
          logger.info(`Batch size decreased to ${this.batchSize}. Last duration: ${lastDuration}ms.`);
        } else {
          logger.info(`Batch size maintained at ${this.batchSize}. Last duration: ${lastDuration}ms.`);
        }

        // Sleep to maintain the target duration
        const sleepTime = Math.max(0, this.targetDuration - lastDuration);
        if (sleepTime > 0) {
          logger.info(`Sleeping for ${sleepTime}ms.`);
          await this.sleep(sleepTime);
        }
      } catch (error) {
        this.failureCount++;
        logger.err(`Error during batch processing: ${error instanceof Error ? error.message : error}`);

        // Reduce batch size on failure
        this.batchSize = Math.max(Math.ceil(this.batchSize * 0.5), 1);

        // Apply exponential backoff
        const backoff = Math.min(this.backoffTime * (2 ** this.failureCount), 10 * 1000); // Cap at 10s
        logger.warn(`Retrying in ${backoff / 1000}s. Consecutive failures: ${this.failureCount}`);
        await this.sleep(backoff);

        // Halt processing after max failures
        if (this.failureCount >= this.maxFailures) {
          this.cooldownUntil = Date.now() + 5 * 60 * 1000; // Cooldown for 5 minutes
          logger.err(`Max failures reached. Halting processing until ${new Date(this.cooldownUntil).toISOString()}`);
          break;
        }
      }
    }

    if (!hasMoreTasks) {
      logger.info('No more tasks to process for Ordpool Stats.');
    }
  }

  /**
   * Helper method to pause execution for a specified duration.
   * @param ms - The duration to sleep in milliseconds.
   * @returns A promise that resolves after the specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new OrdpoolIndexer();
