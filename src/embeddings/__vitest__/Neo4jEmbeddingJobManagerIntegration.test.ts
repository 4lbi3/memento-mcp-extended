/**
 * @vitest-environment node
 */
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Neo4jEmbeddingJobManager } from '../Neo4jEmbeddingJobManager.js';
import { Neo4jJobStore } from '../../storage/neo4j/Neo4jJobStore.js';
import { createJobDatabaseConnectionManager } from '../../storage/neo4j/Neo4jConnectionManager.js';
import { ensureJobDatabasePrepared } from '../../storage/neo4j/JobDatabaseInitializer.js';
import { DEFAULT_NEO4J_CONFIG } from '../../storage/neo4j/Neo4jConfig.js';
import type { Neo4jConfig } from '../../storage/neo4j/Neo4jConfig.js';
import type { Neo4jConnectionManager } from '../../storage/neo4j/Neo4jConnectionManager.js';
import type { Entity } from '../../KnowledgeGraphManager.js';
import { EmbeddingService } from '../EmbeddingService.js';

const isIntegrationTest = process.env.TEST_INTEGRATION === 'true';
const describeIntegration = isIntegrationTest ? describe : describe.skip;

describeIntegration('Neo4jEmbeddingJobManager integration', () => {
  let jobConnectionManager: Neo4jConnectionManager;
  let jobStore: Neo4jJobStore;
  const entityMap = new Map<string, Entity>();
  const jobDatabaseName =
    process.env.NEO4J_INTEGRATION_JOB_DATABASE || 'integration_embedding_jobs';
  const integrationConfig: Neo4jConfig = {
    ...DEFAULT_NEO4J_CONFIG,
    jobDatabaseName,
    embedJobRetentionDays: 7,
  };

  beforeAll(async () => {
    await ensureJobDatabasePrepared(integrationConfig);
    jobConnectionManager = createJobDatabaseConnectionManager(integrationConfig);
    jobStore = new Neo4jJobStore(jobConnectionManager, false);
  });

  beforeEach(async () => {
    await jobConnectionManager.executeQuery('MATCH (job:EmbedJob) DETACH DELETE job', {});
    entityMap.clear();
  });

  afterEach(async () => {
    // Ensure any recovery timers are stopped so the next test begins clean
    await stopActiveManager();
  });

  afterAll(async () => {
    await jobStore.close();
    await jobConnectionManager.close();
  });

  let activeManager: Neo4jEmbeddingJobManager | null = null;

  async function stopActiveManager(): Promise<void> {
    if (activeManager) {
      activeManager.stopStaleJobRecovery();
      activeManager = null;
    }
  }

  class IntegrationEmbeddingService extends EmbeddingService {
    constructor(private readonly delayMs = 0) {
      super();
    }

    async generateEmbedding(): Promise<number[]> {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      return [0.1, 0.2, 0.3, 0.4];
    }

    async generateEmbeddings(texts: string[]): Promise<number[][]> {
      const embedding = await this.generateEmbedding();
      return texts.map(() => embedding);
    }

    getModelInfo() {
      return {
        name: 'integration-model',
        dimensions: 4,
        version: '1',
      };
    }
  }

  function createStorageProvider() {
    return {
      async getEntity(entityName: string): Promise<Entity | null> {
        return entityMap.get(entityName) || null;
      },

      async storeEntityVector(): Promise<void> {
        return Promise.resolve();
      },
    };
  }

  async function withEnv<T extends unknown>(
    overrides: Record<string, string | undefined>,
    fn: () => T | Promise<T>
  ): Promise<T> {
    const originals = Object.fromEntries(
      Object.keys(overrides).map((key) => [key, process.env[key]])
    ) as Record<string, string | undefined>;
    try {
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      return await fn();
    } finally {
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }

  async function createIntegrationManager(options?: {
    rateLimiterOptions?: { tokensPerInterval: number; interval: number };
    recoveryIntervalMs?: number;
    embeddingDelayMs?: number;
    env?: Record<string, string | undefined>;
  }): Promise<Neo4jEmbeddingJobManager> {
    const storageProvider = createStorageProvider();
    const embeddingService = new IntegrationEmbeddingService(options?.embeddingDelayMs ?? 0);

    const manager = await withEnv(options?.env || {}, () => {
      const instance = new Neo4jEmbeddingJobManager(
        storageProvider,
        embeddingService,
        jobStore,
        options?.rateLimiterOptions,
        undefined,
        undefined,
        `integration-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        { staleJobRecoveryIntervalMs: options?.recoveryIntervalMs ?? 500 }
      );
      activeManager = instance;
      return instance;
    });

    return manager;
  }

  function registerEntity(name: string): Entity {
    const entity: Entity = {
      name,
      entityType: 'person',
      observations: ['integration test'],
    };
    entityMap.set(name, entity);
    return entity;
  }

  async function getJob(jobId: string): Promise<Record<string, unknown> | null> {
    const result = await jobConnectionManager.executeQuery(
      'MATCH (job:EmbedJob {id: $jobId}) RETURN job',
      { jobId }
    );
    if (result.records.length === 0) {
      return null;
    }
    return result.records[0].get('job') as Record<string, unknown>;
  }

  async function waitForCondition(
    predicate: () => Promise<boolean>,
    options: { timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 5000;
    const intervalMs = options.intervalMs ?? 100;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('Timed out waiting for condition');
  }

  it('recovers jobs when a worker crashes before releasing locks', async () => {
    const entity = registerEntity('crash-entity');
    const jobId = await jobStore.enqueueJob({
      entity_uid: entity.name,
      model: 'integration-model',
      version: '1',
    });

    expect(jobId).toBeDefined();

    const leases = await jobStore.leaseJobs(1, 'crash-worker', 60000);
    expect(leases).toHaveLength(1);
    const leasedJob = leases[0];

    await jobConnectionManager.executeQuery(
      'MATCH (job:EmbedJob {id: $jobId}) SET job.lock_until = timestamp() - 10000',
      { jobId: leasedJob.id }
    );

    const manager = await createIntegrationManager({
      env: { EMBED_JOB_RECOVERY_INTERVAL: '250' },
    });

    await waitForCondition(
      async () => {
        const job = await getJob(leasedJob.id);
        return Boolean(job?.status === 'pending');
      },
      { timeoutMs: 6000 }
    );

    const recoveredJob = await getJob(leasedJob.id);
    expect(recoveredJob?.status).toBe('pending');
    expect(recoveredJob?.lock_owner).toBeNull();
    expect(recoveredJob?.lock_until).toBeNull();

    manager.stopStaleJobRecovery();
    activeManager = null;
  });

  it('releases unprocessed jobs when rate limit stops processing mid-batch', async () => {
    const entityA = registerEntity('rate-limit-entity-a');
    const entityB = registerEntity('rate-limit-entity-b');

    const jobIdA = await jobStore.enqueueJob({
      entity_uid: entityA.name,
      model: 'integration-model',
      version: '1',
    });
    const jobIdB = await jobStore.enqueueJob({
      entity_uid: entityB.name,
      model: 'integration-model',
      version: '1',
    });

    expect(jobIdA).toBeDefined();
    expect(jobIdB).toBeDefined();

    const manager = await createIntegrationManager({
      rateLimiterOptions: { tokensPerInterval: 1, interval: 60000 },
      recoveryIntervalMs: 0,
      env: { EMBED_JOB_RECOVERY_INTERVAL: '0' },
    });

    await manager.processJobs(5);

    const jobB = await getJob(jobIdB as string);
    expect(jobB?.status).toBe('pending');
    expect(jobB?.lock_owner).toBeNull();
    expect(jobB?.lock_until).toBeNull();

    const jobA = await getJob(jobIdA as string);
    expect(jobA?.status).toBe('completed');

    manager.stopStaleJobRecovery();
    activeManager = null;
  });

  it('recovers jobs whose heartbeat stops extending locks while processing', async () => {
    const entity = registerEntity('heartbeat-entity');
    const jobId = await jobStore.enqueueJob({
      entity_uid: entity.name,
      model: 'integration-model',
      version: '1',
    });

    expect(jobId).toBeDefined();

    const manager = await createIntegrationManager({
      embeddingDelayMs: 400,
      recoveryIntervalMs: 200,
      env: { EMBED_JOB_HEARTBEAT_INTERVAL_MS: '10000' },
    });

    await manager.processJobs(1, 100);

    await waitForCondition(
      async () => {
        const job = await getJob(jobId as string);
        return Boolean(job?.status === 'pending' && job.lock_owner === null);
      },
      { timeoutMs: 6000 }
    );

    const recoveredJob = await getJob(jobId as string);
    expect(recoveredJob?.status).toBe('pending');
    expect(recoveredJob?.lock_owner).toBeNull();

    manager.stopStaleJobRecovery();
    activeManager = null;
  });
});
