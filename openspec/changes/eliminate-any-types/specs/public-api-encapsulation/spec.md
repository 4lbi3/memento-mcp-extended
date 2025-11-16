# Public API Encapsulation Capability

## Purpose

Replace private property access patterns (via string indexing and type assertions) with explicit public API methods that maintain encapsulation while providing necessary functionality.

## ADDED Requirements

### Requirement: Embedding Service Public API

The `EmbeddingJobManager` MUST expose public methods for accessing embedding service functionality instead of allowing direct access to private `embeddingService` property.

#### Scenario: Get embedding service through public method

- **GIVEN** a `Neo4jEmbeddingJobManager` instance with an initialized embedding service
- **WHEN** `getEmbeddingService()` is called
- **THEN** the method returns the underlying `EmbeddingService` instance
- **AND** no string-indexed property access is required
- **AND** TypeScript recognizes the return type as `EmbeddingService`

#### Scenario: Get embedding model information

- **GIVEN** a `Neo4jEmbeddingJobManager` instance
- **WHEN** `getModelInfo()` is called
- **THEN** the method returns an object with `{ name: string; dimensions: number }`
- **AND** the information is retrieved from the embedding service
- **AND** callers don't need direct service access for this common query

#### Scenario: Private property remains encapsulated

- **GIVEN** a `Neo4jEmbeddingJobManager` instance
- **WHEN** TypeScript strict mode is enabled
- **THEN** accessing `embeddingJobManager['embeddingService']` produces a type error
- **AND** the only way to access the service is through `getEmbeddingService()`
- **AND** refactoring the internal implementation doesn't break callers

## MODIFIED Requirements

### Requirement: KnowledgeGraphManager Embedding Access

`KnowledgeGraphManager` MUST access embedding services through public API methods instead of private property string indexing.

**Changes from existing behavior**: Previously used `this.embeddingJobManager['embeddingService']` to access the private property. Now uses public `getEmbeddingService()` method.

#### Scenario: Find similar entities uses public API

- **GIVEN** `KnowledgeGraphManager.findSimilarEntities()` needs to generate query embeddings
- **WHEN** it needs access to the embedding service
- **THEN** it calls `this.embeddingJobManager.getEmbeddingService()`
- **AND** no string indexing like `['embeddingService']` is used
- **AND** the call is type-safe with autocomplete support

#### Scenario: Semantic search uses public API

- **GIVEN** `KnowledgeGraphManager.semanticSearch()` needs embedding generation
- **WHEN** it retrieves the embedding service
- **THEN** it uses `this.embeddingJobManager.getEmbeddingService()`
- **AND** TypeScript validates the method call at compile time
- **AND** the service is guaranteed to exist or the manager throws a clear error

### Requirement: Connection Manager Public Access

Neo4j-specific storage providers MUST expose connection manager access through a public method instead of property casting.

#### Scenario: Public connection manager accessor

- **GIVEN** a `Neo4jStorageProvider` instance with a connection manager
- **WHEN** `getConnectionManager()` is called
- **THEN** the method returns the `Neo4jConnectionManager` instance
- **AND** no `as any` cast is required
- **AND** the return type is properly typed

#### Scenario: Type guard for connection capability

- **GIVEN** a generic `StorageProvider` instance
- **WHEN** checking if it supports connection manager access
- **THEN** `hasConnectionManager(provider)` type guard returns a boolean
- **AND** if true, TypeScript narrows the type to `ConnectionCapableProvider`
- **AND** the `getConnectionManager()` method becomes accessible

#### Scenario: Initialization code uses typed access

- **GIVEN** application initialization in `index.ts`
- **WHEN** setting up the embedding job manager with entity connection manager
- **THEN** it uses `storageProvider.getConnectionManager()` if capability exists
- **AND** no cast to `any` is used: `(storageProvider as any).connectionManager`
- **AND** compile-time errors prevent incorrect usage

### Requirement: Storage Provider Capability Detection

Storage providers MUST support runtime capability detection through typed interfaces and type guards instead of dynamic property checks with `any`.

#### Scenario: Embedding capability interface

- **GIVEN** a storage provider that supports embedding operations
- **WHEN** the provider implements `EmbeddingCapableProvider` interface
- **THEN** it provides `getEntityEmbedding()` and `updateEntityEmbedding()` methods
- **AND** the interface extends base `StorageProvider` interface
- **AND** implementations are verified by TypeScript compiler

#### Scenario: Type guard for embedding capability

- **GIVEN** a generic `StorageProvider` instance in handler code
- **WHEN** checking for embedding support using `hasEmbeddingCapability(provider)`
- **THEN** the type guard returns a boolean indicating support
- **AND** if true, TypeScript narrows the type to `EmbeddingCapableProvider`
- **AND** embedding methods are accessible without any type assertions

#### Scenario: Handler code uses capability-based access

- **GIVEN** the `get_entity_embedding` tool handler in `callToolHandler.ts`
- **WHEN** it needs to retrieve entity embeddings
- **THEN** it uses `hasEmbeddingCapability(storageProvider)` to check support
- **AND** if supported, calls `storageProvider.getEntityEmbedding(entityName)` safely
- **AND** no `kgmAny` variable or `as any` cast exists in the code

