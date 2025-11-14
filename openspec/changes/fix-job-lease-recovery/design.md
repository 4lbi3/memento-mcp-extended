# Design Document: Job Lease Recovery

## Context

The embedding job processing system uses lease-based locking to coordinate multiple workers processing jobs from a shared Neo4j queue. Jobs transition through states: `pending` → `processing` (when leased) → `completed`/`failed`.

**Current Problem**: Jobs can get stuck in `processing` status indefinitely due to:
1. Worker crashes, OOM, or pauses while holding leases
2. Rate limiter causing early exit from processing loop without releasing unleased jobs
3. No automatic recovery mechanism to detect and reset expired locks

**Impact**: After a single worker failure, the embedding queue can freeze permanently, degrading vector search coverage until manual intervention.

**Stakeholders**:
- MCP server operators who rely on automatic embedding generation
- End users whose semantic search quality degrades when embeddings are missing

## Goals / Non-Goals

### Goals
- Automatically recover jobs stuck in `processing` with expired locks
- Prevent job abandonment when rate limiting occurs
- Maintain backward compatibility (no breaking changes)
- Keep recovery overhead minimal (efficient queries on indexed fields)
- Enable graceful degradation (recovery errors don't crash workers)

### Non-Goals
- Change the fundamental lease-based job processing model
- Add distributed coordination (e.g., Redis, etcd) - keep Neo4j-only
- Implement job priority changes or scheduling algorithms
- Add new job states beyond existing `pending`/`processing`/`completed`/`failed`

## Decisions

### Decision 1: Periodic Background Recovery vs On-Demand Recovery
**Choice**: Implement periodic background recovery with immediate recovery on worker startup

**Rationale**:
- **Periodic recovery** ensures jobs are recovered even if no new leasing attempts occur
- **Startup recovery** handles crash scenarios immediately when a new worker starts
- Combined approach provides both proactive and reactive recovery
- Query overhead is minimal (indexed fields, runs every 60s by default)

**Alternatives Considered**:
- On-demand recovery only during `leaseJobs()`: Would not recover jobs if no leasing happens (e.g., all workers paused)
- Always-on recovery in every operation: Too much overhead, unnecessary queries

### Decision 2: Stale Job Recovery Query Design
**Choice**: Reset jobs to `pending` if `status = 'processing' AND lock_until < timestamp()`

**Rationale**:
- Leverages existing lock expiry mechanism
- Query is efficient (indexed on `status` and `lock_until`)
- Preserves attempt counter for proper retry logic
- Safe: only affects truly expired locks

**Cypher Query**:
```cypher
MATCH (job:EmbedJob)
WHERE job.status = 'processing'
  AND job.lock_until < timestamp()
SET job.status = 'pending',
    job.lock_owner = null,
    job.lock_until = null
RETURN count(job) as recovered
```

### Decision 3: Explicit Job Release for Rate Limit Handling
**Choice**: Add `releaseJobs(jobIds[], lockOwner)` method and call it when rate limit breaks processing loop

**Rationale**:
- Explicit release is immediate (no waiting for background recovery)
- Prevents other workers from waiting up to 60s for recovery
- Owner validation prevents accidental cross-worker interference
- Batch operation is more efficient than per-job releases

**Implementation Pattern**:
```typescript
const leasedJobs = await jobStore.leaseJobs(batchSize, workerId, lockDuration);
const activeJobIds = new Set<string>();

try {
  for (const job of leasedJobs) {
    if (!rateLimitCheck.success) {
      // Release all jobs not yet added to activeJobIds
      const unleased = leasedJobs.filter(j => !activeJobIds.has(j.id));
      await jobStore.releaseJobs(unleased.map(j => j.id), workerId);
      break;
    }
    activeJobIds.add(job.id);
    // ... process job
  }
} finally {
  // Clear heartbeat timer
}
```

### Decision 4: Configuration via Environment Variable
**Choice**: Add `EMBED_JOB_RECOVERY_INTERVAL` environment variable (default: 60000ms)

**Rationale**:
- Allows operators to tune recovery frequency based on their needs
- Fast recovery (e.g., 10s) for high-throughput systems
- Slower recovery (e.g., 300s) for low-traffic systems to reduce query overhead
- Default of 60s balances responsiveness and efficiency

**Alternatives Considered**:
- Hardcoded interval: Not flexible enough for different deployment scenarios
- Dynamic interval based on queue size: Too complex, premature optimization

### Decision 5: Heartbeat Continues for Active Jobs During Rate Limit
**Choice**: Keep heartbeat timer running for `activeJobIds` even when rate limit pauses processing

**Rationale**:
- Jobs actively being processed need lock extension regardless of rate limit
- Heartbeat is already scoped to `activeJobIds` set
- Released jobs are not in `activeJobIds`, so heartbeat doesn't affect them
- No changes needed to existing heartbeat logic

## Risks / Trade-offs

### Risk 1: Background Recovery Query Overhead
**Mitigation**:
- Query only runs every 60s (configurable)
- Uses indexed fields (`status`, `lock_until`)
- Returns count only, minimal data transfer
- Can be tuned via `EMBED_JOB_RECOVERY_INTERVAL`

### Risk 2: Race Condition Between Recovery and Heartbeat
**Scenario**: Recovery runs while heartbeat is extending lock
**Mitigation**:
- Recovery query checks `lock_until < timestamp()` atomically
- If heartbeat extends lock just before recovery, lock is valid and recovery skips it
- If recovery runs just before heartbeat, heartbeat fails gracefully (job no longer owned)
- Both operations are idempotent

### Risk 3: Recovery Interfering with Manual Debugging
**Scenario**: Operator wants to inspect stuck job, but recovery resets it
**Mitigation**:
- Logs include full recovery events (job IDs, timestamps)
- Operators can disable recovery by setting `EMBED_JOB_RECOVERY_INTERVAL=0`
- Neo4j query history shows what was recovered

### Trade-off: Immediate Release vs Wait for Background Recovery
**Choice**: Implement both
**Rationale**:
- Immediate release (via `releaseJobs()`) optimizes for fast recovery in rate limit scenarios
- Background recovery (periodic) handles all other failure modes (crashes, OOM, pauses)
- Small code complexity increase is worth the operational reliability improvement

## Migration Plan

### Deployment Steps
1. Deploy new code with recovery methods
2. No database schema changes required (uses existing fields)
3. Optionally set `EMBED_JOB_RECOVERY_INTERVAL` environment variable
4. Monitor logs for recovery events
5. Verify queue health via existing metrics

### Rollback Plan
- If recovery causes issues, set `EMBED_JOB_RECOVERY_INTERVAL=0` to disable
- Revert to previous code version
- No data migration needed (recovery only affects runtime behavior)

### Backward Compatibility
- All changes are additive (new methods, new config)
- Existing job processing flow unchanged
- Existing tests continue to pass
- No API changes visible to external clients

## Open Questions

1. **Should recovery interval be per-worker or shared across deployment?**
   - Current design: Per-worker (each worker runs own timer)
   - Alternative: Coordinate via Neo4j (add recovery lock/lease)
   - **Decision**: Start with per-worker (simpler), coordinate only if N-worker collisions observed

2. **Should we add metrics/counters for recovery events?**
   - Not in scope for initial implementation
   - Can be added later if operational needs demand it
   - Logs provide sufficient observability for now

3. **Should recovery be disabled by default (opt-in)?**
   - **Decision**: Enabled by default (safer default)
   - Recovery is critical for production reliability
   - Risk of forgetting to enable outweighs risk of unexpected recovery behavior
