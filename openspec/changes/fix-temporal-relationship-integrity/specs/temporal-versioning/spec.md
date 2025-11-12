# Temporal Versioning Capability

## Purpose
Ensure entity versioning operations maintain complete relationship integrity across all incoming and outgoing edges in the knowledge graph's temporal model.

## MODIFIED Requirements

### Requirement: Entity Observation Deletion Maintains Relationship Integrity
When observations are deleted from an entity, the versioning system MUST preserve all relationships by invalidating old relationships and recreating them for the new entity version.

#### Scenario: Delete observations recreates bidirectional relationships
- **GIVEN** entity "Alice" with observation "likes coffee" has relationships:
  - Outgoing: Alice -[KNOWS]-> Bob
  - Incoming: Charlie -[KNOWS]-> Alice
- **WHEN** `deleteObservations([{entityName: "Alice", observations: ["likes coffee"]}])` is called
- **THEN** a new version of Alice is created with `version = oldVersion + 1`
- **AND** the old Alice entity has `validTo = timestamp`
- **AND** all old relationships have `validTo = timestamp`:
  - Old Alice(v1) -[KNOWS, validTo=timestamp]-> Bob
  - Charlie -[KNOWS, validTo=timestamp]-> Old Alice(v1)
- **AND** new relationships are created for the new version:
  - New Alice(v2) -[KNOWS, validTo=null]-> Bob
  - Charlie -[KNOWS, validTo=null]-> New Alice(v2)

#### Scenario: Delete observations with no relationships succeeds
- **GIVEN** entity "Isolated" exists with no incoming or outgoing relationships
- **WHEN** `deleteObservations([{entityName: "Isolated", observations: ["some data"]}])` is called
- **THEN** a new version of "Isolated" is created successfully
- **AND** no relationship operations are performed
- **AND** no errors are thrown

#### Scenario: Delete observations preserves relationship metadata
- **GIVEN** entity "Alice" has relationship Alice -[KNOWS {strength: 0.9, confidence: 0.8}]-> Bob
- **WHEN** observations are deleted from Alice
- **THEN** the recreated relationship preserves:
  - `relationType = "KNOWS"`
  - `strength = 0.9`
  - `confidence = 0.8`
  - `metadata` (if present)
  - `version` incremented from old relationship
- **AND** only temporal fields are updated: `validFrom`, `updatedAt`

### Requirement: Entity Observation Addition Maintains Relationship Integrity
When observations are added to an entity, the versioning system MUST preserve all relationships using current entity versions only.

#### Scenario: Add observations uses current target entity versions
- **GIVEN** entities Alice(v1) and Bob(v2-current) exist
- **AND** relationship Alice(v1) -[KNOWS]-> Bob(v1-archived)
- **WHEN** observations are added to Alice creating Alice(v2)
- **THEN** the system resolves Bob's current version by name
- **AND** recreated relationship is Alice(v2) -[KNOWS]-> Bob(v2-current)
- **AND** NOT Alice(v2) -[KNOWS]-> Bob(v1-archived)

#### Scenario: Add observations handles target entity not found
- **GIVEN** entity Alice has relationship to entity Bob
- **AND** Bob is completely deleted (no current version exists)
- **WHEN** observations are added to Alice
- **THEN** the relationship to Bob is NOT recreated
- **AND** a warning is logged about missing target entity
- **AND** the operation succeeds with remaining valid relationships

## ADDED Requirements

### Requirement: Relationship Creation Validates Temporal Entity State
All relationship creation operations MUST verify that both source and target entities are in their current version before creating the relationship.

#### Scenario: Create relations only with current entities
- **GIVEN** entities Alice(v2-current) and Bob(v2-current) exist
- **AND** archived versions Alice(v1) and Bob(v1) exist
- **WHEN** `createRelations([{from: "Alice", to: "Bob", relationType: "KNOWS"}])` is called
- **THEN** the system matches ONLY current versions: Alice(v2) and Bob(v2)
- **AND** creates relationship Alice(v2) -[KNOWS]-> Bob(v2)
- **AND** does NOT create Alice(v1) -[KNOWS]-> Bob(v1)
- **AND** does NOT create any cross-version relationships

#### Scenario: Create relations fails when entity is archived
- **GIVEN** entity Alice(v1) with `validTo = 12345` (archived)
- **AND** no current version of Alice exists
- **WHEN** `createRelations([{from: "Alice", to: "Bob", relationType: "KNOWS"}])` is called
- **THEN** the relation is NOT created
- **AND** a warning is logged "Skipping relation creation: One or both entities not found (Alice -> Bob)"
- **AND** the operation continues without error

