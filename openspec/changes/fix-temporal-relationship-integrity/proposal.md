# Fix Temporal Relationship Integrity

## Problem Statement

The Neo4j storage provider currently has **critical data integrity issues** in its temporal versioning system that lead to graph corruption:

### Issue #1: Asymmetric Relationship Handling in Entity Versioning

When entities are versioned (creating a new version with `validTo` set on the old version), the system handles relationships inconsistently:

- **`addObservations()`** ✅ **CORRECTLY**:
  1. Retrieves ALL relationships (incoming AND outgoing) from the old version
  2. Invalidates ALL old relationships by setting `validTo`
  3. Recreates ALL relationships pointing to the new entity version

- **`deleteObservations()`** ❌ **INCORRECTLY**:
  1. Retrieves ONLY the entity (no relationships)
  2. Invalidates ONLY the entity (relationships remain pointing to old version)
  3. Creates new entity version but leaves relationships orphaned

**Result:** After `deleteObservations`, the graph contains relationships pointing from/to archived entity versions, creating an inconsistent temporal state.

### Issue #2: Creation of Relationships with Archived Entities

All operations that create relationships fail to verify that target entities are current (`validTo IS NULL`):

- **`createRelations()`**: Matches entities by name without checking `validTo`, potentially creating relationships between any combination of archived and current versions
- **`addObservations()`** (during relationship recreation): Uses entity IDs from previous relationships without verifying the target entity is still current
- **`saveGraph()`**: Creates relationships without temporal validation
- **`updateRelation()`**: Recreates relationships without verifying entity versions

**Result:** Exponential proliferation of invalid relationships. In production:
- 10 current entities
- 25 current relationships
- 27 total entities (17 archived versions)
- **268 total relationships** (243 phantom relationships pointing to archived entities)

## Impact

1. **Data Corruption**: The knowledge graph becomes unreliable with relationships pointing to non-existent temporal states
2. **Query Inefficiency**: Standard queries must filter out hundreds of phantom relationships
3. **Semantic Integrity**: Graph traversals and semantic search return incorrect results
4. **Storage Bloat**: Database fills with invalid relationship records
5. **Temporal Queries Broken**: Point-in-time queries (`getGraphAtTime`) return inconsistent state

## Proposed Solution

Fix all temporal versioning operations to maintain relationship integrity through refactoring and validation:

1. **Refactor: Extract Entity Versioning Logic (DRY Principle)**:
   - Create private method `_createNewEntityVersion()` to centralize complex versioning logic
   - Both `addObservations` and `deleteObservations` call this shared method
   - Eliminates ~100 lines of duplicated code
   - Ensures consistency between operations
   - Single point of maintenance for future bug fixes

2. **Standardize `deleteObservations`** to use centralized versioning:
   - Calculate new observations array
   - Delegate to `_createNewEntityVersion()` for all versioning complexity
   - Automatic relationship integrity preservation

3. **Add temporal validation to all relationship creation**:
   - Enforce `WHERE validTo IS NULL` in all entity matching queries
   - Verify target entities are current before creating relationships
   - Use current entity names (not cached/stale IDs) when recreating relationships

4. **Create comprehensive test coverage**:
   - Test entity versioning preserves relationship integrity
   - Test relationship creation only targets current entities
   - Test temporal queries return consistent state

## Success Criteria

- ✅ All entity versioning operations maintain bidirectional relationship integrity
- ✅ All relationship creation operations validate entity temporal state
- ✅ No phantom relationships created (total relationships ≈ current relationships + legitimately archived)
- ✅ Temporal queries (`getGraphAtTime`) return consistent graph state
- ✅ Test coverage for all versioning edge cases

## Scope

This change affects:
- `Neo4jStorageProvider._createNewEntityVersion()` - **ADDED** (new private method)
- `Neo4jStorageProvider.deleteObservations()` - **MODIFIED** (refactored to use `_createNewEntityVersion`)
- `Neo4jStorageProvider.addObservations()` - **MODIFIED** (refactored to use `_createNewEntityVersion`)
- `Neo4jStorageProvider.createRelations()` - **MODIFIED** (add temporal validation)
- `Neo4jStorageProvider.saveGraph()` - **MODIFIED** (add temporal validation)
- `Neo4jStorageProvider.updateRelation()` - **MODIFIED** (add temporal validation)
- Test files for temporal integrity - **ADDED**

Does NOT affect:
- Public API contracts (method signatures unchanged)
- MCP server handlers
- Embedding system
- File-based storage provider

## Additional Notes

- **Phantom relationship cleanup**: Since current data is test data that will be cleared, no migration script for existing phantom relationships is needed
- **Code reduction**: Refactoring eliminates ~100 lines of duplicated versioning logic
