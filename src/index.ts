#!/usr/bin/env node
import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { KnowledgeGraphManager } from './KnowledgeGraphManager.js';
import { initializeStorageProvider } from './config/storage.js';
import { setupServer } from './server/setup.js';
import { EmbeddingServiceFactory } from './embeddings/EmbeddingServiceFactory.js';
import { Neo4jJobStore } from './storage/neo4j/Neo4jJobStore.js';
import { Neo4jEmbeddingJobManager } from './embeddings/Neo4jEmbeddingJobManager.js';
import { createJobDatabaseConnectionManager } from './storage/neo4j/Neo4jConnectionManager.js';
import { DEFAULT_NEO4J_CONFIG, validateNeo4jConfig } from './storage/neo4j/Neo4jConfig.js';
import { ensureJobDatabasePrepared } from './storage/neo4j/JobDatabaseInitializer.js';
import { logger } from './utils/logger.js';
import { classifyError, ErrorCategory } from './utils/errors.js';
import { calculateRetryDelay, DEFAULT_RETRY_POLICY, type RetryPolicy } from './utils/retry.js';
import { startHealthServer } from './server/health.js';

// Re-export the types and classes for use in other modules
export * from './KnowledgeGraphManager.js';
// Export the Relation type
export { RelationMetadata, Relation } from './types/relation.js';

// Initialize storage and create KnowledgeGraphManager
const storageProvider = initializeStorageProvider();

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const JOB_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: parsePositiveNumber(
    process.env.EMBED_JOB_RETRY_BASE_DELAY_MS,
    DEFAULT_RETRY_POLICY.baseDelayMs
  ),
  maxDelayMs: parsePositiveNumber(
    process.env.EMBED_JOB_RETRY_MAX_DELAY_MS,
    DEFAULT_RETRY_POLICY.maxDelayMs
  ),
  multiplier: parsePositiveNumber(
    process.env.EMBED_JOB_RETRY_MULTIPLIER,
    DEFAULT_RETRY_POLICY.multiplier
  ),
  jitterFactor: parsePositiveNumber(
    process.env.EMBED_JOB_RETRY_JITTER_FACTOR,
    DEFAULT_RETRY_POLICY.jitterFactor
  ),
};

