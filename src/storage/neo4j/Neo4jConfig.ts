/**
 * Configuration options for Neo4j
 */
export interface Neo4jConfig {
  /**
   * The Neo4j server URI (e.g., 'bolt://localhost:7687')
   */
  uri: string;

  /**
   * Username for authentication
   */
  username: string;

  /**
   * Password for authentication
   */
  password: string;

  /**
   * Neo4j database name
   */
  database: string;

  /**
   * Name of the vector index
   */
  vectorIndexName: string;

  /**
   * Dimensions for vector embeddings
   */
  vectorDimensions: number;

  /**
   * Similarity function to use for vector search
   */
  similarityFunction: 'cosine' | 'euclidean';

  /**
   * URI for the dedicated embedding job database
   */
  jobDatabaseUri?: string;

  /**
   * Username for the dedicated embedding job database
   */
  jobDatabaseUsername?: string;

  /**
   * Password for the dedicated embedding job database
   */
  jobDatabasePassword?: string;

  /**
   * Name of the dedicated embedding job database
   */
  jobDatabaseName?: string;

  /**
   * Retention period in days for completed/failed jobs (7-30 days)
   */
  embedJobRetentionDays?: number;
}

/**
 * Parses EMBED_JOB_RETENTION_DAYS environment variable
 * @returns Parsed number or undefined if not set/invalid
 */
function parseEmbedJobRetentionDays(): number | undefined {
  const envValue = process.env.EMBED_JOB_RETENTION_DAYS;
  if (!envValue) {
    return undefined;
  }

  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}

/**
 * Default Neo4j configuration
 * Reads configuration from environment variables:
 * - NEO4J_BOLT_HOST_PORT (defaults to 7687)
 * - NEO4J_USERNAME (defaults to 'neo4j')
 * - NEO4J_PASSWORD (defaults to 'memento_password')
 * - EMBED_JOB_DATABASE_URI (optional, defaults to same as main database)
 * - EMBED_JOB_DATABASE_USERNAME (optional, defaults to main database username)
 * - EMBED_JOB_DATABASE_PASSWORD (optional, defaults to main database password)
 * - EMBED_JOB_DATABASE_NAME (optional, defaults to 'embedding-jobs')
 * - EMBED_JOB_RETENTION_DAYS (required, allowed 7-30)
 */
function resolveNeo4jUri(): string {
  return process.env.NEO4J_URI || `bolt://localhost:${process.env.NEO4J_BOLT_HOST_PORT || '7687'}`;
}

export const DEFAULT_NEO4J_CONFIG: Neo4jConfig = {
  uri: resolveNeo4jUri(),
  username: process.env.NEO4J_USERNAME || 'neo4j',
  password: process.env.NEO4J_PASSWORD || 'memento_password',
  database: 'neo4j',
  vectorIndexName: 'entity_embeddings',
  vectorDimensions: 1536,
  similarityFunction: 'cosine',
  jobDatabaseUri:
    process.env.EMBED_JOB_DATABASE_URI ||
    process.env.NEO4J_URI ||
    `bolt://localhost:${process.env.NEO4J_BOLT_HOST_PORT || '7687'}`,
  jobDatabaseUsername:
    process.env.EMBED_JOB_DATABASE_USERNAME || process.env.NEO4J_USERNAME || 'neo4j',
  jobDatabasePassword:
    process.env.EMBED_JOB_DATABASE_PASSWORD || process.env.NEO4J_PASSWORD || 'memento_password',
  jobDatabaseName: process.env.EMBED_JOB_DATABASE_NAME || 'embedding-jobs',
  embedJobRetentionDays: parseEmbedJobRetentionDays(),
};

/**
 * Validates the Neo4j configuration
 * @param config Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateNeo4jConfig(config: Neo4jConfig): void {
  // Validate retention days - must be explicitly set and valid
  const retentionDays = config.embedJobRetentionDays;
  if (retentionDays === undefined) {
    throw new Error(
      'EMBED_JOB_RETENTION_DAYS must be explicitly set to a value between 7 and 30 days'
    );
  }
  if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 30) {
    throw new Error(
      `EMBED_JOB_RETENTION_DAYS must be an integer between 7 and 30 days, got ${retentionDays}`
    );
  }

  // Validate required fields
  if (!config.uri) {
    throw new Error('Neo4j URI is required');
  }
  if (!config.username) {
    throw new Error('Neo4j username is required');
  }
  if (!config.password) {
    throw new Error('Neo4j password is required');
  }
  if (!config.database) {
    throw new Error('Neo4j database name is required');
  }
}
