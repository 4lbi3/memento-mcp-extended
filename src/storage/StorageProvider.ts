import type { KnowledgeGraph, Entity } from '../KnowledgeGraphManager.js';
import type { Relation } from '../types/relation.js';
/**
 * Options for searching nodes in the knowledge graph
 */
export interface SearchOptions {
  /**
   * Maximum number of results to return
   */
  limit?: number;

  /**
   * Whether the search should be case-sensitive
   */
  caseSensitive?: boolean;

  /**
   * Filter results by entity types
   */
  entityTypes?: string[];
}

/**
 * Interface for storage providers that can load and save knowledge graphs
 */
export interface StorageProvider<
  TEntity extends Entity = Entity,
  TRelation extends Relation = Relation,
> {
  /**
   * Load a knowledge graph from storage
   * @returns Promise resolving to the loaded knowledge graph
   */
  loadGraph(): Promise<KnowledgeGraph<TEntity, TRelation>>;

  /**
   * Save a knowledge graph to storage
   * @param graph The knowledge graph to save
   * @returns Promise that resolves when the save is complete
   */
  saveGraph(graph: KnowledgeGraph<TEntity, TRelation>): Promise<void>;

  /**
   * Search for nodes in the graph that match the query
   * @param query The search query string
   * @param options Optional search parameters
   * @returns Promise resolving to a KnowledgeGraph containing matching nodes
   */
  searchNodes(query: string, options?: SearchOptions): Promise<KnowledgeGraph<TEntity, TRelation>>;

  /**
   * Open specific nodes by their exact names
   * @param names Array of node names to open
   * @returns Promise resolving to a KnowledgeGraph containing the specified nodes
   */
  openNodes(names: string[]): Promise<KnowledgeGraph<TEntity, TRelation>>;

  /**
   * Create new entities in the knowledge graph
   * @param entities Array of entities to create
   * @returns Promise resolving to array of newly created entities with temporal metadata
   */
  createEntities(entities: TEntity[]): Promise<TEntity[]>;

  /**
   * Create new relations between entities
   * @param relations Array of relations to create
   * @returns Promise resolving to array of newly created relations
   */
  createRelations(relations: TRelation[]): Promise<TRelation[]>;

  /**
   * Add observations to entities
   * @param observations Array of objects with entity name and observation contents
   * @returns Promise resolving to array of objects with entity name and added observations
   */
  addObservations(
    observations: { entityName: string; contents: string[] }[]
  ): Promise<{ entityName: string; addedObservations: string[] }[]>;

  /**
   * Delete entities and their relations
   * @param entityNames Array of entity names to delete
   * @returns Promise that resolves when deletion is complete
   */
  deleteEntities(entityNames: string[]): Promise<void>;

  /**
   * Delete observations from entities
   * @param deletions Array of objects with entity name and observations to delete
   * @returns Promise that resolves when deletion is complete
   */
  deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void>;

  /**
   * Delete relations from the graph
   * @param relations Array of relations to delete
   * @returns Promise that resolves when deletion is complete
   */
  deleteRelations(relations: TRelation[]): Promise<void>;

  /**
   * Get a specific relation by its source, target, and type
   * @param from Source entity name
   * @param to Target entity name
   * @param type Relation type
   * @returns Promise resolving to the relation or null if not found
   */
  getRelation?(from: string, to: string, type: string): Promise<Relation | null>;

  /**
   * Update an existing relation with new properties
   * @param relation The relation with updated properties
   * @returns Promise that resolves when the update is complete
   */
  updateRelation?(relation: Relation): Promise<void>;

  /**
   * Get an entity by name
   * @param entityName Name of the entity to retrieve
   * @returns Promise resolving to the entity or null if not found
   */
  getEntity(entityName: string): Promise<TEntity | null>;
}

// Add static methods to the StorageProvider interface for JavaScript tests
// This allows tests to access validation methods directly from the interface
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StorageProvider {
  export function isStorageProvider(obj: unknown): obj is StorageProvider {
    return StorageProviderValidator.isStorageProvider(obj);
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === 'function';

/**
 * Validator class for StorageProvider interface
 * This exists to ensure there's a concrete export for JavaScript tests
 */
export class StorageProviderValidator {
  // No implementation - this is just to ensure the symbol exists in the compiled JS
  // JavaScript tests will use this as a type reference
  static isStorageProvider(obj: unknown): obj is StorageProvider {
    if (!isPlainObject(obj)) {
      return false;
    }

    const requiredMethods = [
      'loadGraph',
      'saveGraph',
      'searchNodes',
      'openNodes',
      'createEntities',
      'createRelations',
      'addObservations',
      'deleteEntities',
      'deleteObservations',
      'deleteRelations',
      'getEntity',
    ] as const;

    const candidate = obj as Record<string, unknown>;

    const hasRequiredMethods = requiredMethods.every((method) => isFunction(candidate[method]));

    const optionalGetRelationValid =
      candidate['getRelation'] === undefined || isFunction(candidate['getRelation']);

    const optionalUpdateRelationValid =
      candidate['updateRelation'] === undefined || isFunction(candidate['updateRelation']);

    return hasRequiredMethods && optionalGetRelationValid && optionalUpdateRelationValid;
  }
}
