# Change: Fix Job Lease Recovery and Rate Limit Handling

## Why

The embedding job processing system has a critical flaw where jobs can become permanently stuck in `processing` status under two failure scenarios:

1. **Worker crashes or failures**: When a worker crashes, goes OOM, or is paused while holding leased jobs, there is no automatic mechanism to recover those jobs back to `pending` status. While the `leaseJobs` method checks for expired locks (`lock_until < timestamp()`), jobs remain in `processing` status indefinitely if their locks expire without being reclaimed.

2. **Rate limit abandonment**: When the rate limiter triggers during `processJobs` ([Neo4jEmbeddingJobManager.ts:307-314](src/embeddings/Neo4jEmbeddingJobManager.ts#L307-L314)), the processing loop exits with `break`, abandoning any remaining leased jobs. These jobs remain locked and in `processing` status even though they were never started, and the heartbeat mechanism cannot help them because they're not in the `activeJobIds` set.

This causes **permanent queue freeze** after a single worker failure, degrading embedding coverage indefinitely and requiring manual intervention to recover.

## What Changes

- Add `recoverStaleJobs()` method to `Neo4jJobStore` to find jobs with expired locks in `processing` status and reset them to `pending`
- Add `releaseJobs()` method to `Neo4jJobStore` to explicitly release multiple job leases back to `pending`
- Modify `Neo4jEmbeddingJobManager.processJobs()` to call `releaseJobs()` for unleased jobs when rate limit is hit or processing stops early
- Add background stale job recovery that runs periodically (configurable interval, default: 60 seconds)
- Add comprehensive tests for all recovery scenarios (worker crash, rate limit, heartbeat failure)
- **BREAKING**: None - all changes are additive or internal to job processing

## Impact

- **Affected specs**: `embedding-jobs` (modifications to Job Lifecycle Management and Rate Limiting requirements)
- **Affected code**:
  - `src/storage/neo4j/Neo4jJobStore.ts` - Add recovery methods
  - `src/embeddings/Neo4jEmbeddingJobManager.ts` - Add release logic and background recovery
  - Tests in `src/embeddings/__vitest__/Neo4jEmbeddingJobManager.test.ts` and `src/storage/neo4j/__vitest__/Neo4jJobStore.test.ts`
- **Deployment**: No migration needed, backward compatible
- **Performance**: Minimal impact - periodic recovery query runs against indexed fields
