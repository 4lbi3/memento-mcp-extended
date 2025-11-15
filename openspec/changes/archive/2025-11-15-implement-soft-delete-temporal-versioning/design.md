# Design: Soft Delete for Temporal Versioning

## Context

Memento MCP implements a temporal versioning system where all changes to entities and relationships are preserved with `validFrom/validTo` timestamps. The current implementation violates this contract by using hard deletes (DETACH DELETE / DELETE) that permanently remove data, destroying the temporal history.

**Stakeholders**: All MCP clients relying on temporal queries, audit trails, and historical graph reconstruction.

**Constraints**:
- Must maintain backward compatibility with existing MCP tool interfaces
- Must preserve temporal consistency (all relationships must connect to valid entities)
- Must not break existing tests or features
- Must provide a maintenance path for database cleanup

## Goals / Non-Goals

**Goals**:
- Implement soft delete semantics for entities and relationships using `validTo` timestamps
- Preserve complete temporal history for audit and rollback
- Provide administrative purge methods for database maintenance
- Maintain temporal integrity (no phantom relationships)

**Non-Goals**:
- Automatic garbage collection of old versions (manual purge only)
- Recovering previously hard-deleted data (irreversible)
- Changing the external MCP tool API (internal implementation only)

## Decisions

### Decision 1: Soft Delete Implementation Pattern

**What**: Use `SET validTo = timestamp` instead of DELETE for both entities and relationships.

**Why**:
- Preserves complete version history as specified in temporal-versioning spec
- Enables point-in-time queries and historical reconstruction
- Maintains audit trail for compliance and debugging
- Allows rollback/undo operations in the future

**Implementation**:
```cypher
// Old (hard delete)
MATCH (e:Entity)
WHERE e.name IN $names
DETACH DELETE e

// New (soft delete)
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
```

**Alternatives considered**:
- **Option A**: Continue using hard deletes - **Rejected**: Violates spec and destroys history
- **Option B**: Add a `deleted` flag - **Rejected**: Redundant with `validTo` timestamp, less semantic
- **Option C**: Move to separate archive database - **Rejected**: Adds complexity, breaks temporal queries

### Decision 2: Cascade Relationship Invalidation

**What**: When soft-deleting an entity, automatically invalidate all incoming and outgoing relationships.

**Why**:
- Maintains temporal integrity (no relationships to non-existent entities)
- Consistent with version creation behavior (see `_createNewEntityVersion`)
- Prevents phantom relationship bugs

**Implementation**: Part of the soft delete transaction (see Decision 1 code).

### Decision 3: Add Purge Methods for Maintenance

**What**: Add `purgeArchivedEntities(cutoffTimestamp)` and `purgeArchivedRelations(cutoffTimestamp)` methods.

**Why**:
- Provides database size management for long-running systems
- Allows administrators to control retention policy
- Separates concern: soft delete (functional) vs. purge (operational)

**Safety constraints**:
- Only purge entities/relations where `validTo IS NOT NULL` (archived)
- Only purge entities/relations where `validTo < cutoffTimestamp` (old enough)
- Use transactions with rollback on error
- Log all purge operations with counts

**Alternatives considered**:
- **Option A**: Automatic time-based purging - **Rejected**: Too risky, should be explicit
- **Option B**: No purge methods - **Rejected**: Database would grow indefinitely
- **Option C**: MCP tool for purging - **Rejected**: Administrative concern, not user-facing

### Decision 4: Read Query Filtering

**What**: Verify all read queries filter `validTo IS NULL` to exclude soft-deleted items.

**Why**:
- Soft-deleted items should be invisible to normal read operations
- Only historical/audit queries should see soft-deleted data
- Consistent behavior across all read paths

**Audit checklist**:
- `loadGraph()` - Already filters `validTo IS NULL` ✓
- `getEntity()` - Already filters `validTo IS NULL` ✓
- `getRelations()` - Need to verify
- `searchEntities()` - Need to verify

## Risks / Trade-offs

### Risk 1: Database Size Growth
**Impact**: Medium - Database will accumulate deleted versions over time
**Mitigation**: Provide purge methods with clear documentation on retention policies
**Monitoring**: Add metrics for archived entity/relationship counts

### Risk 2: Query Performance
**Impact**: Low - Additional `validTo IS NULL` filters may slow queries slightly
**Mitigation**:
- Composite index on `(name, validTo)` already exists
- Neo4j can efficiently filter on indexed NULL values
**Monitoring**: Benchmark query performance before/after

### Risk 3: Breaking Change for Clients
**Impact**: Low - External API unchanged, but behavior changes
**Mitigation**:
- Document the change clearly in README
- Soft deletes are MORE correct per the spec
- No client code changes needed
**Rollback**: Can revert to hard deletes if critical issues found

### Risk 4: Incomplete Historical Data
**Impact**: High - Previously hard-deleted data cannot be recovered
**Mitigation**:
- Accept as known limitation
- Document in migration notes
- Future deletions will preserve history
**Workaround**: None for existing data

## Migration Plan

### Forward Migration
1. Deploy new code with soft delete implementation
2. No database schema changes required (validTo field already exists)
3. Future delete operations will preserve history
4. Monitor logs for successful soft delete operations

### Rollback Plan
1. Revert code to previous version
2. Future deletes will use hard delete again
3. Soft-deleted data from interim period remains (benign)

### Data Cleanup (Optional)
Administrators may choose to purge old archived versions:
```typescript
// Purge entities archived more than 90 days ago
const cutoff = Date.now() - (90 * 24 * 60 * 60 * 1000);
await storageProvider.purgeArchivedEntities(cutoff);
await storageProvider.purgeArchivedRelations(cutoff);
```

## Open Questions (Answered)

1. **Should we expose purge methods via MCP tools?**
   - NO - administrative concern, not user-facing
   - add CLI command instead: `npm run neo4j:purge --before=2024-01-01`

2. **What should default retention policy be?**
   - No automatic purging, manual only
   - Document recommended retention (e.g., 90 days) in README

3. **Should we add metrics for archived data volume?**
   - YES - add to diagnostics/stats endpoint
   - Metrics: archived_entity_count, archived_relation_count, total_storage_bytes
