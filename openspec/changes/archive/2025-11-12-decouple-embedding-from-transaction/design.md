# Design: Decouple Embedding Generation from Database Transactions

## Context

The current architecture generates vector embeddings synchronously during entity creation, causing database transactions to remain open for extended periods (seconds to minutes) while waiting for OpenAI API responses. This violates the principle of keeping transactions short and focused.

### Current Flow (Problematic)

```
KnowledgeGraphManager.createEntities()
  └─> Neo4jStorageProvider.createEntities()
      └─> BEGIN TRANSACTION              [Lock acquired]
          ├─> CREATE entity node         [10ms]
          ├─> generateEmbedding()        [500-5000ms - API call!]
          ├─> UPDATE entity with vector  [10ms]
          └─> COMMIT TRANSACTION         [Lock released]
      └─> scheduleEntityEmbedding()      [Duplicate work!]
```

**Problems**:

- Transaction holds locks for ~2-5 seconds per entity
- API failures cause transaction rollback
- Embeddings generated twice (waste of API calls and cost)
- Database becomes bottleneck for concurrent operations

### Stakeholders

- **Performance**: Database operations blocked by slow API calls
- **Reliability**: Transaction timeouts on batch operations
- **Cost**: Duplicate API calls to embedding providers
- **Scalability**: Database throughput limited by external API latency

## Goals / Non-Goals

### Goals

- ✅ Eliminate synchronous embedding generation from database transactions
- ✅ Reduce entity creation transaction time by >95% (from seconds to milliseconds)
- ✅ Remove duplicate embedding generation
- ✅ Maintain eventual consistency for embeddings
- ✅ Preserve existing public API (zero breaking changes)

### Non-Goals

- ❌ Making embeddings synchronously available (they're already async in practice)
- ❌ Changing the job queue architecture (already well-designed)
- ❌ Modifying semantic search behavior (works with or without embeddings)
- ❌ Adding new configuration options (use existing job queue settings)

## Decisions

### Decision 1: Remove Synchronous Embedding from Transaction

**Rationale**: Database transactions must be short-lived and predictable. Network I/O belongs in background workers, not in critical path transactions.

**Implementation**:

- Remove lines 639-668 in `Neo4jStorageProvider.createEntities` (embedding generation code)
- Remove `embedding` parameter from entity CREATE query
- Transaction now only performs fast, local database operations

**Alternatives Considered**:

1. ~~Keep sync generation but add timeout~~ - Still blocks transaction, just fails faster
2. ~~Generate embeddings before transaction~~ - Still delays entity creation, no benefit
3. ✅ **Full async via job queue** - Cleanest separation of concerns

### Decision 2: Rely Exclusively on Existing Job Queue

**Rationale**: The job infrastructure (`Neo4jEmbeddingJobManager`, `Neo4jJobStore`) is production-ready with:

- Durable persistence
- Lease-based concurrency
- Retry logic
- Rate limiting

**Implementation**:

- `KnowledgeGraphManager` already calls `scheduleEntityEmbedding()` (lines 467-470)
- No new code needed - just remove the duplicate sync path
- Workers process jobs independently from entity creation

**Why Not Build New Infrastructure**:

- Job queue already handles all requirements
- Proven implementation with tests
- No need to duplicate orchestration logic

### Decision 3: Accept Eventually Consistent Embeddings

**Rationale**: Semantic search already handles missing embeddings gracefully:

- Falls back to text-based search when vectors unavailable
- Embeddings typically ready within seconds (job queue processes quickly)
- Creating 100 entities = 100 jobs queued instantly, workers process concurrently

**User Experience**:

- Entity creation returns immediately (milliseconds)
- Semantic search available within seconds (typically)
- No user-facing API changes

**Alternative**: Synchronous wait for embeddings

- ❌ Defeats the purpose of async architecture
- ❌ Reintroduces performance problems
- ❌ Couples entity creation to embedding provider availability

## Risks / Trade-offs

### Risk: Embeddings Not Immediately Available

**Mitigation**:

- Semantic search already falls back to text search
- Job queue typically processes within seconds
- Workers can be scaled horizontally for faster processing
- Priority system ensures important entities processed first

**Monitoring**:

- Log job queue depth (already implemented)
- Alert on old pending jobs (>5 minutes)
- Track worker processing rate

### Risk: Job Queue Failure

**Mitigation**:

- Jobs persisted in dedicated Neo4j database (durable)
- Failed jobs automatically retry (max 3 attempts)
- Manual retry available via `retryFailedJobs()`
- Job status monitoring built-in

**Recovery**:

1. Check queue status: `jobStore.getQueueStatus()`
2. Review failed jobs for errors
3. Fix underlying issue (API key, network, etc.)
4. Retry: `jobStore.retryFailedJobs()`

### Trade-off: Eventually Consistent vs Immediately Consistent

**Before**: Embeddings available immediately but entity creation slow (2-5s)
**After**: Entity creation fast (10ms) but embeddings available shortly after (typically <5s)

**Justification**:

- User experience improves (faster entity creation)
- Database throughput increases dramatically
- Semantic search already handles missing embeddings
- Background processing more scalable

## Migration Plan

### Deployment Steps

1. **Pre-deployment**: Verify job queue is running and healthy
2. **Deploy code**: No database migrations needed
3. **Monitor**: Watch job queue depth and processing time
4. **Scale workers**: Add more workers if queue depth grows

### Rollback Strategy

If issues arise:

1. Revert to previous commit
2. Redeploy
3. Job queue will catch up with pending embeddings

### Zero Downtime

- Change is backward compatible
- No API modifications
- Existing entities unaffected
- New entities work immediately (embeddings follow)

## Open Questions

None - the architecture and implementation path are clear.

## Performance Expectations

### Before (Current)

- Create 1 entity: ~2s (transaction time)
- Create 10 entities: ~20s (serial, in transaction)
- Create 50 entities: Transaction timeout (>60s)

### After (This Change)

- Create 1 entity: ~10ms (transaction time)
- Create 10 entities: ~100ms (transaction time)
- Create 50 entities: ~500ms (transaction time)
- Embeddings ready: 5-30s (async, concurrent worker processing)

### Improvement

- **Transaction time**: 200x faster (2000ms → 10ms per entity)
- **Throughput**: 200x higher (no longer bottlenecked by API)
- **Concurrency**: Database free for other operations
- **Reliability**: No transaction timeouts on batch operations
