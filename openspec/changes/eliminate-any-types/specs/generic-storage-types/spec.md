# Generic Storage Types Capability

## Purpose

Introduce generic type parameters to the `StorageProvider` interface to eliminate `any` types in entity and relation operations, enabling full type safety and inference throughout the storage layer.

## ADDED Requirements

### Requirement: Generic Type Parameters in StorageProvider

The `StorageProvider` interface MUST support generic type parameters for entities and relations with sensible defaults to enable type-safe operations without breaking existing code.

#### Scenario: Default generic parameters for backward compatibility

- **GIVEN** the `StorageProvider` interface is defined with generic parameters
- **WHEN** a provider is instantiated without explicit type arguments
- **THEN** the generic parameters default to `Entity` and `Relation` types
- **AND** all entity operations accept and return `Entity` objects
- **AND** all relation operations accept and return `Relation` objects

#### Scenario: Type inference propagates through storage operations

- **GIVEN** a storage provider typed as `StorageProvider<ExtendedEntity, ExtendedRelation>`
- **WHEN** `createEntities()` is called with an array of entities
- **THEN** TypeScript infers the return type as `Promise<ExtendedEntity[]>`
- **AND** no manual type assertions are required in calling code
- **AND** IDE autocomplete suggests `ExtendedEntity` properties

#### Scenario: Generic constraint validation at compile time

- **GIVEN** an entity type that extends the base `Entity` interface
- **WHEN** it is used as a generic parameter for `StorageProvider`
- **THEN** TypeScript accepts the type without errors
- **AND** all required `Entity` properties are preserved
- **AND** additional properties are accessible with proper typing

## MODIFIED Requirements

### Requirement: Entity CRUD Operations with Type Safety

Entity operations in `StorageProvider` MUST preserve type information through generic parameters instead of using `any` types.

**Changes from existing behavior**: Previously used `any[]` for entity arrays and `any | null` for single entities. Now uses generic type parameters that default to `Entity` for full type safety.

#### Scenario: Type-safe entity creation

- **GIVEN** a storage provider with type `StorageProvider<MyEntity>`
- **WHEN** `createEntities([{ name: 'test', type: 'person', customField: 'value' }])` is called
- **THEN** the method accepts the entities array without casting
- **AND** returns `Promise<MyEntity[]>` with temporal metadata included
- **AND** accessing `result[0].customField` is type-safe

#### Scenario: Type-safe entity retrieval

- **GIVEN** a storage provider with type `StorageProvider<ExtendedEntity>`
- **WHEN** `getEntity('entityName')` is called
- **THEN** the return type is `Promise<ExtendedEntity | null>`
- **AND** TypeScript knows the result has `ExtendedEntity` properties if not null
- **AND** no `as any` cast is needed to access extended properties

#### Scenario: Type-safe entity history retrieval

- **GIVEN** a storage provider that supports temporal queries
- **WHEN** `getEntityHistory('entityName')` is called
- **THEN** the return type is `Promise<ExtendedEntity[]>` not `Promise<any[]>`
- **AND** each history entry is properly typed with temporal metadata
- **AND** iterating over results provides full type information

### Requirement: Type-Safe Vector Search Results

Vector similarity search operations MUST return properly typed results with both entity data and similarity scores.

#### Scenario: Similarity search preserves entity types

- **GIVEN** a storage provider implementing `findSimilarEntities`
- **WHEN** the method is called with a query vector
- **THEN** results are typed as `Array<TEntity & { score: number }>`
- **AND** each result provides access to all entity properties
- **AND** the similarity score is accessible as a typed number property

#### Scenario: Semantic search returns typed knowledge graph

- **GIVEN** a storage provider implementing `semanticSearch`
- **WHEN** the method is called with query text and options
- **THEN** the return type is `Promise<KnowledgeGraph<TEntity, TRelation>>`
- **AND** the graph's entities array has type `TEntity[]`
- **AND** the graph's relations array has type `TRelation[]`

### Requirement: Migration Path for Existing Implementations

Existing storage provider implementations MUST be able to adopt generic types incrementally without breaking changes.

#### Scenario: Gradual migration without breaking changes

- **GIVEN** an existing `Neo4jStorageProvider` implementation
- **WHEN** generic parameters are added to the class definition
- **THEN** existing code using `StorageProvider` (without generics) continues to compile
- **AND** new code can use `Neo4jStorageProvider<ExtendedEntity>` for stricter typing
- **AND** both approaches work correctly at runtime

#### Scenario: Default type parameters avoid boilerplate

- **GIVEN** a simple storage provider usage that doesn't need custom types
- **WHEN** the provider is instantiated without type arguments
- **THEN** TypeScript uses default `Entity` and `Relation` types automatically
- **AND** no type arguments need to be specified explicitly
- **AND** the code remains readable and concise

## Implementation Notes

### Type Parameter Constraints

```typescript
interface StorageProvider<
  TEntity extends Entity = Entity,
  TRelation extends Relation = Relation
> {
  // Entity operations use TEntity
  createEntities(entities: TEntity[]): Promise<TEntity[]>;
  getEntity(entityName: string): Promise<TEntity | null>;
  getEntityHistory?(entityName: string): Promise<TEntity[]>;

  // Relation operations use TRelation
  createRelations(relations: TRelation[]): Promise<TRelation[]>;
  getRelation?(from: string, to: string, type: string): Promise<TRelation | null>;
  getRelationHistory?(from: string, to: string, relationType: string): Promise<TRelation[]>;

  // Graph operations use both
  loadGraph(): Promise<KnowledgeGraph<TEntity, TRelation>>;
  saveGraph(graph: KnowledgeGraph<TEntity, TRelation>): Promise<void>;
  getGraphAtTime?(timestamp: number): Promise<KnowledgeGraph<TEntity, TRelation>>;
  getDecayedGraph?(): Promise<KnowledgeGraph<TEntity, TRelation>>;
}
```

### KnowledgeGraph Generic Update

```typescript
interface KnowledgeGraph<
  TEntity extends Entity = Entity,
  TRelation extends Relation = Relation
> {
  entities: TEntity[];
  relations: TRelation[];
}
```

## Testing Strategy

### Compile-Time Type Tests

Create type-level tests to verify inference:

```typescript
// Test: Default parameters work
const provider1: StorageProvider = {} as any;
type Entities1 = Awaited<ReturnType<typeof provider1.createEntities>>;
// Should be Entity[]

// Test: Custom types flow through
const provider2: StorageProvider<ExtendedEntity> = {} as any;
type Entities2 = Awaited<ReturnType<typeof provider2.createEntities>>;
// Should be ExtendedEntity[]

// Test: Both generics work together
const provider3: StorageProvider<ExtendedEntity, ExtendedRelation> = {} as any;
type Graph = Awaited<ReturnType<typeof provider3.loadGraph>>;
// Should be KnowledgeGraph<ExtendedEntity, ExtendedRelation>
```

### Runtime Tests

- Verify existing tests pass without modification
- Add tests for extended entity types to ensure properties are preserved
- Test that type guards work correctly with generic instances

## Related Requirements

- Links to `entity-management` spec for entity operations
- Links to `semantic-search` spec for vector search operations
- Links to `temporal-versioning` spec for history operations