#### Scenario: Create relations validates both source and target
- **GIVEN** entity Alice(v2-current) exists
- **AND** entity Bob(v1-archived) exists with no current version
- **WHEN** `createRelations([{from: "Alice", to: "Bob", relationType: "KNOWS"}])` is called
- **THEN** no relationship is created
- **AND** the system logs that Bob is not current
- **AND** Alice remains without relationships to Bob

### Requirement: Update Relation Validates Temporal Entity State
When updating a relation, the new version MUST connect to current entity versions only.

#### Scenario: Update relation recreates with current entities
- **GIVEN** current relationship Alice(v1) -[KNOWS]-> Bob(v1)
- **AND** Alice is updated to v2, Bob is updated to v2
- **WHEN** `updateRelation({from: "Alice", to: "Bob", relationType: "KNOWS", confidence: 0.95})` is called
- **THEN** the system resolves current versions Alice(v2) and Bob(v2)
- **AND** old relationship is marked `validTo = timestamp`
- **AND** new relationship is Alice(v2) -[KNOWS, confidence=0.95]-> Bob(v2)
- **AND** NOT Alice(v1) or Bob(v1)

#### Scenario: Update relation fails when entity not current
- **GIVEN** relationship Alice -[KNOWS]-> Bob
- **AND** Alice's current version is archived (validTo = 12345)
- **WHEN** `updateRelation({from: "Alice", to: "Bob", relationType: "KNOWS", confidence: 0.95})` is called
- **THEN** the operation throws an error "Entity Alice not found in current state"
- **AND** no new relationship version is created

### Requirement: Graph Persistence Validates Temporal Entity State
When persisting a complete knowledge graph, relationship creation MUST validate entity temporal state.

#### Scenario: Save graph creates relationships only with current entities
- **GIVEN** a knowledge graph with entities Alice(v2) and Bob(v2) marked as current
- **AND** relations include Alice -[KNOWS]-> Bob
- **WHEN** `saveGraph(graph)` is called
- **THEN** relationships are created ONLY for current entity versions
- **AND** WHERE clauses verify `validTo IS NULL` for both entities
- **AND** no relationships are created to archived versions

### Requirement: Temporal Query Consistency
Point-in-time queries MUST return a consistent graph state where all relationships connect entities valid at that timestamp.

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

## Implementation Notes

### Neo4j Query Patterns

**Entity Matching with Temporal Validation:**
```cypher
MATCH (e:Entity {name: $name})
WHERE e.validTo IS NULL
RETURN e
```

**Relationship Creation with Temporal Validation:**
```cypher
MATCH (from:Entity {name: $fromName})
WHERE from.validTo IS NULL
MATCH (to:Entity {name: $toName})
WHERE to.validTo IS NULL
CREATE (from)-[r:RELATES_TO {
  id: $id,
  relationType: $relationType,
  // ... other properties
  validTo: null
}]->(to)
```

**Relationship Invalidation and Recreation Pattern:**
```cypher
// Step 1: Invalidate old relationships
MATCH (e:Entity {id: $oldId})
SET e.validTo = $now
WITH e
OPTIONAL MATCH (e)-[r:RELATES_TO]->()
WHERE r.validTo IS NULL
SET r.validTo = $now
WITH e
OPTIONAL MATCH ()-[r2:RELATES_TO]->(e)
WHERE r2.validTo IS NULL
SET r2.validTo = $now

// Step 2: Create new entity version
CREATE (newE:Entity {..., validTo: null})

// Step 3: Recreate relationships to new version
// (repeat for each relationship)
```

### Affected Methods
- `Neo4jStorageProvider._createNewEntityVersion()` - NEW private method (centralized versioning)
- `Neo4jStorageProvider.deleteObservations()` - Refactored to use `_createNewEntityVersion`
- `Neo4jStorageProvider.addObservations()` - Refactored to use `_createNewEntityVersion`
- `Neo4jStorageProvider.createRelations()` - Add WHERE validTo IS NULL
- `Neo4jStorageProvider.saveGraph()` - Add temporal validation
- `Neo4jStorageProvider.updateRelation()` - Add temporal validation

### Test Coverage
Each scenario MUST have corresponding Vitest test in:
- `src/storage/__vitest__/neo4j/Neo4jTemporalIntegrity.test.ts` (new file)
- Updates to existing `Neo4jStorageProvider.test.ts`
