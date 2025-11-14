# Embedding Jobs Capability Delta

## ADDED Requirements

### Requirement: Batch Embedding Repair Discovery
The storage provider MUST provide an efficient method to discover entities that lack embeddings, enabling operational maintenance and recovery from past failures.

#### Scenario: Query entities without embeddings
- **GIVEN** the knowledge graph contains entities with and without embeddings
- **WHEN** the storage provider's `getEntitiesWithoutEmbeddings(limit)` method is called
- **THEN** it returns only valid entities where `embedding IS NULL AND validTo IS NULL`
- **AND** the result set is limited to the specified `limit` parameter (default: 10)
- **AND** the query executes efficiently using Neo4j indexes

#### Scenario: Batch size control prevents overload
- **GIVEN** the graph contains 1000 entities without embeddings
- **WHEN** `getEntitiesWithoutEmbeddings(50)` is called
- **THEN** exactly 50 entities are returned
- **AND** the system does not attempt to load the entire graph
- **AND** memory usage remains bounded

#### Scenario: Only valid entities returned
- **GIVEN** the graph contains entities with `validTo` timestamps (soft-deleted)
- **WHEN** `getEntitiesWithoutEmbeddings(100)` is called
- **THEN** soft-deleted entities are excluded from results
- **AND** only entities with `validTo IS NULL` are returned

### Requirement: Force Embedding Tool Dual Mode Operation
The `force_generate_embedding` MCP tool MUST support two distinct operational modes: specific entity forcing and batch repair discovery.

#### Scenario: Mode 1 - Force specific entity embedding
- **GIVEN** an entity named "Alberto Rocco" exists in the graph
- **WHEN** the tool is called with `entity_name: "Alberto Rocco"`
- **THEN** the tool retrieves that specific entity via `getEntity("Alberto Rocco")`
- **AND** queues exactly one embedding job for that entity
- **AND** returns success message identifying the entity

#### Scenario: Mode 2 - Batch repair discovers missing embeddings
- **GIVEN** the tool is called without `entity_name` parameter
- **WHEN** `limit: 20` is provided
- **THEN** the tool calls `getEntitiesWithoutEmbeddings(20)`
- **AND** queues embedding jobs for all returned entities
- **AND** returns count of entities discovered and queued
- **AND** does not attempt to load the entire graph

#### Scenario: Default batch limit prevents accidents
- **GIVEN** the tool is called without `entity_name` and without `limit`
- **WHEN** the tool executes in batch repair mode
- **THEN** it defaults to `limit: 10`
- **AND** processes at most 10 entities
- **AND** prevents accidental system overload

#### Scenario: Mode detection based on parameters
- **GIVEN** the tool handler receives input parameters
- **WHEN** `entity_name` is present (even if `limit` is also present)
- **THEN** Mode 1 (specific force) is used
- **AND** `limit` parameter is ignored
- **WHEN** `entity_name` is absent
- **THEN** Mode 2 (batch repair) is used
- **AND** `limit` parameter controls batch size

#### Scenario: Safe entity discovery replaces unsafe openNodes
- **GIVEN** the tool needs to discover entities for batch repair
- **WHEN** Mode 2 executes
- **THEN** it calls the efficient `getEntitiesWithoutEmbeddings(limit)` method
- **AND** it does NOT call `knowledgeGraphManager.openNodes([])`
- **AND** the query is bounded by the limit parameter
- **AND** memory usage remains proportional to limit, not graph size

## MODIFIED Requirements

None - This change extends existing functionality without modifying current requirements.

## REMOVED Requirements

None - All existing requirements remain valid.
