# Change: Decouple Embedding Generation from Database Transactions

## Why

The current implementation of `Neo4jStorageProvider.createEntities` generates vector embeddings synchronously within an active database transaction. This causes severe performance degradation:

1. **Database lock contention**: Transactions hold locks on Entity nodes for 500ms-5s per embedding (network call to OpenAI), blocking concurrent reads/writes
2. **Transaction timeout risk**: Creating 20+ entities can exceed Neo4j's transaction timeout (typically 60s), causing rollback and data loss
3. **Resource waste**: Embeddings are generated twice - once synchronously in `createEntities` (lines 648-668 of Neo4jStorageProvider.ts), then again asynchronously via `embeddingJobManager.scheduleEntityEmbedding` in KnowledgeGraphManager (lines 467-470)
4. **Application freeze**: Other operations on the knowledge graph are blocked while waiting for slow embedding API calls to complete

The embedding job infrastructure (`Neo4jEmbeddingJobManager`, `Neo4jJobStore`) already exists and is fully functional, but is not being used as the primary embedding generation mechanism.

## What Changes

- **Remove synchronous embedding generation** from `Neo4jStorageProvider.createEntities` (lines 648-668)
- **Entities are created without embeddings** in the initial transaction (fast, milliseconds)
- **Rely exclusively on asynchronous job queue** for embedding generation
- Transaction duration reduced from O(n _ 2s) to O(n _ 10ms) where n = number of entities
- **No API changes**: The public interface remains identical

**Performance Impact**:

- Database transaction time: ~2000ms per entity → ~10ms per entity (200x improvement)
- Lock hold time: Seconds → Milliseconds
- Throughput: No longer limited by embedding API latency
- Consistency: Embeddings eventually consistent (jobs process in background)

## Impact

### Affected Specs

- `embedding-jobs`: Modified requirement for "Entity Creation Integration"

### Affected Code

- `src/storage/neo4j/Neo4jStorageProvider.ts:619-732` - Remove synchronous embedding generation from `createEntities` method
- `src/KnowledgeGraphManager.ts:467-470` - Already schedules jobs correctly, no changes needed

### Breaking Changes

**None** - This is a transparent performance optimization. The public API contract remains unchanged:

- Entities are still created successfully
- Embeddings are still generated (asynchronously)
- Semantic search still works (once jobs complete)

### Migration Path

No migration needed. The change is backward compatible:

1. Entities created before the change have embeddings
2. Entities created after the change get embeddings via job queue
3. Both work identically for semantic search
