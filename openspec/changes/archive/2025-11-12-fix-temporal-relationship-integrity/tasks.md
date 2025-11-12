# Tasks: Fix Temporal Relationship Integrity

## Phase 0: Refactor - Extract Common Versioning Logic (DRY)

### Task 0.1: Create `_createNewEntityVersion` private method
**File:** `src/storage/neo4j/Neo4jStorageProvider.ts` (new private method)

Extract the complete versioning logic from `addObservations` into a new private method:

```typescript
/**
 * Creates a new version of an entity with updated properties while maintaining
 * relationship integrity. This is the central versioning logic used by both
 * addObservations and deleteObservations.
 *
 * @param txc Active Neo4j transaction
 * @param entityName Name of the entity to version
 * @param newObservations New observations array for the entity
 * @returns Object with entityName and success/failure indicators
 */
private async _createNewEntityVersion(
  txc: Transaction,
  entityName: string,
  newObservations: string[]
): Promise<{ entityName: string; success: boolean }> {
  const now = Date.now();

  // Step 1: Get current entity and ALL relationships (incoming + outgoing)
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
  if (result.records.length === 0) {
    logger.warn(`Entity not found: ${entityName}`);
    return { entityName, success: false };
  }

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

  // Step 4: Recreate outgoing relationships
  for (const outRel of outgoingRels) {
    if (!outRel.rel || !outRel.to) continue;

    const relProps = outRel.rel.properties;
    const newRelId = uuidv4();

    const createOutRelQuery = `
      MATCH (from:Entity {id: $fromId})
      WHERE from.validTo IS NULL
      MATCH (to:Entity {name: $toName})
      WHERE to.validTo IS NULL
      CREATE (from)-[r:RELATES_TO {
        id: $id,
        relationType: $relationType,
        strength: $strength,
        confidence: $confidence,
        metadata: $metadata,
        version: $version,
        createdAt: $createdAt,
        updatedAt: $now,
        validFrom: $now,
        validTo: null,
        changedBy: $changedBy
      }]->(to)
    `;

    await txc.run(createOutRelQuery, {
      fromId: newEntityId,
      toName: outRel.to.properties.name,  // Use name, not stale ID
      id: newRelId,
      relationType: relProps.relationType,
      strength: relProps.strength !== undefined ? relProps.strength : 0.9,
      confidence: relProps.confidence !== undefined ? relProps.confidence : 0.95,
      metadata: relProps.metadata || null,
      version: relProps.version || 1,
      createdAt: relProps.createdAt || Date.now(),
      now,
      changedBy: null,
    });
  }

  // Step 5: Recreate incoming relationships
  for (const inRel of incomingRels) {
    if (!inRel.rel || !inRel.from) continue;

    const relProps = inRel.rel.properties;
    const newRelId = uuidv4();

    const createInRelQuery = `
      MATCH (from:Entity {name: $fromName})
      WHERE from.validTo IS NULL
      MATCH (to:Entity {id: $toId})
      WHERE to.validTo IS NULL
      CREATE (from)-[r:RELATES_TO {
        id: $id,
        relationType: $relationType,
        strength: $strength,
        confidence: $confidence,
        metadata: $metadata,
        version: $version,
        createdAt: $createdAt,
        updatedAt: $now,
        validFrom: $now,
        validTo: null,
        changedBy: $changedBy
      }]->(to)
    `;

    await txc.run(createInRelQuery, {
      fromName: inRel.from.properties.name,  // Use name, not stale ID
      toId: newEntityId,
      id: newRelId,
      relationType: relProps.relationType,
      strength: relProps.strength !== undefined ? relProps.strength : 0.9,
      confidence: relProps.confidence !== undefined ? relProps.confidence : 0.95,
      metadata: relProps.metadata || null,
      version: relProps.version || 1,
      createdAt: relProps.createdAt || Date.now(),
      now,
      changedBy: null,
    });
  }

  return { entityName, success: true };
}
```

**Validation:**
- Method compiles without errors
- Covers all 5 steps of versioning logic
- Uses entity names (not IDs) for relationship targets

---

### Task 0.2: Refactor `addObservations` to use `_createNewEntityVersion`
**File:** `src/storage/neo4j/Neo4jStorageProvider.ts:852-1072`

Replace the complex inline versioning logic with a call to the new shared method:

