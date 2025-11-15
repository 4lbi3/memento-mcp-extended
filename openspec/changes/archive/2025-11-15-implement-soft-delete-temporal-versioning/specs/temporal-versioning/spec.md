# Temporal Versioning - Delta Specification

## ADDED Requirements

### Requirement: Entity Deletion Preserves Temporal History

When entities are deleted, the system MUST perform soft deletion by setting `validTo` timestamp rather than physically removing the entity from the database.

#### Scenario: Delete entity soft-deletes with timestamp

- **GIVEN** entity "Alice" exists with `validTo = null` (current version)
- **AND** current timestamp is 1234567890
- **WHEN** `deleteEntities(["Alice"])` is called
- **THEN** entity "Alice" has `validTo = 1234567890`
- **AND** entity "Alice" is NOT physically removed from the database
- **AND** entity "Alice" can still be queried in historical queries

#### Scenario: Delete entity invalidates all relationships

- **GIVEN** entity "Alice" exists with relationships:
  - Outgoing: Alice -[KNOWS, validTo=null]-> Bob
  - Incoming: Charlie -[KNOWS, validTo=null]-> Alice
- **WHEN** `deleteEntities(["Alice"])` is called with timestamp 1234567890
- **THEN** entity "Alice" has `validTo = 1234567890`
- **AND** relationship Alice -[KNOWS]-> Bob has `validTo = 1234567890`
- **AND** relationship Charlie -[KNOWS]-> Alice has `validTo = 1234567890`
- **AND** no current relationships (validTo=null) exist to/from Alice

#### Scenario: Delete entity only affects current versions

- **GIVEN** entity "Alice" has multiple versions:
  - Alice(v1) with `validTo = 1000000000` (archived)
  - Alice(v2) with `validTo = null` (current)
- **WHEN** `deleteEntities(["Alice"])` is called with timestamp 1234567890
- **THEN** only Alice(v2) has `validTo` updated to 1234567890
- **AND** Alice(v1) remains unchanged with `validTo = 1000000000`
- **AND** historical queries can still return both versions at appropriate timestamps

#### Scenario: Delete non-existent entity logs warning

- **GIVEN** no entity named "NonExistent" exists
- **WHEN** `deleteEntities(["NonExistent"])` is called
- **THEN** no error is thrown
- **AND** a warning is logged about entity not found
- **AND** the operation completes successfully

#### Scenario: Deleted entity excluded from current queries

- **GIVEN** entity "Alice" was soft-deleted with `validTo = 1234567890`
- **WHEN** `getEntity("Alice")` is called
- **THEN** null is returned (entity not found in current state)
- **AND** `loadGraph()` does not include "Alice" in the entity list
- **AND** historical query `getGraphAtTime(1234567800)` DOES include "Alice"

### Requirement: Relation Deletion Preserves Temporal History

When relationships are deleted, the system MUST perform soft deletion by setting `validTo` timestamp rather than physically removing the relationship from the database.

#### Scenario: Delete relation soft-deletes with timestamp

- **GIVEN** relationship Alice -[KNOWS, validTo=null]-> Bob exists
- **AND** current timestamp is 1234567890
- **WHEN** `deleteRelations([{from: "Alice", to: "Bob", relationType: "KNOWS"}])` is called
- **THEN** relationship has `validTo = 1234567890`
- **AND** relationship is NOT physically removed from the database
- **AND** relationship can still be queried in historical queries

#### Scenario: Delete relation only affects current versions

- **GIVEN** multiple versions of relationship Alice -[KNOWS]-> Bob exist:
  - Version 1 with `validTo = 1000000000` (archived)
  - Version 2 with `validTo = null` (current)
- **WHEN** `deleteRelations([{from: "Alice", to: "Bob", relationType: "KNOWS"}])` is called
- **THEN** only Version 2 has `validTo` updated to timestamp
- **AND** Version 1 remains unchanged
- **AND** historical queries can still return both versions

#### Scenario: Delete non-existent relation succeeds silently

