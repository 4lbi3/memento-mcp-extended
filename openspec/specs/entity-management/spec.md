# Entity Management Specification

## Overview

This specification defines how entities are created, updated, and managed within the knowledge graph system. Entities represent typed nodes with observations and optional embeddings.

## Requirements

### Requirement: Entity Creation

The system SHALL provide the ability to create new entities in the knowledge graph with specified name, type, and observations.

#### Scenario: Create single entity

- **GIVEN** valid entity data with name, entityType, and observations
- **WHEN** the entity creation operation is invoked
- **THEN** a new entity SHALL be persisted to the storage provider
- **AND** the entity SHALL be assigned a unique identifier
- **AND** the entity SHALL be returned to the caller

#### Scenario: Create multiple entities in batch

- **GIVEN** an array of valid entity data
- **WHEN** the batch entity creation operation is invoked
- **THEN** all entities SHALL be persisted atomically
- **AND** if any entity fails validation, the entire batch SHALL be rolled back
- **AND** all successfully created entities SHALL be returned

### Requirement: Entity Uniqueness

The system SHALL ensure that entity names are unique within the current version of the knowledge graph, preventing duplicate entities from being created.

#### Scenario: Attempt to create duplicate entity

- **GIVEN** an entity with name "Alice" already exists
- **WHEN** an attempt is made to create another entity with name "Alice"
- **THEN** no new entity SHALL be created
- **AND** the operation SHALL complete successfully (idempotent)

### Requirement: Entity Retrieval

The system SHALL provide the ability to retrieve entities by name or query pattern.

#### Scenario: Retrieve entity by exact name

- **GIVEN** an entity with name "Alice" exists
- **WHEN** a retrieval operation is invoked with name "Alice"
- **THEN** the entity data SHALL be returned
- **AND** the entity SHALL include all observations and metadata

#### Scenario: Retrieve non-existent entity

- **GIVEN** no entity with name "Bob" exists
- **WHEN** a retrieval operation is invoked with name "Bob"
- **THEN** a null or empty result SHALL be returned
- **AND** no error SHALL be thrown

### Requirement: Database-Level Entity Deduplication

The storage provider SHALL perform entity deduplication at the database level using atomic operations, eliminating the need for the application layer to load existing entities into memory.

#### Scenario: Create duplicate entity with new observations

- **GIVEN** an entity with name "Alice" and observations ["fact1", "fact2"] exists in the database
- **WHEN** `createEntities([{name: "Alice", entityType: "person", observations: ["fact2", "fact3"]}])` is called
- **THEN** the storage provider SHALL query for the existing entity using an indexed lookup
- **AND** the storage provider SHALL identify "fact3" as a new observation (fact2 already exists)
- **AND** the storage provider SHALL create a new temporal version with merged observations ["fact1", "fact2", "fact3"]
- **AND** the old version SHALL be marked as invalid (validTo set to current timestamp)
- **AND** the operation SHALL complete without loading the entire graph into memory

#### Scenario: Create duplicate entity with no new observations

- **GIVEN** an entity with name "Bob" and observations ["fact1", "fact2"] exists
- **WHEN** `createEntities([{name: "Bob", entityType: "person", observations: ["fact1"]}])` is called
- **THEN** the storage provider SHALL query for the existing entity
- **AND** the storage provider SHALL detect that no new observations are present
- **AND** no new temporal version SHALL be created (idempotent operation)
- **AND** the operation SHALL return successfully

#### Scenario: Create new entity

- **GIVEN** no entity with name "Charlie" exists in the database
- **WHEN** `createEntities([{name: "Charlie", entityType: "person", observations: ["fact1"]}])` is called
- **THEN** the storage provider SHALL query for the entity and find it doesn't exist
- **AND** a new entity node SHALL be created with the provided attributes
- **AND** the entity SHALL be assigned version 1 and appropriate timestamps
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

### Requirement: Neo4j Entity Creation with Intelligent Upsert

The Neo4j storage provider SHALL implement an intelligent upsert pattern that checks for existing entities, creates new ones when they don't exist, and merges observations into existing entities through temporal versioning.

#### Scenario: Upsert query pattern for each entity

- **GIVEN** the Neo4j storage provider is active
- **WHEN** `createEntities([entity])` is called
- **THEN** the provider SHALL execute a query to check if entity exists: `MATCH (e:Entity {name: $name, validTo: NULL}) RETURN e`
- **AND** if the entity doesn't exist, execute CREATE query with all properties
- **AND** if the entity exists, compare observations and merge via `_createNewEntityVersion` if new observations found
- **AND** all operations SHALL occur within a single transaction

#### Scenario: Batch entity creation with upsert

- **GIVEN** multiple entities are provided for creation
- **WHEN** `createEntities([entity1, entity2, entity3])` is called
- **THEN** each entity SHALL be processed with the upsert pattern (check existence, then create or merge)
- **AND** all operations SHALL occur within a single transaction
- **AND** if any operation fails, all SHALL be rolled back
- **AND** the transaction SHALL commit only after all entities are processed

#### Scenario: Temporal versioning preservation with archived versions

- **GIVEN** an entity "Alice" with version 1 and `validTo = 1234567890` exists (archived)
- **AND** an entity "Alice" with version 2 and `validTo IS NULL` exists (current)
- **WHEN** `createEntities([{name: "Alice", observations: ["new fact"]}])` is called
- **THEN** the existence check SHALL match only the current version (`validTo IS NULL`)
- **AND** archived versions SHALL remain unchanged
- **AND** a new version 3 SHALL be created with merged observations
- **AND** version 2 SHALL be marked as invalid (validTo set to current timestamp)
