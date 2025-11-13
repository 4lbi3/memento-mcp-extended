# Design Document: Entity Deduplication Refactoring

## Context

The current architecture violates the separation of concerns between the manager layer (`KnowledgeGraphManager`) and the storage layer (`Neo4jStorageProvider`). The manager performs database-level operations (deduplication) that should be delegated to the storage provider.

**Current Flow:**
```
createEntities()
  → loadGraph() [loads ALL entities]
  → build Map<name, entity> in memory
  → check duplicates in memory
  → storageProvider.createEntities(filtered)
```

**Problem:** This causes O(n) memory usage where n = total entities in graph, making the operation infeasible for large graphs.

**Stakeholders:**
- Users with large knowledge graphs (>10,000 entities)
- Performance-sensitive applications
- Memory-constrained environments

## Goals / Non-Goals

**Goals:**
- Eliminate full graph loading for entity creation
- Achieve O(1) memory usage for entity creation operations
- Maintain transactional guarantees for entity creation
- Preserve temporal versioning semantics (`validTo IS NULL` for current entities)
- Keep backward compatibility (same API, same observable behavior)

**Non-Goals:**
- Changing the temporal versioning model
- Modifying the Entity or Relation data structures
- Optimizing other operations (search, update, etc.)
- Adding new deduplication strategies (e.g., fuzzy matching)

## Decisions

### Decision 1: Use Intelligent Upsert with Observation Merging

**What:** Replace application-level deduplication with database-level "upsert" that handles both entity creation and observation merging through temporal versioning.

**Why:**
- Neo4j can efficiently check for duplicate entities using indexed queries
- Prevents **silent data loss** when new observations are provided for existing entities
- Maintains the original behavior of merging observations (preserves backward compatibility)
- Eliminates need to load existing entities into application memory
- Uses existing `_createNewEntityVersion` logic for consistency with `addObservations`

**Critical Problem with Simple MERGE:**
Using `MERGE ... ON CREATE SET` alone would cause **silent data loss**:
- If entity exists: new observations are ignored without error
- Neither user nor agent would be notified
- This violates data integrity guarantees

**Alternatives Considered:**
1. **Simple MERGE with ON CREATE only:** ❌ Causes silent data loss (rejected)
2. **MERGE with ON MATCH SET for observations:** ❌ Can't merge arrays in Cypher without losing temporal versioning
3. **Keep in-memory deduplication:** ❌ Doesn't solve the O(n) memory problem
4. **Intelligent upsert per entity:** ✅ Chosen - preserves data and maintains temporal versioning

**Implementation Pattern:**
```typescript
// For each entity in the batch:
// 1. Query for existing entity (indexed lookup - fast)
const existing = await txc.run(
  'MATCH (e:Entity {name: $name, validTo: NULL}) RETURN e',
  { name: entity.name }
);

if (existing.records.length === 0) {
  // 2a. Entity doesn't exist - create it
  await txc.run('CREATE (e:Entity {...}) RETURN e', params);
} else {
  // 2b. Entity exists - merge observations via temporal versioning
  const currentObs = JSON.parse(existing.get('e').properties.observations);
  const newObs = entity.observations.filter(obs => !currentObs.includes(obs));

  if (newObs.length > 0) {
    // Create new version with merged observations
    await this._createNewEntityVersion(txc, entity.name, [...currentObs, ...newObs]);
  }
  // If no new observations, operation is idempotent
}
```

### Decision 2: Simplify KnowledgeGraphManager.createEntities

**What:** Remove `loadGraph()` call and in-memory deduplication logic, delegate directly to storage provider.

**Why:**
- Single Responsibility Principle: manager orchestrates, provider handles persistence
- Reduces complexity in manager layer
- Makes the code path clearer and easier to test
- Eliminates a major performance bottleneck

**Implementation:**
```typescript
async createEntities(entities: Entity[]): Promise<Entity[]> {
  if (!entities || entities.length === 0) return [];

  // Delegate to storage provider (handles deduplication)
  const createdEntities = await this.storageProvider.createEntities(entities);

  // Schedule embedding jobs for created entities
  if (this.embeddingJobManager) {
    for (const entity of createdEntities) {
      await this.embeddingJobManager.scheduleEntityEmbedding(entity.name, 1);
    }
  }

  return createdEntities;
}
```

### Decision 3: Preserve Temporal Versioning with MERGE

**What:** MERGE must match on `(name, validTo IS NULL)` to respect temporal versioning.

