/**
 * LLM Client with rate limiting and retry logic
 * Supports Gemini and Gemma models
 */
import axios, { AxiosError } from 'axios';
import type { ModelConfig } from '../types.js';
import { RateLimiter } from './RateLimiter.js';

export interface LLMMessage {
  role: 'user' | 'model';
  content: string;
}

export interface LLMResponse {
  content: string;
  tokensUsed: number;
}

export interface LLMStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalRetries: number;
}

export class LLMClient {
  private config: ModelConfig;
  private apiKey: string;
  private rateLimiter: RateLimiter;
  private stats: LLMStats;
  private readonly minimumIntervalMs: number;
  private lastRequestTimestamp = 0;

  constructor(config: ModelConfig, apiKey: string) {
    this.config = config;
    this.apiKey = apiKey;
    this.rateLimiter = new RateLimiter(config);
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalRetries: 0,
    };
    this.minimumIntervalMs = config.minIntervalMs ?? 0;
  }

  /**
   * Send a prompt to the LLM
   * @param systemPrompt System instructions
   * @param userPrompt User prompt
   * @param estimatedTokens Estimated tokens for rate limiting (default: 500)
   * @returns LLM response
   */
  async prompt(
    systemPrompt: string,
    userPrompt: string,
    estimatedTokens: number = 500
  ): Promise<LLMResponse> {
    // Wait for rate limit capacity
    await this.rateLimiter.waitForCapacity(estimatedTokens);

    this.stats.totalRequests++;

    // Retry logic with exponential backoff
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.stats.totalRetries++;
          // Exponential backoff: 2s, 4s, 8s
          const delayMs = Math.pow(2, attempt) * 1000;
          await this.sleep(delayMs);
        }

        await this.enforceInterRequestDelay();
        this.lastRequestTimestamp = Date.now();
        const response = await this.makeAPICall(systemPrompt, userPrompt);

        // Update actual token usage
        this.rateLimiter.updateTokenCount(response.tokensUsed, estimatedTokens);

        this.stats.successfulRequests++;
        return response;
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          this.stats.failedRequests++;
          throw error;
        }

        // Log retry attempt
        console.error(
          `[LLMClient] Attempt ${attempt + 1}/${maxRetries} failed: ${(error as Error).message}`
        );

        // If this was the last attempt, throw
        if (attempt === maxRetries - 1) {
          this.stats.failedRequests++;
          throw error;
        }
      }
    }

    // Should not reach here, but TypeScript requires it
    this.stats.failedRequests++;
    throw lastError || new Error('Unknown error in LLM request');
  }

  /**
   * Make the actual API call to the LLM
   */
  private async makeAPICall(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
    const url = `${this.config.apiEndpoint}?key=${this.apiKey}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `${systemPrompt}\n\n${userPrompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    };

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout
      });

      // Extract content from Gemini API response
      const content =
        response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';

      // Estimate token usage (Gemini API doesn't always return token count)
      const tokensUsed = response.data?.usageMetadata?.totalTokenCount || this.estimateTokens(content);

      return {
        content,
        tokensUsed,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const message = axiosError.response?.data || axiosError.message;

        throw new Error(`API Error (${status}): ${JSON.stringify(message)}`);
      }
      throw error;
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      // Retry on 429 (rate limit), 500, 502, 503, 504 (server errors)
      return status === 429 || (status !== undefined && status >= 500 && status < 600);
    }
    // Retry on network errors
    return error instanceof Error && error.message.includes('ECONNRESET');
  }

  /**
   * Estimate token count for rate limiting
   * Rough estimate: 1 token ≈ 4 characters
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Ensure a minimum delay between consecutive API calls when required
   */
  private async enforceInterRequestDelay(): Promise<void> {
    if (!this.minimumIntervalMs || this.lastRequestTimestamp === 0) {
      return;
    }
    const elapsed = Date.now() - this.lastRequestTimestamp;
    const waitTime = this.minimumIntervalMs - elapsed;
    if (waitTime > 0) {
      await this.sleep(waitTime);
    }
  }

  /**
   * Get current statistics
   */
  getStats(): LLMStats {
    return { ...this.stats };
  }

  /**
   * Get rate limiter status
   */
  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
