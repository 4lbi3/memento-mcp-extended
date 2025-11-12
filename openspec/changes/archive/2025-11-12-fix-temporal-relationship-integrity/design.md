# Design: Temporal Relationship Integrity

## Architecture Overview

The Neo4j storage provider implements a **bitemporal versioning system** where:
- Entities have `validFrom` and `validTo` timestamps to track their temporal validity
- Current entities have `validTo = null`
- Archived entities have `validTo = timestamp`
- Relationships also have temporal validity to maintain graph consistency

### Current Implementation Issues

#### Problem 1: Relationship Orphaning in `deleteObservations`

**Current Flow:**
```
1. MATCH entity WHERE validTo IS NULL
2. SET entity.validTo = now
3. CREATE new entity version
❌ Relationships still point to old entity!
```

**Corrected Flow:**
```
1. MATCH entity WHERE validTo IS NULL
2. MATCH all incoming/outgoing relationships
3. SET entity.validTo = now
4. SET all relationship.validTo = now
5. CREATE new entity version
6. RECREATE all relationships to new version
```

#### Problem 2: Non-Temporal Relationship Creation

**Current Flow:**
```cypher
MATCH (from:Entity {name: $fromName})
MATCH (to:Entity {name: $toName})
CREATE relationship
```
This can match ANY version of the entities!

**Corrected Flow:**
```cypher
MATCH (from:Entity {name: $fromName})
WHERE from.validTo IS NULL
MATCH (to:Entity {name: $toName})
WHERE to.validTo IS NULL
CREATE relationship
```

## Implementation Strategy

### Phase 0: Refactor - Extract Common Versioning Logic (DRY)

**Problem:** Both `addObservations` and `deleteObservations` need identical complex versioning logic (~100 lines):
1. Retrieve entity and all relationships (incoming + outgoing)
2. Invalidate old entity and relationships
3. Create new entity version
4. Recreate all relationships

**Current State:** This logic only exists in `addObservations`, leading to:
- Code duplication if copied to `deleteObservations`
- Maintenance burden (fix bugs in two places)
- Risk of logic divergence over time

**Solution:** Extract into shared private method `_createNewEntityVersion()`

**New Method Signature:**
```typescript
/**
 * Creates a new version of an entity with updated properties while maintaining
 * relationship integrity. This is the central versioning logic used by both
 * addObservations and deleteObservations.
 *
 * @param txc Active Neo4j transaction
 * @param entityName Name of the entity to version
 * @param newObservations New observations array for the entity
 * @returns Object with entityName and success indicators
 */
private async _createNewEntityVersion(
  txc: Transaction,
  entityName: string,
  newObservations: string[]
): Promise<{ entityName: string; success: boolean }> {
  const now = Date.now();

  // Step 1: Get current entity and ALL relationships
  const getQuery = `
    MATCH (e:Entity {name: $name})
    WHERE e.validTo IS NULL
    OPTIONAL MATCH (e)-[r:RELATES_TO]->(to:Entity)
    WHERE r.validTo IS NULL
    OPTIONAL MATCH (from:Entity)-[r2:RELATES_TO]->(e)
    WHERE r2.validTo IS NULL
    RETURN e,
           collect(DISTINCT {rel: r, to: to}) as outgoing,
           collect(DISTINCT {rel: r2, from: from}) as incoming
  `;

  const result = await txc.run(getQuery, { name: entityName });
  if (result.records.length === 0) return { entityName, success: false };

  const currentNode = result.records[0].get('e').properties;
  const outgoingRels = result.records[0].get('outgoing');
  const incomingRels = result.records[0].get('incoming');

  // Step 2: Invalidate old entity and ALL relationships
  const invalidateQuery = `
    MATCH (e:Entity {id: $id})
    SET e.validTo = $now
    WITH e
    OPTIONAL MATCH (e)-[r:RELATES_TO]->()
    WHERE r.validTo IS NULL
    SET r.validTo = $now
    WITH e
    OPTIONAL MATCH ()-[r2:RELATES_TO]->(e)
    WHERE r2.validTo IS NULL
    SET r2.validTo = $now
  `;

  await txc.run(invalidateQuery, { id: currentNode.id, now });

  // Step 3: Create new entity version
  const newEntityId = uuidv4();
  const newVersion = (currentNode.version || 0) + 1;

  const createQuery = `
    CREATE (e:Entity {
      id: $id,
      name: $name,
      entityType: $entityType,
      observations: $observations,
      version: $version,
      createdAt: $createdAt,
      updatedAt: $now,
      validFrom: $now,
      validTo: null,
      changedBy: $changedBy
    })
    RETURN e
  `;

  await txc.run(createQuery, {
    id: newEntityId,
    name: currentNode.name,
    entityType: currentNode.entityType,
    observations: JSON.stringify(newObservations),
    version: newVersion,
    createdAt: currentNode.createdAt,
    now,
    changedBy: null,
  });

  // Step 4: Recreate ALL relationships for new version
  // (outgoing and incoming - see full implementation below)

  return { entityName, success: true };
}
```

