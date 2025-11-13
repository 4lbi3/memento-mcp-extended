import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runRecurringTask } from '../runRecurringTask.js';
import type { RetryPolicy } from '../retry.js';
import type { Neo4jError } from 'neo4j-driver';

const CRITICAL_NEO4J_ERROR: Neo4jError = {
  name: 'Neo4jError',
  code: 'Neo.DatabaseError.General.UnknownError',
  message: 'critical failure',
} as unknown as Neo4jError;

describe('runRecurringTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries after transient failures before stopping on a critical error', async () => {
    const policy: RetryPolicy = {
      baseDelayMs: 10,
      maxDelayMs: 100,
      multiplier: 2,
      jitterFactor: 0,
    };
    const callOrder: string[] = [];
    let invocation = 0;

    const task = vi.fn(async () => {
      const current = invocation++;
      callOrder.push(`call-${current}`);

      if (current === 0) {
        const error = new Error('transient');
        (error as { code?: string }).code = 'ECONNRESET';
        throw error;
      }

      if (current === 1) {
        return;
      }

      throw CRITICAL_NEO4J_ERROR;
    });

    const runner = runRecurringTask('processing', 50, task, policy);

    await vi.advanceTimersByTimeAsync(10);
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(50);
    await vi.runOnlyPendingTimersAsync();

    await expect(runner).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(3);
    expect(callOrder).toEqual(['call-0', 'call-1', 'call-2']);
  });

  it('continues after permanent failures before halting on a critical error', async () => {
    const policy: RetryPolicy = {
      baseDelayMs: 5,
      maxDelayMs: 50,
      multiplier: 2,
      jitterFactor: 0,
    };
    let invocation = 0;
    const task = vi.fn(async () => {
      const attempt = invocation++;

      if (attempt === 0) {
        const error = new Error('permanent failure');
        (error as { response?: { status: number } }).response = { status: 400 };
        throw error;
      }

      if (attempt === 1) {
        return;
      }

      throw CRITICAL_NEO4J_ERROR;
    });

    const runner = runRecurringTask('cleanup', 20, task, policy);

    await vi.advanceTimersByTimeAsync(20);
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(20);
    await vi.runOnlyPendingTimersAsync();

    await expect(runner).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(3);
  });
});
