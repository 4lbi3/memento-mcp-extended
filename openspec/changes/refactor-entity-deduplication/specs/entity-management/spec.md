# Entity Management Specification Deltas

## ADDED Requirements

### Requirement: Database-Level Entity Deduplication

The storage provider SHALL perform entity deduplication at the database level using atomic operations, eliminating the need for the application layer to load existing entities into memory.

#### Scenario: Create duplicate entity with MERGE
- **GIVEN** an entity with name "Alice" exists in the database
- **WHEN** `createEntities([{name: "Alice", entityType: "person", observations: ["new fact"]}])` is called
- **THEN** the storage provider SHALL use a database-level MERGE operation
- **AND** no new entity node SHALL be created
- **AND** the existing entity MAY be updated with merged observations (implementation-specific)
- **AND** the operation SHALL complete without loading the entire graph into memory

#### Scenario: Create new entity with MERGE
- **GIVEN** no entity with name "Bob" exists in the database
- **WHEN** `createEntities([{name: "Bob", entityType: "person", observations: ["fact"]}])` is called
- **THEN** the storage provider SHALL use a database-level MERGE operation
- **AND** a new entity node SHALL be created with the provided attributes
- **AND** the operation SHALL complete without loading the entire graph into memory

#### Scenario: Scalability with large graphs
- **GIVEN** a knowledge graph contains 100,000+ entities
- **WHEN** `createEntities([{name: "NewEntity", ...}])` is called
- **THEN** the operation SHALL complete in constant time O(1) regardless of graph size
- **AND** memory usage SHALL be independent of the total entity count
- **AND** only the entities being created SHALL be loaded into memory

### Requirement: Manager Delegation of Entity Creation

The `KnowledgeGraphManager` SHALL delegate all entity deduplication logic to the storage provider, removing any in-memory graph loading for deduplication purposes.

#### Scenario: Manager delegates to storage provider
- **GIVEN** a storage provider is configured
- **WHEN** `KnowledgeGraphManager.createEntities()` is called
- **THEN** the manager SHALL NOT call `loadGraph()` for deduplication
- **AND** the manager SHALL pass entities directly to `storageProvider.createEntities()`
- **AND** deduplication SHALL be handled entirely by the storage provider

#### Scenario: Embedding job scheduling after entity creation
- **GIVEN** an embedding job manager is configured
- **WHEN** entities are successfully created via the storage provider
- **THEN** the manager SHALL schedule embedding jobs for the newly created entities
- **AND** embedding scheduling SHALL occur after the storage provider completes

## MODIFIED Requirements

### Requirement: Neo4j Entity Creation with Temporal Versioning

The Neo4j storage provider SHALL create entities using `MERGE` operations to ensure uniqueness based on the combination of entity name and `validTo IS NULL`, maintaining the temporal versioning model while preventing duplicate current-version entities.

#### Scenario: MERGE on entity name with temporal constraint
- **GIVEN** the Neo4j storage provider is active
- **WHEN** `createEntities([entity])` is called
- **THEN** the provider SHALL execute a Cypher query with `MERGE (e:Entity {name: $name, validTo: NULL})`
- **AND** the `ON CREATE SET` clause SHALL initialize all entity properties (id, entityType, observations, version, timestamps)
- **AND** if the entity already exists, no duplicate SHALL be created
- **AND** the operation SHALL occur within a transaction

#### Scenario: Batch entity creation with MERGE
- **GIVEN** multiple entities are provided for creation
- **WHEN** `createEntities([entity1, entity2, entity3])` is called
- **THEN** each entity SHALL be processed with individual MERGE queries
- **AND** all MERGE operations SHALL occur within a single transaction
- **AND** if any entity creation fails, all SHALL be rolled back
- **AND** the transaction SHALL commit only after all entities are processed

#### Scenario: Temporal versioning preservation
- **GIVEN** an entity "Alice" with version 1 and `validTo = 1234567890` exists (archived)
- **AND** an entity "Alice" with version 2 and `validTo IS NULL` exists (current)
- **WHEN** `createEntities([{name: "Alice", ...}])` is called
- **THEN** the MERGE operation SHALL match only the current version (`validTo IS NULL`)
- **AND** archived versions SHALL remain unchanged
- **AND** no duplicate current entity SHALL be created
