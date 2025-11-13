# Design: Error Handling and Recovery System

## Context

The current error handling approach logs errors but doesn't implement recovery strategies. This leads to:
- Embedding jobs stuck in pending state after transient API failures
- Users receiving degraded search results without awareness
- Difficult-to-diagnose data quality issues

The system needs systematic error classification and recovery to handle:
- Transient failures (network timeouts, rate limits) → Retry with backoff
- Permanent failures (invalid data, missing entities) → Fail fast with clear error
- Critical failures (database corruption) → Escalate and halt

## Goals / Non-Goals

### Goals
- Classify errors into recoverable vs non-recoverable categories
- Implement appropriate recovery strategy per error type
- Make search quality degradation visible to clients
- Provide health monitoring for job processing system
- Maintain backward compatibility where possible

### Non-Goals
- Complex distributed tracing or APM integration
- Automated alerting/paging (out of scope, manual monitoring for now)
- Retry logic for user-facing MCP operations (only background jobs)
- Dead letter queue (DLQ) for failed jobs (future enhancement)

## Decisions

### Error Classification Strategy

**Decision**: Three-tier error categorization
```typescript
enum ErrorCategory {
  TRANSIENT = 'transient',   // Retry with backoff
  PERMANENT = 'permanent',   // Fail fast, log context
  CRITICAL = 'critical'       // Escalate, may need intervention
}
```

**Rationale**:
- Simple enough to reason about
- Covers the spectrum of failures we encounter
- Maps cleanly to recovery strategies

**Alternatives Considered**:
- HTTP status code mapping (too coupled to network layer)
- Fine-grained categories (5+ types would add complexity without benefit)

### Retry Policy

**Decision**: Exponential backoff with jitter for TRANSIENT errors
```typescript
const retryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterFactor: 0.1
};

// Retry delays: ~1s, ~2s, ~4s
```

**Rationale**:
- Exponential backoff prevents thundering herd
- Jitter reduces collision probability in multi-worker scenarios
- 3 retries balances recovery vs. latency

**Alternatives Considered**:
- Fixed delay retry (doesn't handle sustained outages well)
- Circuit breaker pattern (overkill for our job queue scale)

### Search Result Transparency

**Decision**: Add metadata fields to search results
```typescript
interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
  searchType?: 'semantic' | 'keyword' | 'hybrid';
  fallbackReason?: string;
  total?: number;
  timeTaken?: number;
}
```

**Breaking Change**: Yes - new required fields in response
**Migration**: Clients can ignore new fields initially, then adapt

**Rationale**:
- Makes degradation visible without changing existing entity/relation structure
- Clients can programmatically detect when semantic search failed
- `fallbackReason` helps debugging

**Alternatives Considered**:
- Separate error channel (complicates API)
- Logging only (users remain unaware)
- Throw error on degradation (too strict, breaks existing workflows)

### Job Timeout Mechanism

**Decision**: Lease-based timeout with heartbeat extension
```typescript
const JOB_LOCK_DURATION = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 2 minutes

// During long jobs:
setInterval(() => jobStore.heartbeatJobs(leasedIds, workerId, lockDuration), HEARTBEAT_INTERVAL);
```

**Rationale**:
- Prevents indefinite locks on crashed workers
- Heartbeat allows legitimate long-running jobs
- Neo4j lease pattern already implemented, just need to use it

**Alternatives Considered**:
- Fixed timeout only (punishes slow but legitimate jobs)
- No timeout (jobs stuck forever on worker crash)

### Error Context Enrichment

**Decision**: Structured logging with operation context
```typescript
logger.error('Job processing failed', {
  jobId: job.id,
  entityName: job.entity_uid,
  errorType: classifyError(error),
  attempt: job.attempts,
  maxAttempts: job.max_attempts,
  errorMessage: error.message,
  errorStack: error.stack
});
```

**Rationale**:
- Makes debugging cause-root analysis faster
- Supports log aggregation queries
- Minimal overhead

## Risks / Trade-offs

### Risk: Retry Logic Increases Latency
**Mitigation**:
- Max 3 retries with capped delays keeps worst-case under 10s
- Only applies to background jobs, not user-facing operations

### Risk: Breaking API Changes
**Mitigation**:
- New fields are optional in most contexts
- Provide migration guide with examples
- Version bump to 0.4.0 signals breaking change

### Risk: Error Classification Bugs
**Impact**: Wrong category → wrong recovery strategy
**Mitigation**:
- Conservative defaults (treat unknown errors as PERMANENT to avoid infinite retry)
- Comprehensive unit tests for classification logic
- Log all classification decisions for audit

### Trade-off: Added Complexity
**Cost**: ~300 LOC for error utils and refactored handlers
**Benefit**: Prevents data loss, improves debugging, increases reliability
**Assessment**: Worth the complexity for production robustness

## Migration Plan

### Phase 1: Non-Breaking Changes (Can deploy immediately)
1. Add error classification utility
2. Improve logging with context
3. Add health monitoring

### Phase 2: Breaking Changes (Requires coordination)
1. Update search result format
2. Modify job processing loop with retry
3. Release as v0.4.0

### Rollback Plan
If issues arise:
1. Git revert to previous commit
2. Redeploy v0.3.9
3. Job queue state persists (no data loss)

### Testing Strategy
- Unit tests: Error classification logic
- Integration tests: Full retry cycle with mock failures
- Manual testing: Simulate network outages, API rate limits

## Open Questions

1. **Should we add a Dead Letter Queue (DLQ) for permanently failed jobs?**
   - **Answer**: Not in this change. Track as future enhancement if we see accumulation of failed jobs.

2. **What's the threshold for "health degraded" status?**
   - **Proposal**: 5 consecutive failures OR 50% failure rate over 10 jobs
   - **Decision**: Start with 5 consecutive, adjust based on monitoring data

3. **Should retry backoff be configurable per environment?**
   - **Decision**: No - hardcode initially. Add env vars if production needs tuning.

4. **How to handle partial batch failures in job processing?**
   - **Decision**: Process jobs independently. One failure doesn't stop batch. Track individual job retry counts.
