import type { KnowledgeGraphManager } from '../KnowledgeGraphManager.js';

type EmbeddingServiceDiagnostics = {
  getModelInfo?: () => unknown;
  getProviderInfo?: () => unknown;
};

type EmbeddingJobManagerDiagnostics = {
  embeddingService?: EmbeddingServiceDiagnostics;
  getPendingJobs?: () => unknown[] | { length: number };
};

type StorageProviderDiagnostics = {
  getConnectionManager?: () => unknown;
  vectorStore?: unknown;
  countEntitiesWithEmbeddings?: () => Promise<number>;
  embeddingService?: EmbeddingServiceDiagnostics;
};

type KnowledgeGraphManagerDiagnostics = KnowledgeGraphManager & {
  storageProvider?: StorageProviderDiagnostics;
  embeddingJobManager?: EmbeddingJobManagerDiagnostics;
};

export type DebugEmbeddingConfigInfo = {
  storage_type: string;
  openai_api_key_present: boolean;
  embedding_model: string;
  embedding_job_manager_initialized: boolean;
  embedding_service_initialized: boolean;
  embedding_service_info: unknown;
  embedding_provider_info: unknown;
  neo4j_config: {
    uri: string;
    username: string;
    database: string;
    vectorIndex: string;
    vectorDimensions: string;
    similarityFunction: string;
    connectionStatus: string;
    vectorStoreStatus?: string;
  };
  entities_with_embeddings: number;
  pending_embedding_jobs: number;
  environment_variables: {
    DEBUG: boolean;
    NODE_ENV?: string;
    MEMORY_STORAGE_TYPE: string;
  };
};

/**
 * Collects detailed diagnostics about the current embedding configuration.
 * Extracted from the call tool handler to keep routing logic concise.
 */
export async function gatherDebugEmbeddingConfig(
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<DebugEmbeddingConfigInfo> {
  const kgm = knowledgeGraphManager as KnowledgeGraphManagerDiagnostics;

  const storageType = process.env.MEMORY_STORAGE_TYPE || 'neo4j';
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

  const storageProvider = kgm.storageProvider;
  const embeddingJobManager = kgm.embeddingJobManager;
  const hasEmbeddingJobManager = !!embeddingJobManager;

  const neo4jInfo = {
    uri: process.env.NEO4J_URI || 'default',
    username: process.env.NEO4J_USERNAME ? 'configured' : 'not configured',
    database: process.env.NEO4J_DATABASE || 'neo4j',
    vectorIndex: process.env.NEO4J_VECTOR_INDEX || 'entity_embeddings',
    vectorDimensions: process.env.NEO4J_VECTOR_DIMENSIONS || '1536',
    similarityFunction: process.env.NEO4J_SIMILARITY_FUNCTION || 'cosine',
    connectionStatus: 'unknown',
    vectorStoreStatus: undefined as string | undefined,
  };

  if (storageProvider?.getConnectionManager) {
    try {
      const connectionManager = storageProvider.getConnectionManager();
      if (connectionManager) {
        neo4jInfo.connectionStatus = 'available';
        neo4jInfo.vectorStoreStatus = storageProvider.vectorStore ? 'available' : 'not initialized';
      }
    } catch (error: Error | unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      neo4jInfo.connectionStatus = `error: ${errorMessage}`;
    }
  }

  let entitiesWithEmbeddings = 0;
  if (storageProvider?.countEntitiesWithEmbeddings) {
    try {
      entitiesWithEmbeddings = await storageProvider.countEntitiesWithEmbeddings();
    } catch (error) {
      process.stderr.write(`[ERROR] Error checking embeddings count: ${error}\n`);
    }
  }

  let embeddingServiceInfo: unknown = null;
  const managerService = embeddingJobManager?.embeddingService;
  if (hasEmbeddingJobManager && managerService?.getModelInfo) {
    try {
      embeddingServiceInfo = managerService.getModelInfo();
    } catch (error: Error | unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[ERROR] Error getting embedding service info: ${errorMessage}\n`);
    }
  }

  let embeddingProviderInfo: unknown = null;
  if (storageProvider?.embeddingService?.getProviderInfo) {
    try {
      embeddingProviderInfo = storageProvider.embeddingService.getProviderInfo();
    } catch (error: Error | unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[ERROR] Error getting embedding provider info: ${errorMessage}\n`);
    }
  }

  let pendingJobs = 0;
  if (hasEmbeddingJobManager && embeddingJobManager?.getPendingJobs) {
    try {
      const jobs = embeddingJobManager.getPendingJobs();
      if (Array.isArray(jobs)) {
        pendingJobs = jobs.length;
      } else if (jobs && typeof jobs.length === 'number') {
        pendingJobs = jobs.length;
      }
    } catch (error: Error | unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[ERROR] Error getting pending jobs: ${errorMessage}\n`);
    }
  }

  return {
    storage_type: storageType,
    openai_api_key_present: hasOpenAIKey,
    embedding_model: embeddingModel,
    embedding_job_manager_initialized: hasEmbeddingJobManager,
    embedding_service_initialized: !!embeddingProviderInfo,
    embedding_service_info: embeddingServiceInfo,
    embedding_provider_info: embeddingProviderInfo,
    neo4j_config: {
      uri: neo4jInfo.uri,
      username: neo4jInfo.username,
      database: neo4jInfo.database,
      vectorIndex: neo4jInfo.vectorIndex,
      vectorDimensions: neo4jInfo.vectorDimensions,
      similarityFunction: neo4jInfo.similarityFunction,
      connectionStatus: neo4jInfo.connectionStatus,
      vectorStoreStatus: neo4jInfo.vectorStoreStatus,
    },
    entities_with_embeddings: entitiesWithEmbeddings,
    pending_embedding_jobs: pendingJobs,
    environment_variables: {
      DEBUG: process.env.DEBUG === 'true',
      NODE_ENV: process.env.NODE_ENV,
      MEMORY_STORAGE_TYPE: storageType,
    },
  };
}
