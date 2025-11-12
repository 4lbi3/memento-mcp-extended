# Implementation Tasks

## 1. Refactor KnowledgeGraphManager

- [ ] 1.1 Remove `loadGraph()` call from `createEntities` method (line 390)
- [ ] 1.2 Remove in-memory entity map construction (lines 391-396)
- [ ] 1.3 Remove in-memory deduplication loop (lines 402-422)
- [ ] 1.4 Simplify logic to directly delegate to `storageProvider.createEntities()`
- [ ] 1.5 Preserve embedding job scheduling after storage provider completes
- [ ] 1.6 Preserve vector store synchronization for entities with existing embeddings
- [ ] 1.7 Update method documentation to reflect new behavior

## 2. Update Neo4j Storage Provider

- [ ] 2.1 Implement intelligent upsert pattern in `createEntities` (line 621-703)
- [ ] 2.2 For each entity, query for existence: `MATCH (e:Entity {name: $name, validTo: NULL}) RETURN e`
- [ ] 2.3 If entity doesn't exist: execute CREATE query with all properties (existing logic)
- [ ] 2.4 If entity exists: extract current observations and compare with new ones
- [ ] 2.5 If new observations found: call `_createNewEntityVersion` with merged observations
- [ ] 2.6 If no new observations: skip (idempotent)
- [ ] 2.7 Ensure all operations occur within a single transaction
- [ ] 2.8 Add debug logging for create/merge/skip operations
- [ ] 2.9 Update method documentation to reflect upsert behavior

## 3. Update Tests

- [ ] 3.1 Update `KnowledgeGraphManager.test.ts` to remove `loadGraph` mocking expectations
- [ ] 3.2 Add test for creating new entity (doesn't exist case)
- [ ] 3.3 Add test for creating duplicate entity with new observations (merge case)
- [ ] 3.4 Add test for creating duplicate entity with no new observations (idempotent case)
- [ ] 3.5 Add test for batch entity creation with mix of new/existing entities
- [ ] 3.6 Update Neo4j storage provider tests to verify upsert behavior
- [ ] 3.7 Add integration test for large-scale entity creation (10,000+ entities)
- [ ] 3.8 Verify temporal versioning is preserved (archived versions untouched)
- [ ] 3.9 Test that `_createNewEntityVersion` is called correctly for observation merges

## 4. Performance Validation

- [ ] 4.1 Create benchmark script for entity creation with varying graph sizes (1K, 10K, 100K entities)
- [ ] 4.2 Measure memory usage - verify it's independent of total entity count
- [ ] 4.3 Measure operation time for creating entities in large graphs
- [ ] 4.4 Compare performance: old (loadGraph) vs new (upsert) implementation
- [ ] 4.5 Verify indexed query performance for existence checks
- [ ] 4.6 Document performance characteristics and improvements in CHANGELOG

## 5. Documentation

- [ ] 5.1 Update CHANGELOG.md with breaking changes and migration notes
- [ ] 5.2 Update README.md if API behavior description is affected
- [ ] 5.3 Add JSDoc comments explaining deduplication strategy
- [ ] 5.4 Document performance improvements in relevant files
