import type { KnowledgeGraph, Entity } from '../KnowledgeGraphManager.js';
import type { SearchOptions, StorageProvider } from './StorageProvider.js';
import type { Neo4jConnectionManager } from './neo4j/Neo4jConnectionManager.js';
import type { Relation } from '../types/relation.js';
import type { EntityEmbedding, SemanticSearchOptions } from '../types/entity-embedding.js';

/**
 * Storage providers that can persist and retrieve entity embeddings.
 */
export interface EmbeddingCapableProvider<TEntity extends Entity = Entity>
  extends StorageProvider<TEntity> {
  /**
   * Store or update the embedding vector for an entity
   */
  updateEntityEmbedding(entityName: string, embedding: EntityEmbedding): Promise<void>;

  /**
   * Retrieve an entity's embedding vector
   */
  getEntityEmbedding(entityName: string): Promise<EntityEmbedding | null>;

  /**
   * Enumerate entities that still lack embeddings
   */
  getEntitiesWithoutEmbeddings(limit?: number): Promise<TEntity[]>;

  /**
   * Count how many entities currently have embeddings
   */
  countEntitiesWithEmbeddings(): Promise<number>;
}

/**
 * Storage providers that expose access to a Neo4j connection manager.
 */
export interface ConnectionCapableProvider extends StorageProvider {
  getConnectionManager(): Neo4jConnectionManager;
}

/**
 * Storage providers that can clean archived data safely.
 */
export interface PurgeCapableProvider extends StorageProvider {
  purgeArchivedEntities(cutoffTimestamp: number): Promise<number>;
  purgeArchivedRelations(cutoffTimestamp: number): Promise<number>;
}

/**
 * Storage providers that support vector search and semantic retrieval.
 */
export interface VectorSearchCapableProvider<TEntity extends Entity = Entity>
  extends StorageProvider<TEntity> {
  findSimilarEntities(
    queryVector: number[],
    limit?: number
  ): Promise<Array<TEntity & { score: number }>>;
  semanticSearch(
    query: string,
    options?: SearchOptions & SemanticSearchOptions
  ): Promise<KnowledgeGraph<TEntity, Relation>>;
}

/**
 * Storage providers that expose temporal querying capabilities.
 */
export interface TemporalCapableProvider<
  TEntity extends Entity = Entity,
  TRelation extends Relation = Relation,
> extends StorageProvider<TEntity, TRelation> {
  getEntityHistory(entityName: string): Promise<TEntity[]>;
  getRelationHistory(from: string, to: string, relationType: string): Promise<TRelation[]>;
  getGraphAtTime(timestamp: number): Promise<KnowledgeGraph<TEntity, TRelation>>;
  getDecayedGraph(): Promise<KnowledgeGraph<TEntity, TRelation>>;
}

/**
 * Guard for embedding capabilities.
 */
export function hasEmbeddingCapability<TEntity extends Entity = Entity>(
  provider: StorageProvider<TEntity>
): provider is EmbeddingCapableProvider<TEntity> {
  return typeof (provider as EmbeddingCapableProvider<TEntity>).getEntityEmbedding === 'function';
}

/**
 * Guard for connection manager access.
 */
export function hasConnectionManager(
  provider: StorageProvider
): provider is ConnectionCapableProvider {
  return typeof (provider as ConnectionCapableProvider).getConnectionManager === 'function';
}

/**
 * Guard for purge helpers.
 */
export function hasPurgeCapability(provider: StorageProvider): provider is PurgeCapableProvider {
  return (
    typeof (provider as PurgeCapableProvider).purgeArchivedEntities === 'function' &&
    typeof (provider as PurgeCapableProvider).purgeArchivedRelations === 'function'
  );
}

/**
 * Guard for vector search features.
 */
export function hasVectorSearchCapability<TEntity extends Entity = Entity>(
  provider: StorageProvider<TEntity>
): provider is VectorSearchCapableProvider<TEntity> {
  return (
    typeof (provider as VectorSearchCapableProvider<TEntity>).findSimilarEntities === 'function' &&
    typeof (provider as VectorSearchCapableProvider<TEntity>).semanticSearch === 'function'
  );
}

/**
 * Guard for temporal capabilities.
 */
export function hasTemporalCapability<
  TEntity extends Entity = Entity,
  TRelation extends Relation = Relation,
>(provider: StorageProvider<TEntity, TRelation>): provider is TemporalCapableProvider<TEntity, TRelation> {
  return (
    typeof (provider as TemporalCapableProvider<TEntity, TRelation>).getEntityHistory ===
      'function' &&
    typeof (provider as TemporalCapableProvider<TEntity, TRelation>).getGraphAtTime === 'function'
  );
}

/**
 * Composite guard for semantic search (requires vector search + embeddings).
 */
export function hasSemanticSearchCapabilities<TEntity extends Entity = Entity>(
  provider: StorageProvider<TEntity>
): provider is EmbeddingCapableProvider<TEntity> & VectorSearchCapableProvider<TEntity> {
  return hasEmbeddingCapability(provider) && hasVectorSearchCapability(provider);
}
