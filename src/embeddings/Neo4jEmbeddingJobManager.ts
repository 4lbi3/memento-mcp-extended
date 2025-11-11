import { LRUCache } from 'lru-cache';
import type { StorageProvider } from '../storage/StorageProvider.js';
import type { EmbeddingService } from './EmbeddingService.js';
import type { Entity } from '../KnowledgeGraphManager.js';
import type { EntityEmbedding } from '../types/entity-embedding.js';
import { Neo4jJobStore, type EnqueueJobParams, type JobProcessResults, type QueueStatus } from '../storage/neo4j/Neo4jJobStore.js';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * Interface for embedding storage provider, extending the base provider
 */
interface EmbeddingStorageProvider extends StorageProvider {
  /**
   * Get an entity by name
   */
  getEntity(entityName: string): Promise<Entity | null>;

  /**
   * Store an entity vector embedding
   */
  storeEntityVector(entityName: string, embedding: EntityEmbedding): Promise<void>;
}

/**
 * Interface for cache options
 */
interface CacheOptions {
  size: number;
  ttl: number;
  // For test compatibility
  maxItems?: number;
  ttlHours?: number;
}

/**
 * Interface for rate limiting options
 */
interface RateLimiterOptions {
  tokensPerInterval: number;
  interval: number;
}

/**
 * Interface for a logger
 */
interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Interface for a cached embedding entry
 */
interface CachedEmbedding {
  embedding: number[];
  timestamp: number;
  model: string;
}

/**
 * Default logger implementation
 */
const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Neo4j-backed embedding job manager for semantic search
 */
export class Neo4jEmbeddingJobManager {
  private storageProvider: EmbeddingStorageProvider;
  private embeddingService: EmbeddingService;
  private jobStore: Neo4jJobStore;
  public rateLimiter: {
    tokens: number;
    lastRefill: number;
    tokensPerInterval: number;
    interval: number;
  };
  public cache: LRUCache<string, CachedEmbedding>;
  private cacheOptions: CacheOptions = { size: 1000, ttl: 3600000 };
  private logger: Logger;
  private workerId: string;

