# Type Guard Capabilities

## Purpose

Establish a systematic pattern for runtime capability detection using TypeScript type guards that provide both runtime validation and compile-time type narrowing, eliminating the need for `any` assertions.

## ADDED Requirements

### Requirement: Capability Interface Pattern

Storage providers MUST declare optional capabilities through extending interfaces rather than optional method signatures with `any` types.

#### Scenario: Capability interface extends base interface

- **GIVEN** a storage provider that supports a specific optional capability
- **WHEN** defining the capability interface
- **THEN** the interface extends `StorageProvider` base interface
- **AND** adds typed method signatures for the capability
- **AND** uses proper generic constraints where applicable

#### Scenario: Multiple capabilities can be composed

- **GIVEN** a storage provider that supports multiple capabilities (e.g., embeddings + temporal queries)
- **WHEN** declaring the provider's type
- **THEN** it can implement multiple capability interfaces simultaneously
- **AND** TypeScript validates all required methods are implemented
- **AND** each capability's methods have correct type signatures

#### Scenario: Base interface remains minimal

- **GIVEN** the `StorageProvider` base interface
- **WHEN** reviewing required (non-optional) methods
- **THEN** only core CRUD operations are required
- **AND** all advanced features are moved to capability interfaces
- **AND** simple implementations don't need to stub optional methods

### Requirement: Type Guard Implementation

Each capability interface MUST have a corresponding type guard function that performs runtime validation and enables TypeScript type narrowing.

#### Scenario: Type guard validates capability at runtime

- **GIVEN** a type guard function like `hasEmbeddingCapability(provider)`
- **WHEN** called with a storage provider instance
- **THEN** it checks for presence of all required methods using `in` operator
- **AND** validates each method is a function using `typeof`
- **AND** returns `true` only if all capability requirements are met

#### Scenario: Type guard enables type narrowing

- **GIVEN** a storage provider with type `StorageProvider`
- **WHEN** wrapped in an `if (hasEmbeddingCapability(provider))` conditional
- **THEN** within the conditional block, TypeScript narrows type to `EmbeddingCapableProvider`
- **AND** capability methods are accessible without type assertions
- **AND** IDE autocomplete suggests capability-specific methods

#### Scenario: Failed type guard preserves safety

- **GIVEN** a storage provider that doesn't implement a capability
- **WHEN** the type guard returns `false`
- **THEN** TypeScript prevents accessing capability-specific methods in the else block
- **AND** attempting to call the methods results in compile-time error
- **AND** runtime errors are prevented by the guard check

### Requirement: Standardized Capability Naming

Capability interfaces and their type guards MUST follow consistent naming conventions for discoverability and maintainability.

#### Scenario: Capability interface naming convention

- **GIVEN** a capability related to vector embeddings
- **WHEN** defining the capability interface
- **THEN** the interface name follows the pattern `[Capability]CapableProvider`
- **AND** it clearly indicates what capability it provides (e.g., `EmbeddingCapableProvider`)
- **AND** the `Provider` suffix indicates it extends `StorageProvider`

#### Scenario: Type guard naming convention

- **GIVEN** a capability interface named `EmbeddingCapableProvider`
- **WHEN** defining the type guard function
- **THEN** the function name follows the pattern `has[Capability](provider)`
- **AND** it takes a `StorageProvider` parameter
- **AND** it returns a type predicate: `provider is [Capability]CapableProvider`

#### Scenario: Documentation explains capability scope

- **GIVEN** a capability interface or type guard
- **WHEN** reviewing JSDoc comments
- **THEN** the comment clearly explains what operations the capability enables
- **AND** lists the methods provided by the capability
- **AND** provides an example of usage with the type guard

### Requirement: Capability Composition

Type guards MUST support checking for combinations of capabilities when multiple features are required together.

#### Scenario: Composite capability check

- **GIVEN** code that requires both embedding and temporal query capabilities
- **WHEN** checking for both capabilities
- **THEN** both type guards can be used: `hasEmbeddingCapability(p) && hasTemporalCapability(p)`
- **AND** TypeScript infers the intersection type of both capability interfaces
- **AND** all methods from both capabilities are accessible in the conditional block

#### Scenario: Helper for common capability combinations

- **GIVEN** a frequently-used combination of capabilities
- **WHEN** defining a composite type guard
- **THEN** it can check multiple capabilities in one call
- **AND** returns a type predicate for the intersection type
- **AND** provides better error messages for missing capabilities

Example:
```typescript
function hasSemanticSearchCapabilities(
  provider: StorageProvider
): provider is EmbeddingCapableProvider & VectorSearchCapableProvider {
  return hasEmbeddingCapability(provider) && hasVectorSearchCapability(provider);
}
```

## MODIFIED Requirements

### Requirement: Optional Method Migration

All optional methods in `StorageProvider` interface that use `any` types MUST be migrated to capability interfaces with proper typing.

**Changes from existing behavior**: Previously, optional methods were defined directly on `StorageProvider` with `any` types and `?` syntax. Now, they are moved to dedicated capability interfaces with proper generic types.