```typescript
async addObservations(
  observations: { entityName: string; contents: string[] }[]
): Promise<{ entityName: string; addedObservations: string[] }[]> {
  // ... validation ...

  const session = await this.connectionManager.getSession();
  const results: { entityName: string; addedObservations: string[] }[] = [];

  try {
    const txc = session.beginTransaction();

    try {
      for (const obs of observations) {
        if (!obs.entityName || !obs.contents || obs.contents.length === 0) {
          continue;
        }

        // Get current entity to calculate new observations
        const getQuery = `
          MATCH (e:Entity {name: $name})
          WHERE e.validTo IS NULL
          RETURN e
        `;

        const getResult = await txc.run(getQuery, { name: obs.entityName });

        if (getResult.records.length === 0) {
          logger.warn(`Entity not found: ${obs.entityName}`);
          continue;
        }

        const currentNode = getResult.records[0].get('e').properties;
        const currentObservations = JSON.parse(currentNode.observations || '[]');

        // Filter out duplicates
        const newObservations = obs.contents.filter(
          (content) => !currentObservations.includes(content)
        );

        // Skip if no new observations
        if (newObservations.length === 0) {
          results.push({
            entityName: obs.entityName,
            addedObservations: [],
          });
          continue;
        }

        // Combine observations
        const allObservations = [...currentObservations, ...newObservations];

        // Delegate to shared versioning method
        const versionResult = await this._createNewEntityVersion(
          txc,
          obs.entityName,
          allObservations
        );

        if (versionResult.success) {
          results.push({
            entityName: obs.entityName,
            addedObservations: newObservations,
          });
        }
      }

      await txc.commit();
      return results;
    } catch (error) {
      await txc.rollback();
      throw error;
    }
  } finally {
    await session.close();
  }
}
```

**Validation:**
- Code compiles and passes existing tests
- Method is now ~30 lines instead of ~200
- All relationship handling delegated to `_createNewEntityVersion`

---

### Task 0.3: Refactor `deleteObservations` to use `_createNewEntityVersion`
**File:** `src/storage/neo4j/Neo4jStorageProvider.ts:1121-1230`

Replace the incomplete implementation with a call to the shared method:

```typescript
async deleteObservations(
  deletions: { entityName: string; observations: string[] }[]
): Promise<void> {
  // ... validation ...

  const session = await this.connectionManager.getSession();

  try {
    const txc = session.beginTransaction();

    try {
      for (const deletion of deletions) {
        if (
          !deletion.entityName ||
          !deletion.observations ||
          deletion.observations.length === 0
        ) {
          continue;
        }

        // Get current entity to calculate new observations
        const getQuery = `
          MATCH (e:Entity {name: $name})
          WHERE e.validTo IS NULL
          RETURN e
        `;

        const getResult = await txc.run(getQuery, { name: deletion.entityName });

        if (getResult.records.length === 0) {
          logger.warn(`Entity not found: ${deletion.entityName}`);
          continue;
        }

        const currentNode = getResult.records[0].get('e').properties;
        const currentObservations = JSON.parse(currentNode.observations || '[]');

        // Remove the observations
        const updatedObservations = currentObservations.filter(
          (obs: string) => !deletion.observations.includes(obs)
        );

        // Delegate to shared versioning method
        await this._createNewEntityVersion(
          txc,
          deletion.entityName,
          updatedObservations
        );
      }

      await txc.commit();
    } catch (error) {
      await txc.rollback();
      throw error;
    }
  } finally {
    await session.close();
  }
}
```

**Validation:**
- Code compiles and method is now ~30 lines instead of ~110
- All relationship handling automatically inherited from `_createNewEntityVersion`
- Test that relationships are preserved through deleteObservations

---

## Phase 1: Add Temporal Validation to Relationship Creation

### Task 1.1: Fix `createRelations` check and creation queries
**File:** `src/storage/neo4j/Neo4jStorageProvider.ts:756-760, 794-810`

Add temporal validation to both entity check and relationship creation:

**Step 1: Fix entity check query (lines 756-760):**
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

**Step 2: Fix creation query (lines 794-810):**
```typescript
// OLD
const createQuery = `
  MATCH (from:Entity {name: $fromName})
  MATCH (to:Entity {name: $toName})
  CREATE (from)-[r:RELATES_TO {...}]->(to)
  RETURN r, from, to
`;

// NEW
const createQuery = `
  MATCH (from:Entity {name: $fromName})
  WHERE from.validTo IS NULL
  MATCH (to:Entity {name: $toName})
  WHERE to.validTo IS NULL
  CREATE (from)-[r:RELATES_TO {...}]->(to)
  RETURN r, from, to
