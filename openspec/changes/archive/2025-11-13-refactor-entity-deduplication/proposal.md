# Change: Refactor Entity Deduplication to Storage Provider

## Why

The current implementation of `createEntities` in `KnowledgeGraphManager` loads the entire knowledge graph into memory for deduplication, causing severe scalability issues. With graphs containing 100,000+ entities, every entity creation operation loads all entities into RAM, leading to:
- Excessive memory consumption (potentially gigabytes per operation)
- Linear performance degradation as the graph grows
- Risk of Out-Of-Memory crashes in production
- Database query inefficiency (full table scans on every write)

This architectural flaw violates the separation of concerns principle: the manager layer is performing database-level deduplication that should be delegated to the storage provider.

## What Changes

- **BREAKING**: `KnowledgeGraphManager.createEntities` will no longer load the entire graph into memory
- `KnowledgeGraphManager.createEntities` delegates all deduplication logic to the storage provider
- `Neo4jStorageProvider.createEntities` uses `MERGE` queries instead of `CREATE` for atomic deduplication
- Remove in-memory entity map construction from `KnowledgeGraphManager`
- Performance improvement: O(n) → O(1) memory usage for entity creation operations
- Behavioral change: deduplication now happens at database level with transactional guarantees

## Impact

- **Affected specs**: `entity-management` (new capability spec)
- **Affected code**:
  - `src/KnowledgeGraphManager.ts:379-506` (remove `loadGraph()` call and in-memory deduplication)
  - `src/storage/neo4j/Neo4jStorageProvider.ts:620-703` (change `CREATE` to `MERGE`)
- **Migration**: Existing code continues to work, but deduplication semantics change from application-level to database-level
- **Performance**: Dramatic improvement for large graphs (100,000+ entities)
- **Testing**: Requires updating tests that mock `loadGraph()` behavior
