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
