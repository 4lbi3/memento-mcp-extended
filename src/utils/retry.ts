export interface RetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitterFactor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  multiplier: 2,
  jitterFactor: 0.1,
};

export function calculateRetryDelay(attempt: number, policy: RetryPolicy): number {
  const exponentialDelay = policy.baseDelayMs * Math.pow(policy.multiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, policy.maxDelayMs);
  const jitter = cappedDelay * policy.jitterFactor * (Math.random() - 0.5);
  return Math.max(0, Math.round(cappedDelay + jitter));
}
