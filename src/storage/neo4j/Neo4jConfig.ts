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
}

/**
 * Default Neo4j configuration
 * Reads configuration from environment variables:
 * - NEO4J_BOLT_HOST_PORT (defaults to 7687)
 * - NEO4J_USERNAME (defaults to 'neo4j')
 * - NEO4J_PASSWORD (defaults to 'memento_password')
 */
export const DEFAULT_NEO4J_CONFIG: Neo4jConfig = {
  uri: `bolt://localhost:${process.env.NEO4J_BOLT_HOST_PORT || '7687'}`,
  username: process.env.NEO4J_USERNAME || 'neo4j',
  password: process.env.NEO4J_PASSWORD || 'memento_password',
  database: 'neo4j',
  vectorIndexName: 'entity_embeddings',
  vectorDimensions: 1536,
  similarityFunction: 'cosine',
};