`;
```

**Validation:**
- Test creates relationships only with current entities
- Test with archived entities returns no results
- createRelations skips archived entities gracefully

---

### Task 1.2: Fix `saveGraph` relationship creation
**File:** `src/storage/neo4j/Neo4jStorageProvider.ts:415-432`

Add temporal validation:

```typescript
// OLD (line 415-432)
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

**Validation:** saveGraph only creates relationships with current entities

---

### Task 1.3: Fix `updateRelation` recreation query
**File:** `src/storage/neo4j/Neo4jStorageProvider.ts:1409-1424`

Add temporal validation:

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

**Validation:** updateRelation creates new version with current entities only

---

---

## Phase 2: Test Coverage

### Task 2.1: Create temporal integrity test file
**File:** `src/storage/__vitest__/neo4j/Neo4jTemporalIntegrity.test.ts` (NEW)

Create comprehensive test suite covering:
- deleteObservations preserves relationships
- addObservations uses current entity versions
- createRelations validates temporal state
- No phantom relationships created
- Point-in-time queries are consistent

**Template structure:**
```typescript
describe('Neo4j Temporal Integrity', () => {
  describe('deleteObservations relationship preservation', () => {
    it('should preserve outgoing relationships');
    it('should preserve incoming relationships');
    it('should handle entities with no relationships');
    it('should preserve relationship metadata');
  });

  describe('addObservations current entity resolution', () => {
    it('should use current target entity versions');
    it('should handle missing target entities gracefully');
  });

  describe('createRelations temporal validation', () => {
    it('should only create relationships with current entities');
    it('should skip archived entities');
    it('should validate both source and target');
  });

  describe('phantom relationship prevention', () => {
    it('should not create cross-version relationships');
    it('should maintain linear relationship growth');
  });

  describe('temporal query consistency', () => {
    it('should return consistent graph at specific time');
    it('should not return phantom relationships in current graph');
  });
});
```

**Validation:** All tests pass with green checkmarks

---

### Task 2.2: Update existing Neo4j storage provider tests
**File:** `src/storage/__vitest__/neo4j/Neo4jStorageProvider.test.ts`

Add temporal validation assertions to existing tests:
- Update `deleteObservations` tests to verify relationships preserved
- Update `createRelations` tests to verify temporal validation
- Add relationship count assertions

**Validation:** Existing tests pass + new assertions verify temporal correctness

---

---

## Phase 3: Validation and Deployment

### Task 3.1: Run validation
```bash
npx openspec validate fix-temporal-relationship-integrity --strict
```

**Expected:** All validations pass

---

### Task 3.2: Run full test suite
```bash
npm test
```

**Expected:** All tests pass including new temporal integrity tests

---

### Task 3.3: Verify temporal integrity in production
1. Run tests against production database
2. Verify relationship counts are reasonable (current ≈ total after fix)
3. Monitor for any new phantom relationships

**Expected:**
- No phantom relationships created after fix
- Relationship count growth is linear with entity count
- All temporal queries return consistent state

---

### Task 3.4: Document the fix
**File:** `CHANGELOG.md`

Add entry:
```markdown
## [Version] - Date

### Fixed
- **Critical:** Fixed temporal relationship integrity issues in Neo4j storage provider
  - `deleteObservations` now preserves all relationships through entity versioning
  - All relationship creation operations validate entity temporal state (`validTo IS NULL`)
  - Prevents creation of phantom relationships to archived entity versions
  - Fixes relationship graph corruption that caused exponential relationship proliferation
```

**Validation:** Changelog clearly documents the fix and impact

---

## Dependencies

- **Phase 0 (Tasks 0.1-0.3)** must be done sequentially - refactoring is the foundation
- **Phase 1 (Tasks 1.1-1.3)** can be done in parallel after Phase 0 completes
- **Phase 2 (Tasks 2.1-2.2)** depends on Phase 0 and 1 completion
- **Phase 3 (Tasks 3.1-3.4)** depends on all previous phases

## Success Criteria

✅ Refactored code eliminates ~100 lines of duplication
✅ All entity versioning operations preserve relationships
✅ No phantom relationships created (verified by test and production monitoring)
✅ Temporal queries return consistent state
✅ Test coverage ≥ 90% for temporal integrity code paths
✅ `addObservations` and `deleteObservations` share single source of truth