**Why:**
- Multiple versions of an entity can exist (current + archived)
- Only the current version (`validTo IS NULL`) should participate in deduplication
- Archived versions must remain immutable

**Pattern:**
```cypher
MERGE (e:Entity {name: $name, validTo: NULL})
```

This ensures we only match/update the current version, not archived historical versions.

### Decision 4: Preserve Observation Merging Behavior

**What:** When an entity already exists, merge new observations and create a new temporal version using the existing `_createNewEntityVersion` method.

**Why:**
- Maintains backward compatibility with current `KnowledgeGraphManager` behavior
- Prevents silent data loss that would occur with simple idempotent create
- Reuses battle-tested temporal versioning logic
- Consistent with `addObservations` API behavior

**Implementation:**
```typescript
// Inside Neo4jStorageProvider.createEntities
if (existingEntity) {
  const currentObservations = JSON.parse(existingEntity.observations || '[]');
  const newObservations = entity.observations.filter(
    obs => !currentObservations.includes(obs)
  );

  if (newObservations.length > 0) {
    // Merge and create new version
    const merged = [...currentObservations, ...newObservations];
    await this._createNewEntityVersion(txc, entity.name, merged);
  }
}
```

**Trade-off:** This approach requires one additional query per existing entity (to check if it exists), but:
- Queries are indexed and extremely fast (O(log n))
- Prevents data loss
- Much better than loading entire graph (O(n) memory)

## Risks / Trade-offs

### Risk 1: Per-Entity Query Overhead
**Risk:** Checking for each entity individually adds N queries per batch.

**Mitigation:**
- Queries are indexed on `(name, validTo)` and execute in O(log n) time
- Much faster than loading entire graph O(n) with O(n) memory
- All queries happen within a single transaction (atomic)
- For most use cases (creating <100 entities at once), overhead is negligible
- Future optimization: batch query for existence checks if needed

### Risk 2: Temporal Versioning Overhead for Existing Entities
**Risk:** Creating new versions for existing entities with new observations triggers `_createNewEntityVersion`, which invalidates old entity/relationships and recreates them.

**Mitigation:**
- This is the existing behavior - no change from current implementation
- Temporal versioning is a core feature, not a bug
- Only triggered when new observations are actually added
- If no new observations, operation is idempotent (no version created)

### Risk 3: Index Performance
**Risk:** Upsert logic relies on indexed lookups for performance.

**Mitigation:**
- Neo4j schema manager already creates indexes on `Entity.name`
- Query uses `{name: $name, validTo: NULL}` which is efficiently indexed
- Verify index exists in `Neo4jSchemaManager.initializeSchema`

## Migration Plan

### Step 1: Code Changes
1. Update `KnowledgeGraphManager.createEntities` to remove `loadGraph()` and in-memory deduplication
2. Update `Neo4jStorageProvider.createEntities` to implement intelligent upsert:
   - Query for existing entity
   - If not exists: CREATE new entity
   - If exists: Merge observations via `_createNewEntityVersion`
3. Update tests to reflect new behavior

### Step 2: Schema Validation
1. Verify Neo4j has index on `Entity.name` for efficient lookups
2. Schema manager should already handle this in `initializeSchema`

### Step 3: Testing
1. Run full test suite
2. Add integration test for large-scale entity creation
3. Benchmark performance with 10K, 100K, 1M entities

### Step 4: Deployment
1. Document breaking changes in CHANGELOG
2. Deploy to staging environment
3. Monitor memory usage and performance metrics
4. Roll out to production

### Rollback Plan
If issues arise:
1. Revert `KnowledgeGraphManager.createEntities` to previous implementation
2. Keep MERGE changes in Neo4j provider (still beneficial)
3. Investigate and address root cause before re-attempting

## Open Questions

1. **Q:** Should we add metrics/logging for create vs merge operations?
   **A:** Yes, add debug logging to track:
   - Number of entities created (new)
   - Number of entities merged (existing with new observations)
   - Number of entities skipped (existing with no new observations)

2. **Q:** Should we optimize batch existence checks?
   **A:** Not initially. Individual indexed queries are fast enough. If profiling shows this as a bottleneck, we can batch the existence checks with a single `WHERE name IN $names` query.

3. **Q:** How do we handle entity type changes?
   **A:** Current implementation doesn't check for entity type mismatches. If an entity exists with type "person" and we try to create it with type "organization", the observations will merge but the type won't change. This is intentional - entity type is immutable once created. If type change is needed, use `updateEntity` or delete/recreate.
