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

- [ ] 2.1 Change `CREATE` query to `MERGE` with temporal constraint in `createEntities` (line 658)
- [ ] 2.2 Add `ON CREATE SET` clause to initialize all entity properties
- [ ] 2.3 Ensure MERGE matches on `{name: $name, validTo: NULL}` for temporal versioning
- [ ] 2.4 Verify transaction handling with MERGE operations
- [ ] 2.5 Update method documentation to reflect MERGE-based deduplication

## 3. Update Tests

- [ ] 3.1 Update `KnowledgeGraphManager.test.ts` to remove `loadGraph` mocking expectations
- [ ] 3.2 Add test for duplicate entity creation without loading graph
- [ ] 3.3 Add test for batch entity creation with duplicates
- [ ] 3.4 Update Neo4j storage provider tests to verify MERGE behavior
- [ ] 3.5 Add integration test for large-scale entity creation (10,000+ entities)
- [ ] 3.6 Verify temporal versioning is preserved with MERGE operations

## 4. Performance Validation

- [ ] 4.1 Create benchmark script for entity creation with varying graph sizes
- [ ] 4.2 Verify O(1) memory usage for entity creation operations
- [ ] 4.3 Measure performance improvement for large graphs (100,000+ entities)
- [ ] 4.4 Document performance characteristics in CHANGELOG

## 5. Documentation

- [ ] 5.1 Update CHANGELOG.md with breaking changes and migration notes
- [ ] 5.2 Update README.md if API behavior description is affected
- [ ] 5.3 Add JSDoc comments explaining deduplication strategy
- [ ] 5.4 Document performance improvements in relevant files