## Implementation Notes

### EmbeddingJobManager Public API

```typescript
export class Neo4jEmbeddingJobManager {
  private embeddingService: EmbeddingService;

  /**
   * Get the underlying embedding service for direct API access
   * @returns The configured embedding service instance
   */
  public getEmbeddingService(): EmbeddingService {
    return this.embeddingService;
  }

  /**
   * Get information about the embedding model being used
   * @returns Object containing model name and vector dimensions
   */
  public getModelInfo(): { name: string; dimensions: number } {
    return this.embeddingService.getModelInfo();
  }
}
```

### Capability Interfaces Pattern

```typescript
/**
 * Extended interface for providers that support embedding operations
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
 * Type guard to check if a provider supports embedding operations
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
```

### Connection Manager Capability

```typescript
/**
 * Extended interface for Neo4j providers with connection manager access
 */
export interface ConnectionCapableProvider extends StorageProvider {
  /**
   * Get the Neo4j connection manager for advanced operations
   */
  getConnectionManager(): Neo4jConnectionManager;
}

/**
 * Type guard to check if a provider exposes connection manager
 */
export function hasConnectionManager(
  provider: StorageProvider
): provider is ConnectionCapableProvider {
  return (
    'getConnectionManager' in provider &&
    typeof (provider as any).getConnectionManager === 'function'
  );
}
```

### Usage in KnowledgeGraphManager

```typescript
async findSimilarEntities(
  query: string,
  options: { limit?: number; threshold?: number } = {}
): Promise<Array<{ name: string; score: number }>> {
  if (!this.embeddingJobManager) {
    throw new SemanticSearchFallbackError('embedding_job_manager_missing');
  }

  // Use public API instead of private property access
  const embeddingService = this.embeddingJobManager.getEmbeddingService();

  // Rest of implementation...
}
```

### Usage in Tool Handlers

```typescript
// callToolHandler.ts - get_entity_embedding handler
if (toolName === 'get_entity_embedding') {
  const entity = await knowledgeGraphManager.openNodes([String(args.entity_name)]);
  if (!entity.entities || entity.entities.length === 0) {
    return { content: [{ type: 'text', text: `Entity not found: ${args.entity_name}` }] };
  }

  // Use capability-based access instead of any cast
  const storageProvider = knowledgeGraphManager.getStorageProvider();
  if (hasEmbeddingCapability(storageProvider)) {
    const embedding = await storageProvider.getEntityEmbedding(String(args.entity_name));

    if (!embedding) {
      return {
        content: [
          { type: 'text', text: `No embedding found for entity: ${args.entity_name}` }
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            entityName: args.entity_name,
            embedding: embedding.vector,
            model: embedding.model || 'unknown',
            dimensions: embedding.vector.length,
            lastUpdated: embedding.lastUpdated,
          }),
        },
      ],
    };
  }

  // Provider doesn't support embeddings
  return {
    content: [
      { type: 'text', text: 'Storage provider does not support embedding operations' }
    ],
  };
}
```

## Testing Strategy

### Encapsulation Tests

```typescript
describe('EmbeddingJobManager public API', () => {
  it('exposes embedding service through public method', () => {
    const manager = new Neo4jEmbeddingJobManager(...);
    const service = manager.getEmbeddingService();
    expect(service).toBeInstanceOf(EmbeddingService);
  });

  it('provides model info through public method', () => {
    const manager = new Neo4jEmbeddingJobManager(...);
    const info = manager.getModelInfo();
    expect(info).toHaveProperty('name');
    expect(info).toHaveProperty('dimensions');
  });
});
```

### Capability Detection Tests

```typescript
describe('Storage provider capability detection', () => {
  it('detects embedding capability on Neo4j provider', () => {
    const provider = new Neo4jStorageProvider(...);
    expect(hasEmbeddingCapability(provider)).toBe(true);
  });

  it('detects missing embedding capability on file provider', () => {
    const provider = new FileStorageProvider(...);
    expect(hasEmbeddingCapability(provider)).toBe(false);
  });

  it('provides type-safe access after capability check', async () => {
    const provider: StorageProvider = new Neo4jStorageProvider(...);

    if (hasEmbeddingCapability(provider)) {
      // TypeScript knows provider has getEntityEmbedding here
      const embedding = await provider.getEntityEmbedding('test');
      // Should compile without any type assertions
    }
  });
});
```

### No Private Access Tests

```typescript
describe('Private property encapsulation', () => {
  it('prevents string-indexed private access in strict mode', () => {
    const manager = new Neo4jEmbeddingJobManager(...);

    // This should cause a TypeScript error in strict mode:
    // const service = manager['embeddingService'];

    // This should work:
    const service = manager.getEmbeddingService();
    expect(service).toBeDefined();
  });
});
```

## Related Requirements

- Links to `embedding-jobs` spec for embedding job management
- Links to `semantic-search` spec for vector operations
- Supports generic types from `generic-storage-types` capability