#### Scenario: Temporal capability extraction

- **GIVEN** optional methods `getEntityHistory?()`, `getRelationHistory?()`, `getGraphAtTime?()`
- **WHEN** migrating to capability pattern
- **THEN** they are moved to `TemporalCapableProvider` interface
- **AND** return types change from `any[]` to properly typed generic arrays
- **AND** a `hasTemporalCapability()` type guard is provided

#### Scenario: Vector search capability extraction

- **GIVEN** optional methods `findSimilarEntities?()`, `semanticSearch?()`
- **WHEN** migrating to capability pattern
- **THEN** they are moved to `VectorSearchCapableProvider` interface
- **AND** return types use generic type parameters for entities
- **AND** a `hasVectorSearchCapability()` type guard is provided

#### Scenario: Embedding capability extraction

- **GIVEN** optional methods `updateEntityEmbedding?()`, `getEntityEmbedding?()`
- **WHEN** migrating to capability pattern
- **THEN** they are moved to `EmbeddingCapableProvider` interface
- **AND** return types use `EntityEmbedding` type instead of `any`
- **AND** a `hasEmbeddingCapability()` type guard is provided

## Implementation Notes

### Capability Interface Definitions

```typescript
// src/storage/StorageProvider.ts

/**
 * Capability: Vector-based similarity search operations
 */
export interface VectorSearchCapableProvider<TEntity extends Entity = Entity>
  extends StorageProvider<TEntity> {
  /**
   * Find entities similar to a query vector
   */
  findSimilarEntities(
    queryVector: number[],
    limit?: number
  ): Promise<Array<TEntity & { score: number }>>;

  /**
   * Search for entities using semantic search with text query
   */
  semanticSearch(
    query: string,
    options?: SearchOptions & SemanticSearchOptions
  ): Promise<KnowledgeGraph<TEntity>>;
}

/**
 * Capability: Temporal versioning and point-in-time queries
 */
export interface TemporalCapableProvider<
  TEntity extends Entity = Entity,
  TRelation extends Relation = Relation
> extends StorageProvider<TEntity, TRelation> {
  /**
   * Get the history of all versions of an entity
   */
  getEntityHistory(entityName: string): Promise<TEntity[]>;

  /**
   * Get the history of all versions of a relation
   */
  getRelationHistory(from: string, to: string, relationType: string): Promise<TRelation[]>;

  /**
   * Get the state of the knowledge graph at a specific point in time
   */
  getGraphAtTime(timestamp: number): Promise<KnowledgeGraph<TEntity, TRelation>>;

  /**
   * Get the current graph with confidence decay applied
   */
  getDecayedGraph(): Promise<KnowledgeGraph<TEntity, TRelation>>;
}

/**
 * Capability: Vector embedding storage and retrieval
 */
export interface EmbeddingCapableProvider extends StorageProvider {
  /**
   * Get embedding vector for a specific entity
   */
  getEntityEmbedding(entityName: string): Promise<EntityEmbedding | null>;

  /**
   * Update or store embedding vector for an entity
   */
  updateEntityEmbedding(entityName: string, embedding: EntityEmbedding): Promise<void>;
}

/**
 * Capability: Access to Neo4j connection manager for advanced operations
 */
export interface ConnectionCapableProvider extends StorageProvider {
  /**
   * Get the Neo4j connection manager instance
   */
  getConnectionManager(): Neo4jConnectionManager;
}

/**
 * Capability: Purging archived/soft-deleted data
 */
export interface PurgeCapableProvider extends StorageProvider {
  /**
   * Permanently remove archived entity versions before the cutoff timestamp
   */
  purgeArchivedEntities(cutoffTimestamp: number): Promise<number>;

  /**
   * Permanently remove archived relations before the cutoff timestamp
   */
  purgeArchivedRelations(cutoffTimestamp: number): Promise<number>;
}
```

### Type Guard Implementations

