import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Neo4jJobStore, type EnqueueJobParams } from '../../neo4j/Neo4jJobStore';
import { Neo4jConnectionManager } from '../../neo4j/Neo4jConnectionManager';

// Mock the Neo4jConnectionManager
vi.mock('../../neo4j/Neo4jConnectionManager', () => {
  const mockExecuteQuery = vi.fn().mockResolvedValue({ records: [] });
  return {
    Neo4jConnectionManager: vi.fn().mockImplementation(() => ({
      executeQuery: mockExecuteQuery,
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('Neo4jJobStore', () => {
  let jobStore: Neo4jJobStore;
  let connectionManager: Neo4jConnectionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    connectionManager = new Neo4jConnectionManager();
    jobStore = new Neo4jJobStore(connectionManager);
  });

  afterEach(async () => {
    if (jobStore) {
      await jobStore.close();
    }
  });

  describe('enqueueJob', () => {
    it('should enqueue a new job successfully', async () => {
      const mockResult = {
        records: [{
          get: (key: string) => {
            if (key === 'job.id') return 'test-job-id';
            if (key === 'job.status') return 'created';
            return null;
          }
        }]
      };
      connectionManager.executeQuery.mockResolvedValue(mockResult);

      const params: EnqueueJobParams = {
        entity_uid: 'test-entity',
        model: 'test-model',
        version: '1',
        priority: 1,
      };

      const result = await jobStore.enqueueJob(params);

      expect(result).toBe('test-job-id');
      expect(connectionManager.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('MERGE (job:EmbedJob'),
        expect.objectContaining({
          entity_uid: 'test-entity',
          model: 'test-model',
          version: '1',
          priority: 1,
          max_attempts: 3,
        })
      );
    });

    it('should return null when job already exists', async () => {
      const mockResult = {
        records: [{
          get: (key: string) => {
            if (key === 'job.id') return 'existing-job-id';
            if (key === 'job.status') return 'pending';
            return null;
          }
        }]
      };
      connectionManager.executeQuery.mockResolvedValue(mockResult);

      const params: EnqueueJobParams = {
        entity_uid: 'test-entity',
        model: 'test-model',
        version: '1',
      };

      const result = await jobStore.enqueueJob(params);

      expect(result).toBeNull();
    });
  });

  describe('leaseJobs', () => {
    it('should lease available jobs', async () => {
      const mockResult = {
        records: [{
          get: vi.fn().mockReturnValue({
            id: 'job-1',
            entity_uid: 'entity-1',
            model: 'model-1',
            version: '1',
            status: 'processing',
            priority: 1,
            created_at: Date.now(),
            lock_owner: 'worker-1',
            lock_until: Date.now() + 300000,
            attempts: 1,
            max_attempts: 3,
          })
        }]
      };
      connectionManager.executeQuery.mockResolvedValue(mockResult);

      const result = await jobStore.leaseJobs(10, 'worker-1', 300000);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job-1');
      expect(result[0].lock_owner).toBe('worker-1');
      expect(connectionManager.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('MATCH (job:EmbedJob)'),
        expect.objectContaining({
          batchSize: 10,
          lockOwner: 'worker-1',
          lockDuration: 300000,
        })
      );
    });
  });

  describe('completeJob', () => {
    it('should complete a job successfully', async () => {
      const mockResult = {
        records: [{ get: () => 1 }]
      };
      connectionManager.executeQuery.mockResolvedValue(mockResult);

      const result = await jobStore.completeJob('job-1', 'worker-1');

      expect(result).toBe(true);
      expect(connectionManager.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('SET job.status = \'completed\''),
        expect.objectContaining({
          jobId: 'job-1',
          lockOwner: 'worker-1',
        })
      );
    });
  });

  describe('failJob', () => {
    it('should fail a job and mark for retry', async () => {
      const mockResult = {
        records: [{ get: () => 1 }]
      };
      connectionManager.executeQuery.mockResolvedValue(mockResult);

      const result = await jobStore.failJob('job-1', 'worker-1', 'Test error');

      expect(result).toBe(true);
      expect(connectionManager.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('SET job.error = $error'),
        expect.objectContaining({
          jobId: 'job-1',
          lockOwner: 'worker-1',
          error: 'Test error',
        })
      );
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue statistics', async () => {
      const mockResult = {
        records: [{
          get: (key: string) => {
            const stats: Record<string, number> = {
              total: 10,
              pending: 5,
              processing: 3,
              completed: 1,
              failed: 1,
            };
            return stats[key] || 0;
          }
        }]
      };
      connectionManager.executeQuery.mockResolvedValue(mockResult);

      const result = await jobStore.getQueueStatus();

      expect(result.totalJobs).toBe(10);
      expect(result.pending).toBe(5);
      expect(result.processing).toBe(3);
      expect(result.completed).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('retryFailedJobs', () => {
    it('should retry failed jobs', async () => {
      const mockResult = {
        records: [{ get: () => 3 }]
      };
      connectionManager.executeQuery.mockResolvedValue(mockResult);

      const result = await jobStore.retryFailedJobs();

      expect(result).toBe(3);
      expect(connectionManager.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE job.status = \'failed\''),
        {}
      );
    });
  });

  describe('cleanupJobs', () => {
    it('should clean up old completed jobs', async () => {
      const mockResult = {
        records: [{ get: () => 5 }]
      };
      connectionManager.executeQuery.mockResolvedValue(mockResult);

      const result = await jobStore.cleanupJobs(7 * 24 * 60 * 60 * 1000);

      expect(result).toBe(5);
      expect(connectionManager.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE job'),
        expect.objectContaining({
          cutoffTime: expect.any(Number),
        })
      );
    });
  });

  describe('heartbeatJobs', () => {
    it('should send heartbeat for jobs', async () => {
      const mockResult = {
        records: [{ get: () => 2 }]
      };
      connectionManager.executeQuery.mockResolvedValue(mockResult);

      const result = await jobStore.heartbeatJobs(['job-1', 'job-2'], 'worker-1', 300000);

      expect(result).toBe(2);
      expect(connectionManager.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('MATCH (job:EmbedJob)'),
        expect.objectContaining({
          jobIds: ['job-1', 'job-2'],
          lockOwner: 'worker-1',
          lockDuration: 300000,
        })
      );
    });

    it('should return 0 for empty job list', async () => {
      const result = await jobStore.heartbeatJobs([], 'worker-1', 300000);

      expect(result).toBe(0);
      expect(connectionManager.executeQuery).not.toHaveBeenCalled();
    });
  });
});
