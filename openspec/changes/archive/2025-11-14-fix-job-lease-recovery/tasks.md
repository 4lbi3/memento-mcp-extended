# Implementation Tasks

## 1. Add Recovery Methods to Neo4jJobStore

- [x] 1.1 Implement `recoverStaleJobs()` method in `src/storage/neo4j/Neo4jJobStore.ts`
  - Query for jobs where `status = 'processing' AND lock_until < timestamp()`
  - Reset to `pending`, clear `lock_owner` and `lock_until`
  - Return count of recovered jobs
  - Add logging for recovery events
- [x] 1.2 Implement `releaseJobs(jobIds: string[], lockOwner: string)` method
  - Query jobs matching IDs and owner
  - Reset matching jobs to `pending`, clear locks
  - Return count of released jobs
  - Handle empty array as no-op
- [x] 1.3 Update `JobStore` interface types if needed
- [x] 1.4 Add unit tests for `recoverStaleJobs()` in `src/storage/neo4j/__vitest__/Neo4jJobStore.test.ts`
  - Test expired jobs reset to pending
  - Test active jobs not affected
  - Test edge cases (no stale jobs, mixed states)
- [x] 1.5 Add unit tests for `releaseJobs()`
  - Test batch release
  - Test owner validation
  - Test empty array handling

## 2. Add Release Logic to Job Manager

- [x] 2.1 Modify `processJobs()` in `src/embeddings/Neo4jEmbeddingJobManager.ts`
  - Track which jobs have been started vs just leased
  - On rate limit break, call `releaseJobs()` for unleased jobs
  - On early exit (errors), call `releaseJobs()` for unleased jobs
  - Ensure cleanup happens in finally block
- [x] 2.2 Add logging for job release events
- [x] 2.3 Update unit tests in `src/embeddings/__vitest__/Neo4jEmbeddingJobManager.test.ts`
  - Test rate limit triggers job release
  - Test jobs not started are released
  - Test active jobs complete normally

## 3. Add Background Stale Job Recovery

- [x] 3.1 Add `staleJobRecoveryInterval` configuration option to `Neo4jEmbeddingJobManager`
  - Default: 60000ms (60 seconds)
  - Make configurable via constructor
- [x] 3.2 Implement background recovery timer
  - Start on manager initialization
  - Call `jobStore.recoverStaleJobs()` periodically
  - Log recovery results
  - Handle errors gracefully (log and continue)
- [x] 3.3 Add immediate recovery on startup
  - Call `recoverStaleJobs()` once during initialization
  - Log results for observability
- [x] 3.4 Add cleanup on manager shutdown
  - Clear recovery timer
  - Ensure graceful shutdown
- [x] 3.5 Add environment variable support
  - `EMBED_JOB_RECOVERY_INTERVAL` (milliseconds)
  - Document in spec deployment section
- [x] 3.6 Add unit tests for background recovery
  - Test recovery runs periodically
  - Test immediate recovery on startup
  - Test timer cleanup on shutdown
  - Test error handling in recovery process

## 4. Integration Testing

- [x] 4.1 Add integration test for worker crash scenario
  - Lease jobs, simulate crash (clear locks without cleanup)
  - Verify recovery resets jobs to pending
- [x] 4.2 Add integration test for rate limit scenario
  - Lease batch, hit rate limit mid-processing
  - Verify unleased jobs are released
  - Verify leased jobs complete or fail normally
- [x] 4.3 Add integration test for heartbeat failure
  - Start processing, stop heartbeat
  - Wait for lock expiry
  - Verify recovery resets jobs

## 5. Documentation and Cleanup

- [x] 5.1 Update deployment documentation in spec
  - Document new environment variable
  - Document recovery behavior
- [x] 5.2 Add JSDoc comments for new methods
- [x] 5.3 Update README if necessary
- [x] 5.4 Run linting and formatting: `npm run lint && npm run format`
- [x] 5.5 Run full test suite: `npm test`
- [x] 5.6 Verify no regressions in existing functionality