**Benefits:**
- ✅ Single source of truth for versioning logic
- ✅ Eliminates ~100 lines of duplicated code
- ✅ Impossible for `addObservations` and `deleteObservations` to diverge
- ✅ Future bug fixes only need to be applied once
- ✅ Easier to test (test one method, not two)

**Usage in `addObservations`:**
```typescript
async addObservations(observations: {...}[]): Promise<...> {
  // ... validation ...

  for (const obs of observations) {
    // Calculate new observations
    const entity = await getEntity(obs.entityName);
    const currentObs = JSON.parse(entity.observations);
    const newObs = obs.contents.filter(c => !currentObs.includes(c));
    const allObs = [...currentObs, ...newObs];

    // Delegate versioning to shared method
    await this._createNewEntityVersion(txc, obs.entityName, allObs);
  }
}
```

**Usage in `deleteObservations`:**
```typescript
async deleteObservations(deletions: {...}[]): Promise<void> {
  // ... validation ...

  for (const deletion of deletions) {
    // Calculate new observations
    const entity = await getEntity(deletion.entityName);
    const currentObs = JSON.parse(entity.observations);
    const newObs = currentObs.filter(o => !deletion.observations.includes(o));

    // Delegate versioning to shared method
    await this._createNewEntityVersion(txc, deletion.entityName, newObs);
  }
}
```

### Phase 1: Implement Refactored Versioning Methods

**Current Code Structure (lines 1121-1230):**
```typescript
// Get entity only
const getQuery = `MATCH (e:Entity {name: $name}) WHERE e.validTo IS NULL RETURN e`;

// Invalidate entity only
const invalidateQuery = `MATCH (e:Entity {id: $id}) SET e.validTo = $now`;

// Create new entity (no relationship handling)
```

**New Code Structure:**
```typescript
// Get entity AND relationships (like addObservations does)
const getQuery = `
  MATCH (e:Entity {name: $name})
  WHERE e.validTo IS NULL
  OPTIONAL MATCH (e)-[r:RELATES_TO]->(to:Entity)
  WHERE r.validTo IS NULL
  OPTIONAL MATCH (from:Entity)-[r2:RELATES_TO]->(e)
  WHERE r2.validTo IS NULL
  RETURN e, collect(DISTINCT {rel: r, to: to}) as outgoing,
            collect(DISTINCT {rel: r2, from: from}) as incoming
`;

// Invalidate entity AND relationships (like addObservations does)
const invalidateQuery = `
  MATCH (e:Entity {id: $id})
  SET e.validTo = $now
  WITH e
  OPTIONAL MATCH (e)-[r:RELATES_TO]->()
  WHERE r.validTo IS NULL
  SET r.validTo = $now
  WITH e
  OPTIONAL MATCH ()-[r2:RELATES_TO]->(e)
  WHERE r2.validTo IS NULL
  SET r2.validTo = $now
`;

// Recreate relationships (like addObservations does)
for (const outRel of outgoingRels) {
  // Create outgoing relationships to new version
}
for (const inRel of incomingRels) {
  // Create incoming relationships to new version
}
```

### Phase 2: Add Temporal Validation to Relationship Creation

**Files to Modify:**

1. **`createRelations()` (line 756-760)**
```typescript
// OLD
const checkQuery = `
  MATCH (from:Entity {name: $fromName})
  MATCH (to:Entity {name: $toName})
  RETURN from, to
`;

// NEW
const checkQuery = `
  MATCH (from:Entity {name: $fromName})
  WHERE from.validTo IS NULL
  MATCH (to:Entity {name: $toName})
  WHERE to.validTo IS NULL
  RETURN from, to
`;
```

2. **`createRelations()` (line 794-810)**
```typescript
// OLD
const createQuery = `
  MATCH (from:Entity {name: $fromName})
  MATCH (to:Entity {name: $toName})
  CREATE (from)-[r:RELATES_TO {...}]->(to)
`;

// NEW
const createQuery = `
  MATCH (from:Entity {name: $fromName})
  WHERE from.validTo IS NULL
  MATCH (to:Entity {name: $toName})
  WHERE to.validTo IS NULL
  CREATE (from)-[r:RELATES_TO {...}]->(to)
`;
```

3. **`addObservations()` relationship recreation (lines 976-992, 1015-1031)**
```typescript
// OLD - uses stale entity IDs
const createOutRelQuery = `
  MATCH (from:Entity {id: $fromId})
  MATCH (to:Entity {id: $toId})
  CREATE (from)-[r:RELATES_TO {...}]->(to)