```typescript
// src/storage/StorageProvider.ts

/**
 * Check if a provider supports vector-based similarity search
 */
export function hasVectorSearchCapability<TEntity extends Entity = Entity>(
  provider: StorageProvider
): provider is VectorSearchCapableProvider<TEntity> {
  return (
    'findSimilarEntities' in provider &&
    typeof (provider as any).findSimilarEntities === 'function' &&
    'semanticSearch' in provider &&
    typeof (provider as any).semanticSearch === 'function'
  );
}

/**
 * Check if a provider supports temporal versioning operations
 */
export function hasTemporalCapability<
  TEntity extends Entity = Entity,
  TRelation extends Relation = Relation
>(
  provider: StorageProvider
): provider is TemporalCapableProvider<TEntity, TRelation> {
  return (
    'getEntityHistory' in provider &&
    typeof (provider as any).getEntityHistory === 'function' &&
    'getRelationHistory' in provider &&
    typeof (provider as any).getRelationHistory === 'function' &&
    'getGraphAtTime' in provider &&
    typeof (provider as any).getGraphAtTime === 'function'
  );
}

/**
 * Check if a provider supports embedding operations
 */
export function hasEmbeddingCapability(
  provider: StorageProvider
): provider is EmbeddingCapableProvider {
  return (
    'getEntityEmbedding' in provider &&
    typeof (provider as any).getEntityEmbedding === 'function' &&
    'updateEntityEmbedding' in provider &&
    typeof (provider as any).updateEntityEmbedding === 'function'
  );
}

/**
 * Check if a provider exposes connection manager access
 */
export function hasConnectionManager(
  provider: StorageProvider
): provider is ConnectionCapableProvider {
  return (
    'getConnectionManager' in provider &&
    typeof (provider as any).getConnectionManager === 'function'
  );
}

/**
 * Check if a provider supports purging archived data
 */
export function hasPurgeCapability(
  provider: StorageProvider
): provider is PurgeCapableProvider {
  return (
    'purgeArchivedEntities' in provider &&
    typeof (provider as any).purgeArchivedEntities === 'function' &&
    'purgeArchivedRelations' in provider &&
    typeof (provider as any).purgeArchivedRelations === 'function'
  );
}

/**
 * Composite type guard for semantic search (requires both embedding and vector search)
 */
export function hasSemanticSearchCapabilities<TEntity extends Entity = Entity>(
  provider: StorageProvider
): provider is EmbeddingCapableProvider & VectorSearchCapableProvider<TEntity> {
  return hasEmbeddingCapability(provider) && hasVectorSearchCapability(provider);
}
```

### Usage Examples

```typescript
// Example 1: Simple capability check
async function getEntityHistory(provider: StorageProvider, entityName: string) {
  if (hasTemporalCapability(provider)) {
    // TypeScript knows provider has getEntityHistory() here
    return await provider.getEntityHistory(entityName);
  }
  throw new Error('Provider does not support temporal queries');
}

// Example 2: Composite capability check
async function performSemanticSearch(provider: StorageProvider, query: string) {
  if (hasSemanticSearchCapabilities(provider)) {
    // TypeScript knows provider has both embedding and vector search methods
    return await provider.semanticSearch(query, { limit: 10 });
  }
  throw new Error('Provider does not support semantic search');
}

// Example 3: Multiple capabilities
async function advancedQuery(provider: StorageProvider, entityName: string) {
  const supportsEmbedding = hasEmbeddingCapability(provider);
  const supportsTemporal = hasTemporalCapability(provider);

  if (!supportsEmbedding || !supportsTemporal) {
    throw new Error('Provider missing required capabilities');
  }

  // Both capabilities available here
  const embedding = await provider.getEntityEmbedding(entityName);
  const history = await provider.getEntityHistory(entityName);

  return { embedding, history };
}
```

## Testing Strategy

### Type Narrowing Tests (Compile-Time)

```typescript
// These should compile without errors
function testTypeNarrowing(provider: StorageProvider) {
  if (hasEmbeddingCapability(provider)) {
    // Should compile - capability methods accessible
    const embedding: Promise<EntityEmbedding | null> =
      provider.getEntityEmbedding('test');
  }

  if (hasTemporalCapability(provider)) {
    // Should compile - generic types inferred
    const history: Promise<Entity[]> = provider.getEntityHistory('test');
  }

  // Should NOT compile - capability not checked
  // const embedding = provider.getEntityEmbedding('test'); // Error!
}
```

### Runtime Validation Tests

```typescript
describe('Capability type guards', () => {
  it('detects embedding capability on Neo4j provider', () => {
    const provider = new Neo4jStorageProvider(...);
    expect(hasEmbeddingCapability(provider)).toBe(true);
  });

  it('detects missing embedding capability on file provider', () => {
    const provider = new FileStorageProvider(...);
    expect(hasEmbeddingCapability(provider)).toBe(false);
  });

  it('validates all methods in composite capability check', () => {
    const provider = new Neo4jStorageProvider(...);
    expect(hasSemanticSearchCapabilities(provider)).toBe(true);

    const partial = { ...provider, semanticSearch: undefined };
    expect(hasSemanticSearchCapabilities(partial as any)).toBe(false);
  });
});
```

### Capability Composition Tests

```typescript
describe('Capability composition', () => {
  it('supports multiple capability checks', () => {
    const provider = new Neo4jStorageProvider(...);

    const hasEmbedding = hasEmbeddingCapability(provider);
    const hasTemporal = hasTemporalCapability(provider);

    expect(hasEmbedding).toBe(true);
    expect(hasTemporal).toBe(true);
  });

  it('composite type guard validates all requirements', () => {
    const provider: StorageProvider = new Neo4jStorageProvider(...);

    if (hasSemanticSearchCapabilities(provider)) {
      // Both capabilities should be available
      expect(typeof provider.getEntityEmbedding).toBe('function');
      expect(typeof provider.semanticSearch).toBe('function');
    }
  });
});
```

## Related Requirements

- Supports `generic-storage-types` capability for typed operations
- Used by `public-api-encapsulation` for capability-based access
- Links to `embedding-jobs` spec for embedding operations
- Links to `temporal-versioning` spec for history operations
- Links to `semantic-search` spec for vector search operations
