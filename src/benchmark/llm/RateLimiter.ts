/**
 * Rate limiter with token bucket algorithm
 * Ensures API calls respect RPM, TPM, and RPD limits
 */
import type { ModelConfig } from '../types.js';

interface RateLimitState {
  requestsInCurrentMinute: number;
  tokensInCurrentMinute: number;
  requestsToday: number;
  minuteWindowStart: number;
  dayWindowStart: number;
}

export class RateLimiter {
  private config: ModelConfig;
  private state: RateLimitState;
  private readonly MS_PER_MINUTE = 60 * 1000;
  private readonly MS_PER_DAY = 24 * 60 * 60 * 1000;

  constructor(config: ModelConfig) {
    this.config = config;
    this.state = {
      requestsInCurrentMinute: 0,
      tokensInCurrentMinute: 0,
      requestsToday: 0,
      minuteWindowStart: Date.now(),
      dayWindowStart: Date.now(),
    };
  }

  /**
   * Wait until a request can be made without violating rate limits
   * @param estimatedTokens Estimated tokens for the request (default: 500)
   */
  async waitForCapacity(estimatedTokens: number = 500): Promise<void> {
    while (true) {
      this.updateWindows();

      // Check RPD limit
      if (this.state.requestsToday >= this.config.rpd) {
        const msUntilDayReset = this.MS_PER_DAY - (Date.now() - this.state.dayWindowStart);
        throw new Error(
          `Daily request limit (${this.config.rpd}) exceeded. ` +
            `Reset in ${Math.ceil(msUntilDayReset / 1000 / 60)} minutes.`
        );
      }

      // Check RPM limit
      if (this.state.requestsInCurrentMinute >= this.config.rpm) {
        const msUntilMinuteReset =
          this.MS_PER_MINUTE - (Date.now() - this.state.minuteWindowStart);
        await this.sleep(msUntilMinuteReset + 100); // Add 100ms buffer
        continue;
      }

      // Check TPM limit
      if (this.state.tokensInCurrentMinute + estimatedTokens > this.config.tpm) {
        const msUntilMinuteReset =
          this.MS_PER_MINUTE - (Date.now() - this.state.minuteWindowStart);
        await this.sleep(msUntilMinuteReset + 100); // Add 100ms buffer
        continue;
      }

      // All limits satisfied, allow request
      break;
    }

    // Reserve capacity
    this.state.requestsInCurrentMinute++;
    this.state.tokensInCurrentMinute += estimatedTokens;
    this.state.requestsToday++;
  }

  /**
   * Update actual token count after a request completes
   * @param actualTokens Actual tokens used in the request
   * @param estimatedTokens Estimated tokens that were reserved
   */
  updateTokenCount(actualTokens: number, estimatedTokens: number): void {
    // Adjust token count based on actual usage
    const difference = actualTokens - estimatedTokens;
    this.state.tokensInCurrentMinute += difference;
  }

  /**
   * Reset windows if time has passed
   */
  private updateWindows(): void {
    const now = Date.now();

    // Reset minute window
    if (now - this.state.minuteWindowStart >= this.MS_PER_MINUTE) {
      this.state.requestsInCurrentMinute = 0;
      this.state.tokensInCurrentMinute = 0;
      this.state.minuteWindowStart = now;
    }

    // Reset day window
    if (now - this.state.dayWindowStart >= this.MS_PER_DAY) {
      this.state.requestsToday = 0;
      this.state.dayWindowStart = now;
    }
  }

  /**
   * Get current rate limit status
   */
  getStatus(): {
    requestsInMinute: number;
    tokensInMinute: number;
    requestsToday: number;
    limits: {
      rpm: number;
      tpm: number;
      rpd: number;
    };
  } {
    this.updateWindows();
    return {
      requestsInMinute: this.state.requestsInCurrentMinute,
      tokensInMinute: this.state.tokensInCurrentMinute,
      requestsToday: this.state.requestsToday,
      limits: {
        rpm: this.config.rpm,
        tpm: this.config.tpm,
        rpd: this.config.rpd,
      },
    };
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