const EMBEDDING_PROCESS_INTERVAL = 10000;
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runRecurringTask(taskName: string, interval: number, task: () => Promise<void>) {
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
        const delay = calculateRetryDelay(transientAttempts, JOB_RETRY_POLICY);
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

// Validate Neo4j configuration at startup
const neo4jConfig = DEFAULT_NEO4J_CONFIG;
try {
  validateNeo4jConfig(neo4jConfig);
  logger.info('Neo4j configuration validated successfully', {
    mainDatabase: neo4jConfig.database,
    jobDatabase: neo4jConfig.jobDatabaseName,
    embedJobRetentionDays: neo4jConfig.embedJobRetentionDays,
  });
} catch (error) {
  logger.error('Invalid Neo4j configuration', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}

try {
  await ensureJobDatabasePrepared(neo4jConfig);
  logger.info('Embedding job database is ready', {
    jobDatabase: neo4jConfig.jobDatabaseName || 'embedding-jobs',
  });
} catch (error) {
  logger.error('Failed to prepare embedding job database', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

// Initialize embedding job manager only if storage provider supports it
let embeddingJobManager: Neo4jEmbeddingJobManager | undefined = undefined;
try {
  // Force debug logging to help troubleshoot
  logger.debug(`OpenAI API key exists: ${!!process.env.OPENAI_API_KEY}`);
  logger.debug(`OpenAI Embedding model: ${process.env.OPENAI_EMBEDDING_MODEL || 'not set'}`);
  logger.debug(`Storage provider type: ${process.env.MEMORY_STORAGE_TYPE || 'default'}`);

  // Ensure OPENAI_API_KEY is defined for embedding generation
  if (!process.env.OPENAI_API_KEY) {
    logger.warn(
      'OPENAI_API_KEY environment variable is not set. Semantic search will use random embeddings.'
    );
  } else {
    logger.info('OpenAI API key found, will use for generating embeddings');
  }

  // Initialize the embedding service
  const embeddingService = EmbeddingServiceFactory.createFromEnvironment();
  logger.debug(`Embedding service model info: ${JSON.stringify(embeddingService.getModelInfo())}`);

  // Configure rate limiting options - stricter limits to prevent OpenAI API abuse
  const rateLimiterOptions = {
    tokensPerInterval: process.env.EMBEDDING_RATE_LIMIT_TOKENS
      ? parseInt(process.env.EMBEDDING_RATE_LIMIT_TOKENS, 10)
      : 20, // Default: 20 requests per minute
    interval: process.env.EMBEDDING_RATE_LIMIT_INTERVAL
      ? parseInt(process.env.EMBEDDING_RATE_LIMIT_INTERVAL, 10)
      : 60 * 1000, // Default: 1 minute
  };

  logger.info('Initializing Neo4jEmbeddingJobManager', {
    rateLimiterOptions,
    model: embeddingService.getModelInfo().name,
    storageType: 'neo4j',
  });

  // For Neo4j (which is always the storage provider)
  // Access the connection manager from the Neo4j storage provider for entity data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entityConnectionManager = (storageProvider as any).connectionManager;

  if (!entityConnectionManager) {
    throw new Error('Neo4j storage provider does not have a connection manager');
  }

  // Create a dedicated connection manager for the job database
  const jobConnectionManager = createJobDatabaseConnectionManager(neo4jConfig);

  // Create the Neo4j job store using the dedicated job database
  const jobStore = new Neo4jJobStore(jobConnectionManager, true);

  // Create a compatible wrapper for the Neo4j storage provider
  const adaptedStorageProvider = {
    ...storageProvider,
    // Make sure getEntity is available
    getEntity: async (name: string) => {
      if (typeof storageProvider.getEntity === 'function') {
        return storageProvider.getEntity(name);
      }
      const result = await storageProvider.openNodes([name]);
      return result.entities[0] || null;
    },
    // Make sure storeEntityVector is available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storeEntityVector: async (name: string, embedding: any) => {
      logger.debug(`Neo4j adapter: storeEntityVector called for ${name}`, {
        embeddingType: typeof embedding,
        vectorLength: embedding?.vector?.length || 'no vector',
        model: embedding?.model || 'no model',
      });

      // Ensure embedding has the correct format
      const formattedEmbedding = {
        vector: embedding.vector || embedding,
        model: embedding.model || 'unknown',
        lastUpdated: embedding.lastUpdated || Date.now(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (storageProvider as any).updateEntityEmbedding === 'function') {
        try {
          logger.debug(`Neo4j adapter: Using updateEntityEmbedding for ${name}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (storageProvider as any).updateEntityEmbedding(name, formattedEmbedding);
        } catch (error) {
          logger.error(`Neo4j adapter: Error in storeEntityVector for ${name}`, error);
          throw error;
        }
      } else {
        const errorMsg = `Neo4j adapter: Neither storeEntityVector nor updateEntityEmbedding implemented for ${name}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
    },
  };

  // Create the Neo4j embedding job manager with the job store
  embeddingJobManager = new Neo4jEmbeddingJobManager(
    adaptedStorageProvider,
    embeddingService,
    jobStore,
    rateLimiterOptions,
    null, // Use default cache options
    logger
  );

  const shouldStartBackgroundTasks =
    !process.env.VITEST && !process.env.NODE_ENV?.includes('test');

  if (shouldStartBackgroundTasks) {
    void runRecurringTask('embedding job processing', EMBEDDING_PROCESS_INTERVAL, async () => {
      if (!embeddingJobManager) {
        logger.warn('Skipping job processing; manager not initialized');
        return;
      }
      await embeddingJobManager.processJobs(10);
    });

    void runRecurringTask('embedding job cleanup', CLEANUP_INTERVAL, async () => {
      if (!embeddingJobManager) {
        logger.warn('Skipping job cleanup; manager not initialized');
        return;
      }
      const retentionDays = neo4jConfig.embedJobRetentionDays || 14;
      const deletedCount = await embeddingJobManager.cleanupJobs(retentionDays);
      if (deletedCount && deletedCount > 0) {
        logger.info('Scheduled job cleanup completed', {
          deletedCount,
          retentionDays,
        });
      }
    });

    startHealthServer(embeddingJobManager);
  } else {
    logger.debug('Background job loops disabled in test environment');
  }
} catch (error) {
  // Fail gracefully if embedding job manager initialization fails
  logger.error('Failed to initialize Neo4jEmbeddingJobManager', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  embeddingJobManager = undefined;
}

// Create the KnowledgeGraphManager with the storage provider, embedding job manager, and vector store options
const knowledgeGraphManager = new KnowledgeGraphManager({
  storageProvider,
  embeddingJobManager,
  // Pass vector store options from storage provider if available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vectorStoreOptions: (storageProvider as any).vectorStoreOptions,
});

// Ensure the storeEntityVector method is available on KnowledgeGraphManager's storageProvider
// Cast to any to bypass type checking for internal properties
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const knowledgeGraphManagerAny = knowledgeGraphManager as any;

if (
  knowledgeGraphManagerAny.storageProvider &&
  typeof knowledgeGraphManagerAny.storageProvider.storeEntityVector !== 'function'
) {
  // Add the storeEntityVector method to the storage provider
  knowledgeGraphManagerAny.storageProvider.storeEntityVector = async (
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embedding: any
  ) => {
    logger.debug(`Neo4j knowledgeGraphManager adapter: storeEntityVector called for ${name}`, {
      embeddingType: typeof embedding,
      vectorLength: embedding?.vector?.length || 'no vector',
      model: embedding?.model || 'no model',
    });

    // Ensure embedding has the correct format
    const formattedEmbedding = {
      vector: embedding.vector || embedding,
      model: embedding.model || 'unknown',
      lastUpdated: embedding.lastUpdated || Date.now(),
    };

    if (typeof knowledgeGraphManagerAny.storageProvider.updateEntityEmbedding === 'function') {
      try {
        logger.debug(
          `Neo4j knowledgeGraphManager adapter: Using updateEntityEmbedding for ${name}`
        );
        return await knowledgeGraphManagerAny.storageProvider.updateEntityEmbedding(
          name,
          formattedEmbedding
        );
      } catch (error) {
        logger.error(
          `Neo4j knowledgeGraphManager adapter: Error in storeEntityVector for ${name}`,
          error
        );
        throw error;
      }
    } else {
      const errorMsg = `Neo4j knowledgeGraphManager adapter: updateEntityEmbedding not implemented for ${name}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  };

  logger.info(
    'Added storeEntityVector adapter method to Neo4j storage provider for KnowledgeGraphManager'
  );
}

// Use a custom createEntities method for immediate job processing, but only if knowledgeGraphManager exists
if (knowledgeGraphManager && typeof knowledgeGraphManager.createEntities === 'function') {
  const originalCreateEntities = knowledgeGraphManager.createEntities.bind(knowledgeGraphManager);
  knowledgeGraphManager.createEntities = async function (entities) {
    // First call the original method to create the entities
    const result = await originalCreateEntities(entities);

    // Then process jobs immediately if we have an embedding job manager
    if (embeddingJobManager) {
      try {
        logger.info('Processing embedding jobs immediately after entity creation', {
          entityCount: entities.length,
          entityNames: entities.map((e) => e.name).join(', '),
        });
        await embeddingJobManager.processJobs(entities.length);
      } catch (error) {
        logger.error('Error processing embedding jobs immediately', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    return result;
  };
}

// Setup the server with the KnowledgeGraphManager
const server = setupServer(knowledgeGraphManager);

// Export main function for testing
export async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only run main if not in a test environment
if (!process.env.VITEST && !process.env.NODE_ENV?.includes('test')) {
  main().catch((error) => {
    // Log error but don't use console.error
    logger.error(`Main process terminated: ${error}`);
    process.exit(1);
  });
}