- **GIVEN** no relationship Alice -[KNOWS]-> Bob exists
- **WHEN** `deleteRelations([{from: "Alice", to: "Bob", relationType: "KNOWS"}])` is called
- **THEN** no error is thrown
- **AND** the operation completes successfully
- **AND** no database changes occur

#### Scenario: Deleted relation excluded from current queries

- **GIVEN** relationship Alice -[KNOWS]-> Bob was soft-deleted with `validTo = 1234567890`
- **WHEN** current graph is queried via `loadGraph()`
- **THEN** the relationship is NOT included in the relations list
- **AND** historical query `getGraphAtTime(1234567800)` DOES include the relationship

### Requirement: Administrative Purge for Archived Data

The system MUST provide administrative methods to permanently remove archived (soft-deleted) entities and relationships to manage database size.

#### Scenario: Purge archived entities removes old versions

- **GIVEN** entity "Alice" has archived version with `validTo = 1000000000`
- **AND** cutoff timestamp is 1500000000
- **WHEN** `purgeArchivedEntities(1500000000)` is called
- **THEN** Alice's archived version is permanently removed (DETACH DELETE)
- **AND** current version of Alice (if exists) is NOT removed
- **AND** purge count is returned in operation result

#### Scenario: Purge respects cutoff timestamp

- **GIVEN** entity "Alice" has archived version with `validTo = 2000000000`
- **AND** cutoff timestamp is 1500000000
- **WHEN** `purgeArchivedEntities(1500000000)` is called
- **THEN** Alice's archived version is NOT removed (validTo > cutoff)
- **AND** entity remains in database for future historical queries

#### Scenario: Purge never removes current versions

- **GIVEN** entity "Alice" with `validTo = null` (current)
- **AND** cutoff timestamp is 9999999999 (far future)
- **WHEN** `purgeArchivedEntities(9999999999)` is called
- **THEN** Alice is NOT removed (validTo IS NULL)
- **AND** current entities are protected from purge operations

#### Scenario: Purge archived relations removes old relationships

- **GIVEN** relationship Alice -[KNOWS]-> Bob with `validTo = 1000000000`
- **AND** cutoff timestamp is 1500000000
- **WHEN** `purgeArchivedRelations(1500000000)` is called
- **THEN** the archived relationship is permanently removed (DELETE)
- **AND** current relationships (validTo=null) are NOT removed
- **AND** purge count is returned

#### Scenario: Purge operations use transactions

- **GIVEN** multiple archived entities exist
- **AND** purge operation encounters an error mid-execution
- **WHEN** `purgeArchivedEntities(cutoff)` is called
- **THEN** all changes are rolled back on error
- **AND** no partial purge occurs
- **AND** database remains in consistent state

#### Scenario: Purge operations log results

- **GIVEN** 42 archived entities match purge criteria
- **WHEN** `purgeArchivedEntities(cutoff)` is called
- **THEN** operation logs "Purged 42 archived entities before timestamp X"
- **AND** individual entity names are logged at debug level
- **AND** errors are logged with full context

## MODIFIED Requirements

### Requirement: Temporal Query Consistency

Point-in-time queries MUST return a consistent graph state where all relationships connect entities valid at that timestamp. **Soft-deleted entities and relationships MUST be excluded from current-state queries but included in historical queries when valid at the requested timestamp.**

#### Scenario: Get graph at time returns consistent relationships

- **GIVEN** at timestamp T1: Alice(v1) -[KNOWS]-> Bob(v1)
- **AND** at timestamp T2: Alice(v2) -[KNOWS]-> Bob(v2) (both updated)
- **AND** at timestamp T3: Alice(v3) -[KNOWS]-> Bob(v2) (only Alice updated)
- **WHEN** `getGraphAtTime(T2)` is called
- **THEN** returned graph contains:
  - Alice(v2) with validFrom <= T2, validTo > T2
  - Bob(v2) with validFrom <= T2, validTo > T2
  - Relationship from Alice(v2) to Bob(v2)
- **AND** does NOT contain Alice(v1), Bob(v1), or mismatched versions