`;

// NEW - resolve current entity by name first
const createOutRelQuery = `
  MATCH (from:Entity {id: $fromId})
  WHERE from.validTo IS NULL
  MATCH (to:Entity {name: $toName})
  WHERE to.validTo IS NULL
  CREATE (from)-[r:RELATES_TO {...}]->(to)
`;
```

4. **`saveGraph()` (line 415-416)**
```typescript
// OLD
await txc.run(`
  MATCH (from:Entity {name: $fromName})
  MATCH (to:Entity {name: $toName})
  CREATE (from)-[r:RELATES_TO {...}]->(to)
`, params);

// NEW
await txc.run(`
  MATCH (from:Entity {name: $fromName})
  WHERE from.validTo IS NULL
  MATCH (to:Entity {name: $toName})
  WHERE to.validTo IS NULL
  CREATE (from)-[r:RELATES_TO {...}]->(to)
`, params);
```

5. **`updateRelation()` (lines 1409-1424)**
```typescript
// OLD
const createQuery = `
  MATCH (from:Entity {name: $fromName})
  MATCH (to:Entity {name: $toName})
  CREATE (from)-[r:RELATES_TO {...}]->(to)
`;

// NEW
const createQuery = `
  MATCH (from:Entity {name: $fromName})
  WHERE from.validTo IS NULL
  MATCH (to:Entity {name: $toName})
  WHERE to.validTo IS NULL
  CREATE (from)-[r:RELATES_TO {...}]->(to)
`;
```

### Phase 3: Comprehensive Testing

**Test Coverage Required:**

1. **Temporal Integrity Tests:**
   - Entity versioning preserves all relationships
   - Multiple consecutive updates maintain integrity
   - Bidirectional relationship recreation works correctly

2. **Relationship Validation Tests:**
   - Cannot create relationships to archived entities
   - Relationship creation after entity update uses current version
   - Point-in-time queries return consistent graph

3. **Edge Case Tests:**
   - Entity with no relationships (should not error)
   - Entity with only incoming relationships
   - Entity with only outgoing relationships
   - Circular relationship preservation through versioning

## Trade-offs and Considerations

### Performance Impact
- **Additional WHERE clauses**: Minimal overhead, likely optimized by Neo4j query planner
- **Relationship retrieval in deleteObservations**: Same overhead as addObservations (already accepted)
- **More relationship creation queries**: Necessary for correctness, cannot be optimized away

### Backward Compatibility
- ✅ No API contract changes (method signatures unchanged)
- ✅ Existing valid graphs remain valid
- ✅ Only affects future operations, not historical data
- ⚠️ **May reveal existing phantom relationships** - consider cleanup migration

### Data Migration
Not strictly required, but recommended:
```cypher
// Find and delete phantom relationships pointing to archived entities
MATCH (from:Entity)-[r:RELATES_TO]->(to:Entity)
WHERE r.validTo IS NULL
  AND (from.validTo IS NOT NULL OR to.validTo IS NOT NULL)
DELETE r
```

## Validation Strategy

### Pre-deployment Validation
1. Run full test suite with new temporal integrity tests
2. Test on copy of production database
3. Verify relationship counts before/after fix
4. Run cleanup migration to remove existing phantom relationships

### Post-deployment Monitoring
```cypher
// Monitor for phantom relationships (should be 0)
MATCH (from:Entity)-[r:RELATES_TO]->(to:Entity)
WHERE r.validTo IS NULL
  AND (from.validTo IS NOT NULL OR to.validTo IS NOT NULL)
RETURN count(r) as phantom_relationships

// Verify relationship growth is linear with entity count
MATCH (e:Entity) WHERE e.validTo IS NULL
WITH count(e) as current_entities
MATCH ()-[r:RELATES_TO]->() WHERE r.validTo IS NULL
RETURN current_entities, count(r) as current_relationships,
       count(r) / current_entities as avg_relationships_per_entity
```

## Risk Mitigation

### High-Risk Areas
1. **Relationship Recreation Logic**: Critical for data integrity
   - **Mitigation**: Extensive test coverage, transaction rollback on error

2. **Query Performance**: Additional WHERE clauses could slow queries
   - **Mitigation**: Verify indexes on `validTo` exist, benchmark before/after

3. **Concurrent Updates**: Multiple updates to same entity
   - **Mitigation**: Existing transaction isolation should handle, add test

### Rollback Plan
If issues discovered post-deployment:
1. Revert to previous code version
2. Phantom relationships created during buggy period can be cleaned with migration query
3. No data loss (only creation of invalid relationships)
