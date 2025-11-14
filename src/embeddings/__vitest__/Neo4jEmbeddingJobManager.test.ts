import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Neo4jEmbeddingJobManager } from '../Neo4jEmbeddingJobManager.js';
import { Neo4jJobStore } from '../../storage/neo4j/Neo4jJobStore.js';
import type { EmbeddingService } from '../EmbeddingService.js';
import type { Entity } from '../../KnowledgeGraphManager.js';
import type { EntityEmbedding } from '../../types/entity-embedding.js';

// Mock dependencies
vi.mock('../../storage/neo4j/Neo4jJobStore.js');
vi.mock('../EmbeddingService.js');

interface MockEmbeddingStorageProvider {
  getEntity: (entityName: string) => Promise<Entity | null>;
  storeEntityVector: (entityName: string, embedding: EntityEmbedding) => Promise<void>;
}

describe('Neo4jEmbeddingJobManager', () => {
  let jobManager: Neo4jEmbeddingJobManager;
  let mockJobStore: jest.Mocked<Neo4jJobStore>;
  let mockEmbeddingService: jest.Mocked<EmbeddingService>;
  let mockStorageProvider: MockEmbeddingStorageProvider;

  const mockEntity: Entity = {
    name: 'TestEntity',
    entityType: 'person',
    observations: ['Test observation'],
  };

  const mockEmbedding: number[] = [0.1, 0.2, 0.3];

  beforeEach(() => {
    // Mock the job store
    mockJobStore = {
      enqueueJob: vi.fn(),
      leaseJobs: vi.fn(),
      completeJob: vi.fn(),
      failJob: vi.fn(),
      getQueueStatus: vi.fn().mockResolvedValue({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        totalJobs: 0,
      }),
      retryFailedJobs: vi.fn(),
      cleanupJobs: vi.fn(),
      scheduledCleanupJobs: vi.fn(),
      heartbeatJobs: vi.fn(),
      releaseJobs: vi.fn().mockResolvedValue(0),
      recoverStaleJobs: vi.fn().mockResolvedValue(0),
      close: vi.fn(),
    } as any;

    // Mock the embedding service
    mockEmbeddingService = {
      generateEmbedding: vi.fn(),
      getModelInfo: vi.fn().mockReturnValue({ name: 'test-model' }),
    } as any;

    // Mock the storage provider
    mockStorageProvider = {
      getEntity: vi.fn(),
      storeEntityVector: vi.fn(),
    };

    jobManager = new Neo4jEmbeddingJobManager(
      mockStorageProvider,
      mockEmbeddingService,
      mockJobStore,
      undefined, // rate limiter options
      undefined, // cache options
      undefined, // logger
      'test-worker',
      { staleJobRecoveryIntervalMs: 0 }
    );
  });

  afterEach(async () => {
    if (jobManager) {
      // Clean up if needed
    }
  });

  describe('scheduleEntityEmbedding', () => {
    it('should schedule a job for a valid entity', async () => {
      mockStorageProvider.getEntity.mockResolvedValue(mockEntity);
      mockJobStore.enqueueJob.mockResolvedValue('job-123');

      const result = await jobManager.scheduleEntityEmbedding('TestEntity');

      expect(mockStorageProvider.getEntity).toHaveBeenCalledWith('TestEntity');
      expect(mockJobStore.enqueueJob).toHaveBeenCalledWith({
        entity_uid: 'TestEntity',
        model: 'test-model',
        version: '1',
        priority: 1,
        max_attempts: 3,
      });
      expect(result).toBe('job-123');
    });

    it('should throw error for non-existent entity', async () => {
      mockStorageProvider.getEntity.mockResolvedValue(null);

      await expect(jobManager.scheduleEntityEmbedding('NonExistentEntity')).rejects.toThrow(
        'Entity NonExistentEntity not found'
      );
    });

    it('should handle job already existing', async () => {
      mockStorageProvider.getEntity.mockResolvedValue(mockEntity);
      mockJobStore.enqueueJob.mockResolvedValue(null); // Job already exists

      const result = await jobManager.scheduleEntityEmbedding('TestEntity');

      expect(result).toBeNull();
    });
  });

  describe('processJobs', () => {
    it('should process leased jobs successfully', async () => {
      const leasedJob = {
        id: 'job-1',
        entity_uid: 'TestEntity',
        model: 'test-model',
        version: '1',
        status: 'processing',
        priority: 1,
        created_at: Date.now(),
        attempts: 1,
        max_attempts: 3,
        lock_owner: 'test-worker',
        lock_until: Date.now() + 300000,
      };

      mockJobStore.leaseJobs.mockResolvedValue([leasedJob]);
      mockStorageProvider.getEntity.mockResolvedValue(mockEntity);
      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockJobStore.completeJob.mockResolvedValue(true);

      const result = await jobManager.processJobs(10);

      expect(mockJobStore.leaseJobs).toHaveBeenCalledWith(10, 'test-worker', expect.any(Number));
      expect(mockStorageProvider.getEntity).toHaveBeenCalledWith('TestEntity');
      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalled();
      expect(mockStorageProvider.storeEntityVector).toHaveBeenCalledWith('TestEntity', {
        vector: mockEmbedding,
        model: 'test-model',
        lastUpdated: expect.any(Number),
      });
      expect(mockJobStore.completeJob).toHaveBeenCalledWith('job-1', 'test-worker');
      expect(result.processed).toBe(1);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('should handle job processing failure', async () => {
      const leasedJob = {
        id: 'job-1',
        entity_uid: 'TestEntity',
        model: 'test-model',
        version: '1',
        status: 'processing',
        priority: 1,
        created_at: Date.now(),
        attempts: 1,
        max_attempts: 3,
        lock_owner: 'test-worker',
        lock_until: Date.now() + 300000,
      };

      mockJobStore.leaseJobs.mockResolvedValue([leasedJob]);
      mockStorageProvider.getEntity.mockRejectedValue(new Error('Entity not found'));
      mockJobStore.failJob.mockResolvedValue(true);

      const result = await jobManager.processJobs(10);

      expect(mockJobStore.failJob).toHaveBeenCalledWith(
        'job-1',
        'test-worker',
        'Entity not found',
        {
          category: 'permanent',
          stack: expect.stringContaining('Entity not found'),
          permanent: true,
        }
      );
      expect(result.processed).toBe(1);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('should respect rate limiting', async () => {
      const leasedJob = {
        id: 'job-1',
        entity_uid: 'TestEntity',
        model: 'test-model',
        version: '1',
        status: 'processing',
        priority: 1,
        created_at: Date.now(),
        attempts: 1,
        max_attempts: 3,
        lock_owner: 'test-worker',
        lock_until: Date.now() + 300000,
      };

      mockJobStore.leaseJobs.mockResolvedValue([leasedJob]);
      // Set up rate limiter to be exhausted and not auto-refill
      (jobManager as any).rateLimiter.tokens = 0;
      (jobManager as any).rateLimiter.lastRefill = Date.now(); // Current time, no refill

      const result = await jobManager.processJobs(10);

      expect(result.processed).toBe(0); // No jobs processed due to rate limit
    });

    it('releases unprocessed leases when rate limit stops mid-batch', async () => {
      const leasedJobs = [
        {
          id: 'job-1',
          entity_uid: 'TestEntity',
          model: 'test-model',
          version: '1',
          status: 'processing',
          priority: 1,
          created_at: Date.now(),
          attempts: 1,
          max_attempts: 3,
          lock_owner: 'test-worker',
          lock_until: Date.now() + 300000,
        },
        {
          id: 'job-2',
          entity_uid: 'TestEntity',
          model: 'test-model',
          version: '1',
          status: 'processing',
          priority: 1,
          created_at: Date.now(),
          attempts: 1,
          max_attempts: 3,
          lock_owner: 'test-worker',
          lock_until: Date.now() + 300000,
        },
      ];

      mockJobStore.leaseJobs.mockResolvedValue(leasedJobs);
      mockStorageProvider.getEntity.mockResolvedValue(mockEntity);
      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockJobStore.completeJob.mockResolvedValue(true);
      mockJobStore.releaseJobs.mockResolvedValue(1);

      (jobManager as any).rateLimiter.tokens = 1;
      (jobManager as any).rateLimiter.interval = 60000;
      (jobManager as any).rateLimiter.lastRefill = Date.now();

      await jobManager.processJobs(10);

      expect(mockJobStore.releaseJobs).toHaveBeenCalledTimes(1);
      expect(mockJobStore.releaseJobs).toHaveBeenCalledWith([leasedJobs[1].id], 'test-worker');
    });
  });

  describe('stale job recovery', () => {
    it('runs recovery on startup and via the configured interval', async () => {
      const recoveryInterval = 1000;
      vi.useFakeTimers();

      const recoveryManager = new Neo4jEmbeddingJobManager(
        mockStorageProvider,
        mockEmbeddingService,
        mockJobStore,
        undefined,
        undefined,
        undefined,
        'recovery-worker',
        { staleJobRecoveryIntervalMs: recoveryInterval }
      );

      try {
        expect(mockJobStore.recoverStaleJobs).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(recoveryInterval);
        await Promise.resolve();

        expect(mockJobStore.recoverStaleJobs).toHaveBeenCalledTimes(2);
      } finally {
        recoveryManager.stopStaleJobRecovery();
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });

    it('disables recovery when EMBED_JOB_RECOVERY_INTERVAL is zero', async () => {
      const original = process.env.EMBED_JOB_RECOVERY_INTERVAL;
      process.env.EMBED_JOB_RECOVERY_INTERVAL = '0';
      let envManager: Neo4jEmbeddingJobManager | null = null;

      try {
        envManager = new Neo4jEmbeddingJobManager(
          mockStorageProvider,
          mockEmbeddingService,
          mockJobStore,
          undefined,
          undefined,
          undefined,
          'env-worker'
        );

        expect(mockJobStore.recoverStaleJobs).not.toHaveBeenCalled();
      } finally {
        if (envManager) {
          envManager.stopStaleJobRecovery();
        }

        if (original === undefined) {
          delete process.env.EMBED_JOB_RECOVERY_INTERVAL;
        } else {
          process.env.EMBED_JOB_RECOVERY_INTERVAL = original;
        }
      }
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status from job store', async () => {
      const mockStatus = {
        pending: 5,
        processing: 2,
        completed: 10,
        failed: 1,
        totalJobs: 18,
      };

      mockJobStore.getQueueStatus.mockResolvedValue(mockStatus);

      const result = await jobManager.getQueueStatus();

      expect(result).toEqual(mockStatus);
      expect(mockJobStore.getQueueStatus).toHaveBeenCalled();
    });
  });

  describe('retryFailedJobs', () => {
    it('should retry failed jobs', async () => {
      mockJobStore.retryFailedJobs.mockResolvedValue(3);

      const result = await jobManager.retryFailedJobs();

      expect(result).toBe(3);
      expect(mockJobStore.retryFailedJobs).toHaveBeenCalled();
    });
  });

  describe('cleanupJobs', () => {
    it('should clean up old jobs', async () => {
      mockJobStore.scheduledCleanupJobs.mockResolvedValue(7);

      const result = await jobManager.cleanupJobs();

      expect(result).toBe(7);
      expect(mockJobStore.scheduledCleanupJobs).toHaveBeenCalledWith(14);
    });
  });

  describe('rate limiter', () => {
    it('should consume tokens correctly', () => {
      const status1 = jobManager.getRateLimiterStatus();
      expect(status1.availableTokens).toBeGreaterThan(0);

      // Consume a token
      const result = (jobManager as any)._checkRateLimiter();
      expect(result.success).toBe(true);

      const status2 = jobManager.getRateLimiterStatus();
      expect(status2.availableTokens).toBe(status1.availableTokens - 1);
    });
  });

  describe('health monitoring', () => {
    it('degrades after failure and recovers on success', async () => {
      const failedJob = {
        id: 'job-health',
        entity_uid: 'TestEntity',
        model: 'test-model',
        version: '1',
        status: 'processing',
        priority: 1,
        created_at: Date.now(),
        attempts: 1,
        max_attempts: 3,
        lock_owner: 'test-worker',
        lock_until: Date.now() + 300000,
      };

      mockJobStore.leaseJobs.mockResolvedValue([failedJob]);
      mockStorageProvider.getEntity.mockRejectedValue(new Error('Entity not found'));
      mockJobStore.failJob.mockResolvedValue(true);

      const failureResult = await jobManager.processJobs(10);
      expect(failureResult.failed).toBe(1);

      const degraded = jobManager.getHealthStatus();
      expect(degraded.state).toBe('DEGRADED');
      expect(degraded.consecutiveFailures).toBe(1);
      expect(degraded.successRate).toBe(0);

      mockStorageProvider.getEntity.mockResolvedValue(mockEntity);
      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbedding);
      mockJobStore.completeJob.mockResolvedValue(true);
      mockJobStore.leaseJobs.mockResolvedValue([failedJob]);

      const successResult = await jobManager.processJobs(10);
      expect(successResult.successful).toBe(1);

      const healthy = jobManager.getHealthStatus();
      expect(healthy.state).toBe('HEALTHY');
      expect(healthy.consecutiveFailures).toBe(0);
      expect(healthy.successRate).toBeGreaterThanOrEqual(0.5);
    });

    it('escalates to critical after repeated failures', async () => {
      const repeatJob = {
        id: 'job-critical',
        entity_uid: 'TestEntity',
        model: 'test-model',
        version: '1',
        status: 'processing',
        priority: 1,
        created_at: Date.now(),
        attempts: 1,
        max_attempts: 3,
        lock_owner: 'test-worker',
        lock_until: Date.now() + 300000,
      };

      mockJobStore.leaseJobs.mockResolvedValue([repeatJob]);
      mockStorageProvider.getEntity.mockRejectedValue(new Error('Entity missing'));
      mockJobStore.failJob.mockResolvedValue(true);

      for (let i = 0; i < 10; i += 1) {
        await jobManager.processJobs(10);
      }

      expect(jobManager.getHealthStatus().state).toBe('CRITICAL');
    });
  });
});
