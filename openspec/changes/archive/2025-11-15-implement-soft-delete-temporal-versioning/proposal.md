# Change: Implement Soft Delete for Temporal Versioning

## Why

Currently, `deleteEntities()` and `deleteRelations()` perform hard deletes (DETACH DELETE / DELETE) that completely remove nodes and relationships from the database. This violates the temporal versioning contract described in the README and temporal-versioning specification, which states:

- "Non-Destructive Updates: Updates create new versions rather than overwriting existing data"
- "Full Version History: Every change to an entity or relation is preserved with timestamps"
- Entity versions use `validFrom/validTo` timestamps to track temporal state

Hard deletes destroy the complete version history, breaking:
- Audit trails and historical queries
- Point-in-time graph reconstruction
- Rollback capabilities
- Temporal consistency guarantees

## What Changes

- **BREAKING**: `deleteEntities()` will soft-delete by setting `validTo = timestamp` instead of using DETACH DELETE
- **BREAKING**: `deleteRelations()` will soft-delete by setting `validTo = timestamp` instead of using DELETE
- Add new method `purgeArchivedEntities()` for permanently removing archived versions (admin/maintenance only)
- Add new method `purgeArchivedRelations()` for permanently removing archived relationships (admin/maintenance only)
- Update all read queries to properly filter `validTo IS NULL` to exclude soft-deleted items
- Add comprehensive tests for soft delete behavior and temporal integrity

## Impact

- **Affected specs**: temporal-versioning
- **Affected code**:
  - `src/storage/neo4j/Neo4jStorageProvider.ts:deleteEntities()` (lines 1231-1265)
  - `src/storage/neo4j/Neo4jStorageProvider.ts:deleteRelations()` (lines 1344-1393)
  - New methods: `purgeArchivedEntities()`, `purgeArchivedRelations()`
- **Breaking changes**:
  - Delete operations no longer physically remove data
  - Soft-deleted entities/relations remain queryable via historical queries
  - Database size will grow over time (mitigation: purge methods for maintenance)
- **Migration**: No data migration needed, but existing hard-deleted data cannot be recovered
