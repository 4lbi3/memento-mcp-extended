# Embedding Jobs Capability - Spec Delta

## ADDED Requirements

### Requirement: Entity Creation Integration

The storage provider MUST NOT generate embeddings synchronously during entity creation transactions. All embedding generation SHALL be delegated to the asynchronous job queue.

#### Scenario: Entity created without blocking on embeddings

- **GIVEN** a storage provider receives a request to create entities
- **WHEN** the `createEntities` method executes
- **THEN** entities are persisted in the database without embeddings
- **AND** the database transaction completes in milliseconds
- **AND** no network calls to embedding providers occur within the transaction
- **AND** the transaction does not hold locks while waiting for API responses

#### Scenario: Embedding jobs scheduled after entity creation

- **GIVEN** entities have been created in the database
- **WHEN** the `KnowledgeGraphManager.createEntities` method completes
- **THEN** embedding jobs are scheduled for each new entity
- **AND** the jobs are queued in the dedicated embedding job database
- **AND** background workers process the jobs asynchronously
- **AND** embeddings are added to entities when workers complete the jobs

#### Scenario: Fast transaction prevents lock contention

- **GIVEN** multiple concurrent requests to create entities
- **WHEN** transactions execute without synchronous embedding generation
- **THEN** each transaction completes in <100ms
- **AND** database locks are held only for fast local operations
- **AND** concurrent operations do not block each other
- **AND** transaction timeout errors do not occur even with 50+ entities

#### Scenario: No duplicate embedding generation

- **GIVEN** an entity is being created
- **WHEN** the storage provider completes the entity creation
- **THEN** exactly one embedding job is scheduled for the entity
- **AND** the embedding is generated exactly once by the job worker
- **AND** no synchronous embedding generation occurs during entity creation

## MODIFIED Requirements

None - this change adds a new requirement without modifying existing ones.

## REMOVED Requirements

None - no existing requirements are removed.
