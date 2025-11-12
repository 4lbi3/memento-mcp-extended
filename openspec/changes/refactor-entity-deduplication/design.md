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

### Decision 1: Use Database-Level MERGE for Deduplication

**What:** Replace application-level deduplication with Neo4j's `MERGE` operation.

**Why:**
- Neo4j can efficiently check for duplicate entities using indexes
- `MERGE` provides atomicity and transactional guarantees
- Eliminates need to load existing entities into application memory
- Industry-standard pattern for upsert operations in graph databases

**Alternatives Considered:**
1. **Keep in-memory deduplication, add caching:** Doesn't solve the O(n) memory problem, adds complexity
2. **Query database individually for each entity:** N+1 query problem, slower than MERGE
3. **Use uniqueness constraints only:** Doesn't handle observation merging, throws errors on duplicates

**Cypher Pattern:**
```cypher
MERGE (e:Entity {name: $name, validTo: NULL})
ON CREATE SET
  e.id = $id,
  e.entityType = $entityType,
  e.observations = $observations,
  e.version = 1,
  e.createdAt = $now,
  e.updatedAt = $now,
  e.validFrom = $now,
  e.changedBy = $changedBy
RETURN e
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

### Decision 4: Handle Observation Merging at Application Level (Future)

**What:** For now, `ON CREATE SET` will only fire if the entity doesn't exist. Observation merging for existing entities is deferred.

**Why:**
- MERGE with `ON MATCH SET` would require handling observation array merging in Cypher
- Current behavior: if entity exists, nothing changes (idempotent create)
- Future enhancement: can add observation merging in `ON MATCH SET` clause

**Trade-off:** Current implementation won't merge new observations into existing entities during `createEntities`. This maintains idempotency but may require a separate `addObservations` call if observations need to be merged.

## Risks / Trade-offs

### Risk 1: Behavioral Change in Edge Cases
**Risk:** If application code relies on `createEntities` merging observations into existing entities, that behavior will change.

**Mitigation:**
- Review test suite for expectations around duplicate entity creation
- Document the change as a behavior clarification (was undefined, now idempotent)
- Current code in `KnowledgeGraphManager:404-422` shows it merges observations - we'll need to decide if MERGE should do this via `ON MATCH SET`

### Risk 2: MERGE Performance with Many Entities
**Risk:** If creating thousands of entities in one call, individual MERGE operations might be slower than a bulk CREATE.

**Mitigation:**
- MERGE is still O(log n) per entity due to index usage
- For bulk scenarios, Neo4j's index lookups are highly optimized
- If needed, can batch MERGE operations in future optimization

### Risk 3: Uniqueness Constraint Required
**Risk:** MERGE works best with a uniqueness constraint on `(name, validTo)`.

**Mitigation:**
- Neo4j schema manager should create this constraint if not present
- Verify `Neo4jSchemaManager` includes appropriate constraints
- Add migration step if constraint is missing

## Migration Plan

### Step 1: Code Changes
1. Update `KnowledgeGraphManager.createEntities` to remove `loadGraph()` and in-memory deduplication
2. Update `Neo4jStorageProvider.createEntities` to use MERGE instead of CREATE
3. Update tests to reflect new behavior

### Step 2: Schema Validation
1. Verify Neo4j has uniqueness constraint on `(Entity.name, Entity.validTo)`
2. If missing, add schema migration in `Neo4jSchemaManager`

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

1. **Q:** Should MERGE update observations for existing entities?
   **A:** TBD - need to decide if `createEntities` should be idempotent (no update) or merge observations. Current code merges, but we could defer this to `addObservations` API.

2. **Q:** What happens if `validTo IS NULL` constraint is violated (shouldn't be possible)?
   **A:** Neo4j will enforce uniqueness. If violated, MERGE will match the first found entity.

3. **Q:** Should we add metrics/logging for MERGE hits vs creates?
   **A:** Yes, add debug logging to track deduplication effectiveness.