#### Scenario: Current graph contains no phantom relationships

- **GIVEN** multiple entity updates have occurred
- **WHEN** `loadGraph()` is called to get current state
- **THEN** all returned relationships have `validTo IS NULL`
- **AND** all relationship endpoints have `validTo IS NULL`
- **AND** count of relationships ≈ legitimate current relationships
- **AND** NO relationships point to entities where `validTo IS NOT NULL`

#### Scenario: Current graph excludes soft-deleted entities

- **GIVEN** entity "Alice" was soft-deleted at timestamp T1
- **AND** current time is T2 (after T1)
- **WHEN** `loadGraph()` is called
- **THEN** "Alice" is NOT included in the returned entities
- **AND** all relationships to/from "Alice" have `validTo <= T1`
- **AND** NO current relationships (validTo=null) connect to "Alice"

#### Scenario: Historical query includes soft-deleted entities when valid

- **GIVEN** entity "Alice" was soft-deleted at timestamp T2
- **AND** Alice existed from T0 to T2
- **WHEN** `getGraphAtTime(T1)` is called where T0 < T1 < T2
- **THEN** "Alice" IS included in the returned graph
- **AND** all relationships valid at T1 are included
- **AND** soft-deletion is invisible to historical query (Alice was valid at T1)

## Implementation Notes

### Soft Delete Query Patterns

**Entity Soft Delete:**
```cypher
MATCH (e:Entity {name: $name})
WHERE e.validTo IS NULL
SET e.validTo = $timestamp
WITH e
OPTIONAL MATCH (e)-[r:RELATES_TO]->()
WHERE r.validTo IS NULL
SET r.validTo = $timestamp
WITH e
OPTIONAL MATCH ()-[r2:RELATES_TO]->(e)
WHERE r2.validTo IS NULL
SET r2.validTo = $timestamp
RETURN count(e) as entitiesDeleted
```

**Relationship Soft Delete:**
```cypher
MATCH (from:Entity {name: $fromName})-[r:RELATES_TO]->(to:Entity {name: $toName})
WHERE r.relationType = $relationType
  AND r.validTo IS NULL
SET r.validTo = $timestamp
RETURN count(r) as relationsDeleted
```

**Purge Archived Entities:**
```cypher
MATCH (e:Entity)
WHERE e.validTo IS NOT NULL
  AND e.validTo < $cutoffTimestamp
DETACH DELETE e
RETURN count(e) as purged
```

**Purge Archived Relations:**
```cypher
MATCH ()-[r:RELATES_TO]->()
WHERE r.validTo IS NOT NULL
  AND r.validTo < $cutoffTimestamp
DELETE r
RETURN count(r) as purged
```

### Affected Methods

- `Neo4jStorageProvider.deleteEntities()` - **MODIFIED**: Use soft delete (SET validTo)
- `Neo4jStorageProvider.deleteRelations()` - **MODIFIED**: Use soft delete (SET validTo)
- `Neo4jStorageProvider.purgeArchivedEntities()` - **NEW**: Permanent removal of old versions
- `Neo4jStorageProvider.purgeArchivedRelations()` - **NEW**: Permanent removal of old relationships
- `Neo4jStorageProvider.loadGraph()` - **VERIFY**: Excludes soft-deleted entities/relations
- `Neo4jStorageProvider.getEntity()` - **VERIFY**: Excludes soft-deleted entities

### Test Coverage

New test file: `src/storage/__vitest__/neo4j/Neo4jSoftDelete.test.ts`

Scenarios to cover:
- Soft delete entities preserves in database
- Soft delete invalidates relationships
- Soft delete only affects current versions
- Deleted entities excluded from current queries
- Deleted entities included in historical queries when valid
- Purge removes archived data
- Purge respects cutoff timestamp
- Purge never removes current versions
- Purge uses transactions with rollback

Augment existing: `src/storage/__vitest__/neo4j/Neo4jTemporalIntegrity.test.ts`
- Add scenarios for soft delete temporal integrity
- Verify no phantom relationships after soft delete