  /**
   * Creates a new Neo4j embedding job manager
   *
   * @param storageProvider - Provider for entity storage
   * @param embeddingService - Service to generate embeddings
   * @param jobStore - Neo4j job store for queue management
   * @param rateLimiterOptions - Optional configuration for rate limiting
   * @param cacheOptions - Optional configuration for caching
   * @param logger - Optional logger for operation logging
   * @param workerId - Unique identifier for this worker instance
   */
  constructor(
    storageProvider: EmbeddingStorageProvider,
    embeddingService: EmbeddingService,
    jobStore: Neo4jJobStore,
    rateLimiterOptions?: RateLimiterOptions | null,
    cacheOptions?: CacheOptions | null,
    logger?: Logger | null,
    workerId?: string
  ) {
    this.storageProvider = storageProvider;
    this.embeddingService = embeddingService;
    this.jobStore = jobStore;
    this.logger = logger || nullLogger;
    this.workerId = workerId || `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Setup rate limiter with defaults
    const defaultRateLimiter = {
      tokensPerInterval: 60,
      interval: 60 * 1000,
    };

    const rateOptions = rateLimiterOptions || defaultRateLimiter;

    this.rateLimiter = {
      tokens: rateOptions.tokensPerInterval,
      lastRefill: Date.now(),
      tokensPerInterval: rateOptions.tokensPerInterval,
      interval: rateOptions.interval,
    };

    // Setup LRU cache
    if (cacheOptions) {
      // Support both API styles (tests use maxItems/ttlHours)
      this.cacheOptions = {
        size: cacheOptions.size || cacheOptions.maxItems || 1000,
        ttl:
          cacheOptions.ttl ||
          (cacheOptions.ttlHours ? Math.round(cacheOptions.ttlHours * 60 * 60 * 1000) : 3600000),
      };
    }

    this.cache = new LRUCache({
      max: this.cacheOptions.size,
      ttl: Math.max(1, Math.round(this.cacheOptions.ttl)),
      updateAgeOnGet: true,
      allowStale: false,
      // Use a ttlAutopurge option to ensure items are purged when TTL expires
      ttlAutopurge: true,
    });

    this.logger.info('Neo4jEmbeddingJobManager initialized', {
      cacheSize: this.cacheOptions.size,
      cacheTtl: this.cacheOptions.ttl,
      rateLimit: `${this.rateLimiter.tokensPerInterval} per ${this.rateLimiter.interval}ms`,
      workerId: this.workerId,
    });
  }

  /**
   * Schedule an entity for embedding generation
   *
   * @param entityName - Name of the entity to generate embedding for
   * @param priority - Optional priority (higher priority jobs are processed first)
   * @returns Job ID if enqueued, null if already exists
   */
  async scheduleEntityEmbedding(entityName: string, priority = 1): Promise<string | null> {
    // Verify entity exists
    const entity = await this.storageProvider.getEntity(entityName);
    if (!entity) {
      const error = `Entity ${entityName} not found`;
      this.logger.error('Failed to schedule embedding', { entityName, error });
      throw new Error(error);
    }

    // Get model info for job parameters
    const modelInfo = this.embeddingService.getModelInfo();

    // Enqueue the job
    const jobParams: EnqueueJobParams = {
      entity_uid: entityName,
      model: modelInfo.name,
      version: String(entity.version ?? 1),
      priority,
    };

    const jobId = await this.jobStore.enqueueJob(jobParams);

    if (jobId) {
      this.logger.info('Scheduled embedding job', {
        jobId,
        entityName,
        priority,
        model: modelInfo.name,
      });
    } else {
      this.logger.debug('Job already exists for entity', {
        entityName,
        model: modelInfo.name,
      });
    }

    return jobId;
  }

  /**
   * Process a batch of pending embedding jobs
   *
   * @param batchSize - Maximum number of jobs to process
   * @param lockDuration - How long to lock jobs for processing (default: 5 minutes)
   * @returns Result statistics
   */
  async processJobs(batchSize = 10, lockDuration = 5 * 60 * 1000): Promise<JobProcessResults> {
    this.logger.info('Starting job processing', { batchSize, lockDuration });

    // Lease jobs for processing
    const leasedJobs = await this.jobStore.leaseJobs(batchSize, this.workerId, lockDuration);
    this.logger.debug('Leased jobs for processing', { count: leasedJobs.length });

    // Initialize counters
    const result: JobProcessResults = {
      processed: 0,
      successful: 0,
      failed: 0,
    };

    // Process each leased job
    for (const job of leasedJobs) {
      // Check rate limiter before processing
      const rateLimitCheck = this._checkRateLimiter();
      if (!rateLimitCheck.success) {
        this.logger.warn('Rate limit reached, pausing job processing', {
          remaining: leasedJobs.length - result.processed,
        });
        break; // Stop processing jobs if rate limit is reached
      }

      this.logger.info('Processing embedding job', {
        jobId: job.id,
        entityName: job.entity_uid,
        attempt: job.attempts,
        maxAttempts: job.max_attempts,
      });

      try {
        // Get the entity
        const entity = await this.storageProvider.getEntity(job.entity_uid);

        if (!entity) {
          throw new Error(`Entity ${job.entity_uid} not found`);
        }

        // Log entity details for debugging
        this.logger.debug('Retrieved entity for embedding', {
          entityName: job.entity_uid,
          entityType: entity.entityType,
          hasObservations: entity.observations ? 'yes' : 'no',
          observationsType: entity.observations ? typeof entity.observations : 'undefined',
          observationsLength:
            entity.observations && Array.isArray(entity.observations)
              ? entity.observations.length
              : 'n/a',
        });

        // Prepare text for embedding
        const text = this._prepareEntityText(entity);

        // Try to get from cache or generate new embedding
        this.logger.debug('Generating embedding for entity', { entityName: job.entity_uid });
        const embedding = await this._getCachedEmbeddingOrGenerate(text);

        // Store the embedding with the entity
        this.logger.debug('Storing entity vector', {
          entityName: job.entity_uid,
          vectorLength: embedding.length,
          model: job.model,
        });

        await this.storageProvider.storeEntityVector(job.entity_uid, {
          vector: embedding,
          model: job.model,
          lastUpdated: Date.now(),
        });

        // Complete the job
        const completed = await this.jobStore.completeJob(job.id, this.workerId);
        if (!completed) {
          this.logger.warn('Failed to mark job as completed', { jobId: job.id });
        }

        this.logger.info('Successfully processed embedding job', {
          jobId: job.id,
          entityName: job.entity_uid,
          model: job.model,
          dimensions: embedding.length,
        });

        result.successful++;
      } catch (error: unknown) {
        // Handle failures
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        this.logger.error('Failed to process embedding job', {
          jobId: job.id,
          entityName: job.entity_uid,
          error: errorMessage,
          errorStack,
          attempt: job.attempts,
          maxAttempts: job.max_attempts,
        });

        // Fail the job (this will mark as failed or retry based on attempts)
        const failed = await this.jobStore.failJob(job.id, this.workerId, errorMessage);
        if (!failed) {
          this.logger.warn('Failed to mark job as failed', { jobId: job.id });
        }

        result.failed++;
      }

      result.processed++;
    }

    // Send heartbeat for any remaining leased jobs (in case of early termination)
    if (leasedJobs.length > result.processed) {
      const remainingJobIds = leasedJobs.slice(result.processed).map(job => job.id);
      await this.jobStore.heartbeatJobs(remainingJobIds, this.workerId, lockDuration);
    }

    // Log job processing results
    const queueStatus = await this.jobStore.getQueueStatus();
    this.logger.info('Job processing complete', {
      processed: result.processed,
      successful: result.successful,
      failed: result.failed,
      remaining: queueStatus.pending,
    });

    return result;
  }

  /**
   * Get the current status of the job queue
   *
   * @returns Queue statistics
   */
  async getQueueStatus(): Promise<QueueStatus> {
    return await this.jobStore.getQueueStatus();
  }

  /**
   * Retry failed embedding jobs
   *
   * @returns Number of jobs reset for retry
   */
  async retryFailedJobs(): Promise<number> {
    const resetCount = await this.jobStore.retryFailedJobs();
    this.logger.info('Reset failed jobs for retry', { count: resetCount });
    return resetCount;
  }

  /**
   * Clean up old completed jobs
   *
   * @param threshold - Age in milliseconds after which to delete completed jobs, defaults to 7 days
   * @returns Number of jobs cleaned up
   */
  async cleanupJobs(threshold?: number): Promise<number> {
    const deletedCount = await this.jobStore.cleanupJobs(threshold);
    this.logger.info('Cleaned up old completed jobs', { count: deletedCount });
    return deletedCount;
  }

  /**
   * Send heartbeat for all currently leased jobs
   *
   * @param lockDuration - How long to extend the lock
   * @returns Number of jobs heartbeated
   */
  async heartbeatJobs(lockDuration = 5 * 60 * 1000): Promise<number> {
    // For now, we don't track which jobs we have leased, so this is a no-op
    // In a real implementation, we'd track leased jobs and heartbeat them
    this.logger.debug('Heartbeat requested but not implemented for tracking leased jobs');
    return 0;
  }

  /**
   * Check rate limiter and consume a token if available
   *
   * @private
   * @returns Object with success flag
   */
  _checkRateLimiter(): { success: boolean } {
    const now = Date.now();
    const elapsed = now - this.rateLimiter.lastRefill;

    // If enough time has passed, refill tokens
    if (elapsed >= this.rateLimiter.interval) {
      // Calculate how many full intervals have passed
      const intervals = Math.floor(elapsed / this.rateLimiter.interval);

      // Completely refill tokens (don't accumulate beyond max)
      this.rateLimiter.tokens = this.rateLimiter.tokensPerInterval;

      // Update last refill time, keeping track of remaining time
      this.rateLimiter.lastRefill = now;

      this.logger.debug('Refilled rate limiter tokens', {
        current: this.rateLimiter.tokens,
        max: this.rateLimiter.tokensPerInterval,
        intervals,
      });
    }

    // If we have tokens, consume one and return success
    if (this.rateLimiter.tokens > 0) {
      this.rateLimiter.tokens--;

      this.logger.debug('Consumed rate limiter token', {
        remaining: this.rateLimiter.tokens,
        max: this.rateLimiter.tokensPerInterval,
      });

      return { success: true };
    }

    // No tokens available
    this.logger.warn('Rate limit exceeded', {
      availableTokens: 0,
      maxTokens: this.rateLimiter.tokensPerInterval,
      nextRefillIn: this.rateLimiter.interval - (now - this.rateLimiter.lastRefill),
    });

    return { success: false };
  }

  /**
   * Get the current status of the rate limiter
   *
   * @returns Rate limiter status information
   */
  getRateLimiterStatus() {
    const now = Date.now();
    const elapsed = now - this.rateLimiter.lastRefill;

    // If enough time has passed for a complete refill
    if (elapsed >= this.rateLimiter.interval) {
      return {
        availableTokens: this.rateLimiter.tokensPerInterval,
        maxTokens: this.rateLimiter.tokensPerInterval,
        resetInMs: this.rateLimiter.interval,
      };
    }

    // Otherwise return current state
    return {
      availableTokens: this.rateLimiter.tokens,
      maxTokens: this.rateLimiter.tokensPerInterval,
      resetInMs: this.rateLimiter.interval - elapsed,
    };
  }

  /**
   * Retrieve a cached embedding or generate a new one
   *
   * @param text - Text to generate embedding for
   * @returns Embedding vector
   */
  async _getCachedEmbeddingOrGenerate(text: string): Promise<number[]> {
    const cacheKey = this._generateCacheKey(text);

    // Try to get from cache first
    const cachedValue = this.cache.get(cacheKey);

    if (cachedValue) {
      this.logger.debug('Cache hit', {
        textHash: cacheKey.substring(0, 8),
        age: Date.now() - cachedValue.timestamp,
      });
      return cachedValue.embedding;
    }

    this.logger.debug('Cache miss', { textHash: cacheKey.substring(0, 8) });

    try {
      // Generate new embedding
      const embedding = await this.embeddingService.generateEmbedding(text);

      // Store in cache
      this._cacheEmbedding(text, embedding);

      return embedding;
    } catch (error) {
      this.logger.error('Failed to generate embedding', {
        error,
        textLength: text.length,
      });
      throw error;
    }
  }

  /**
   * Store an embedding in the cache
   *
   * @private
   * @param text - Original text
   * @param embedding - Embedding vector
   */
  private _cacheEmbedding(text: string, embedding: number[]): void {
    const cacheKey = this._generateCacheKey(text);
    const modelInfo = this.embeddingService.getModelInfo();

    this.cache.set(cacheKey, {
      embedding,
      timestamp: Date.now(),
      model: modelInfo.name,
    });

    this.logger.debug('Cached embedding', {
      textHash: cacheKey.substring(0, 8),
      model: modelInfo.name,
      dimensions: embedding.length,
    });
  }

  /**
   * Generate a deterministic cache key for text
   *
   * @private
   * @param text - Text to hash
   * @returns Cache key
   */
  _generateCacheKey(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  /**
   * Prepare text for embedding from an entity
   *
   * @private
   * @param entity - Entity to prepare text from
   * @returns Processed text ready for embedding
   */
  private _prepareEntityText(entity: Entity): string {
    // Create a descriptive text from entity data
    const lines = [`Name: ${entity.name}`, `Type: ${entity.entityType}`, 'Observations:'];

    // Add observations, ensuring we handle both string arrays and other formats
    if (entity.observations) {
      // Handle case where observations might be stored as JSON string in some providers
      let observationsArray = entity.observations;

      // If observations is a string, try to parse it as JSON
      if (typeof entity.observations === 'string') {
        try {
          observationsArray = JSON.parse(entity.observations);
        } catch {
          // If parsing fails, treat it as a single observation
          observationsArray = [entity.observations];
        }
      }

      // Ensure it's an array at this point
      if (!Array.isArray(observationsArray)) {
        observationsArray = [String(observationsArray)];
      }

      // Add each observation to the text
      if (observationsArray.length > 0) {
        lines.push(...observationsArray.map((obs) => `- ${obs}`));
      } else {
        lines.push('  (No observations)');
      }
    } else {
      lines.push('  (No observations)');
    }

    const text = lines.join('\n');

    // Log the prepared text for debugging
    this.logger.debug('Prepared entity text for embedding', {
      entityName: entity.name,
      entityType: entity.entityType,
      observationCount: Array.isArray(entity.observations) ? entity.observations.length : 0,
      textLength: text.length,
    });

    return text;
  }

  /**
   * Get a cached embedding entry (used for testing)
   *
   * @param key - Cache key
   * @returns Cached embedding or undefined
   */
  getCacheEntry(key: string): CachedEmbedding | undefined {
    return this.cache.get(key);
  }
}
