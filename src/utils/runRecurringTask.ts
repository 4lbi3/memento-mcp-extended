import { logger } from './logger.js';
import { classifyError, ErrorCategory } from './errors.js';
import { calculateRetryDelay, type RetryPolicy } from './retry.js';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function runRecurringTask(
  taskName: string,
  interval: number,
  task: () => Promise<void>,
  retryPolicy: RetryPolicy
): Promise<void> {
  let transientAttempts = 0;

  while (true) {
    try {
      await task();
      transientAttempts = 0;
    } catch (error: unknown) {
      const category = classifyError(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`${taskName} failed`, { error: errorMessage, category });

      if (category === ErrorCategory.TRANSIENT) {
        transientAttempts += 1;
        const delay = calculateRetryDelay(transientAttempts, retryPolicy);
        logger.warn(`${taskName} will retry after transient failure`, {
          attempt: transientAttempts,
          delay,
          category,
        });
        await wait(delay);
        continue;
      }

      if (category === ErrorCategory.CRITICAL) {
        logger.error(`${taskName} halted due to a critical error`, {
          error: errorMessage,
          category,
        });
        break;
      }

      transientAttempts = 0;
    }

    await wait(interval);
  }
}
