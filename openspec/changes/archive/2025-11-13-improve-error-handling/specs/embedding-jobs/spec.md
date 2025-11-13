# Embedding Jobs Capability - Error Handling Improvements

## ADDED Requirements

### Requirement: Error Classification and Recovery
The embedding job processing system MUST classify errors and apply appropriate recovery strategies based on error type.

#### Scenario: Transient errors trigger retry with exponential backoff
- **GIVEN** a job processing worker encounters a network timeout error
- **WHEN** the error is classified as TRANSIENT
- **THEN** the job is retried with exponential backoff delays (1s, 2s, 4s)
- **AND** the job attempt counter is incremented
- **AND** the job is not marked as permanently failed until max retries exceeded

#### Scenario: Permanent errors fail fast without retry
- **GIVEN** a job processing worker encounters an invalid entity error
- **WHEN** the error is classified as PERMANENT
- **THEN** the job is immediately marked as failed
- **AND** no retry is attempted
- **AND** the error is logged with full context (entity name, error type, operation)

#### Scenario: Critical errors halt job processing
- **GIVEN** a job processing worker encounters a database corruption error
- **WHEN** the error is classified as CRITICAL
- **THEN** the worker stops processing additional jobs
- **AND** an error is logged with severity CRITICAL
- **AND** the system requires manual intervention to resume

### Requirement: Job Timeout and Heartbeat
Jobs MUST have configurable timeout and heartbeat mechanisms to prevent indefinite lock holding.

#### Scenario: Job timeout releases lock for crashed workers
- **GIVEN** a worker leases a job with lock duration 5 minutes
- **AND** the worker crashes without completing the job
- **WHEN** 5 minutes elapse without heartbeat
- **THEN** the job lock expires automatically
- **AND** another worker can lease and process the job
- **AND** the job is not counted as failed (allows retry)

#### Scenario: Long-running job extends lock via heartbeat
- **GIVEN** a worker is processing a job that takes longer than lock duration
- **WHEN** the worker sends heartbeat signals every 2 minutes
- **THEN** the job lock is extended for another 5 minutes
- **AND** the job remains owned by the current worker
- **AND** other workers cannot lease the job

#### Scenario: Worker fails to heartbeat within interval
- **GIVEN** a worker has leased jobs but stops responding
- **WHEN** no heartbeat is received within 3x the heartbeat interval
- **THEN** the system logs a warning about potential worker failure
- **AND** jobs remain locked until timeout expires
- **AND** subsequent processing attempts detect the stale lease

### Requirement: Job Processing Health Monitoring
The job processing system MUST track health metrics and detect degraded states.

#### Scenario: Consecutive failures trigger health warning
- **GIVEN** a job processing worker is running
- **WHEN** 5 consecutive jobs fail with errors
- **THEN** the system logs a health degradation warning
- **AND** the health status is set to DEGRADED
- **AND** the consecutive failure count is included in logs

#### Scenario: Successful job resets consecutive failure counter
- **GIVEN** the worker has 3 consecutive failures
- **WHEN** a job completes successfully
- **THEN** the consecutive failure counter resets to 0
- **AND** the health status returns to HEALTHY
- **AND** a recovery log entry is written

#### Scenario: Health status queryable for monitoring
- **GIVEN** a job processing worker has health metrics
- **WHEN** `getHealthStatus()` is called
- **THEN** it returns current health state: HEALTHY, DEGRADED, or CRITICAL
- **AND** includes metrics: consecutive failures, success rate, last success timestamp
- **AND** returns error patterns if health is degraded

### Requirement: Structured Error Logging with Context
All error logs MUST include structured context to enable root cause analysis.

#### Scenario: Job processing error logs include full context
- **GIVEN** a job fails during processing
- **WHEN** the error is logged
- **THEN** the log entry includes:
  - jobId
  - entityName
  - errorType (TRANSIENT, PERMANENT, CRITICAL)
  - attempt number and max attempts
  - error message and stack trace
  - timestamp and worker ID
- **AND** logs are structured JSON for aggregation tools

#### Scenario: Error context includes operation state
- **GIVEN** an error occurs during entity embedding generation
- **WHEN** the error is logged
- **THEN** the log includes operation-specific context:
  - Current entity observations
  - Embedding model being used
  - Rate limiter state
  - Cache hit/miss status
- **AND** helps diagnose whether error is data-related or infrastructure-related

## MODIFIED Requirements

### Requirement: Job Lifecycle Management
Jobs MUST support complete lifecycle management including cleanup, retry operations, and error recovery with environment-driven retention of terminal states.

#### Scenario: TTL cleanup via APOC
- **GIVEN** `EMBED_JOB_RETENTION_DAYS` is set (default 14, allowed 7-30)
- **WHEN** the scheduled cleanup runs using an APOC query
- **THEN** jobs in `status: 'completed'` or `status: 'failed'` older than the configured number of days are deleted
- **AND** pending or processing jobs remain untouched.

#### Scenario: Retention configuration validated
- **GIVEN** `EMBED_JOB_RETENTION_DAYS` is missing or outside 7-30
- **WHEN** the embedding worker boots
- **THEN** it fails fast with a configuration error so we do not silently retain logs forever or delete them too aggressively.

#### Scenario: Failed jobs track error classification
- **GIVEN** a job fails during processing
- **WHEN** the job is marked as failed in the database
- **THEN** the job record includes:
  - Error category (TRANSIENT, PERMANENT, CRITICAL)
  - Error message
  - Stack trace
  - Attempt count at time of failure
- **AND** allows operators to distinguish retriable vs permanent failures

#### Scenario: Retry policy respects max attempts
- **GIVEN** a job has failed 2 times with TRANSIENT errors
- **AND** max attempts is configured to 3
- **WHEN** the job fails a third time
- **THEN** the job is marked as permanently failed
- **AND** no further retries are attempted
- **AND** the job is eligible for cleanup after retention period

### Requirement: Rate Limiting and Resource Management
Embedding API calls MUST be rate-limited to prevent abuse and respect provider limits. Rate limiting MUST NOT prevent error recovery.

#### Scenario: Rate limit enforcement
- **GIVEN** a worker is processing jobs
- **WHEN** rate limit tokens are exhausted
- **THEN** job processing pauses until tokens are replenished
- **AND** remaining leased jobs maintain their locks via heartbeat for later completion.

#### Scenario: Rate limit does not interfere with retry
- **GIVEN** a job fails with TRANSIENT error and needs retry
- **WHEN** the retry is scheduled after backoff delay
- **THEN** the retry respects rate limiting
- **AND** waits for available tokens before making API call
- **AND** retry backoff timer is separate from rate limit timer

## Implementation Notes

### Error Classification Logic

```typescript
enum ErrorCategory {
  TRANSIENT = 'transient',   // Network errors, timeouts, rate limits
  PERMANENT = 'permanent',   // Validation errors, missing data
  CRITICAL = 'critical'      // Database errors, corruption
}

function classifyError(error: unknown): ErrorCategory {
  if (error instanceof NetworkTimeoutError) return ErrorCategory.TRANSIENT;
  if (error instanceof RateLimitError) return ErrorCategory.TRANSIENT;
  if (error instanceof ValidationError) return ErrorCategory.PERMANENT;
  if (error instanceof EntityNotFoundError) return ErrorCategory.PERMANENT;
  if (error instanceof DatabaseError) return ErrorCategory.CRITICAL;

  // Conservative default: treat unknown as permanent to avoid infinite retry
  return ErrorCategory.PERMANENT;
}
```

### Retry Policy Configuration

```typescript
interface RetryPolicy {
  maxRetries: number;          // Default: 3
  baseDelayMs: number;         // Default: 1000 (1 second)
  maxDelayMs: number;          // Default: 60000 (1 minute)
  backoffMultiplier: number;   // Default: 2 (exponential)
  jitterFactor: number;        // Default: 0.1 (10% jitter)
}

function calculateRetryDelay(attempt: number, policy: RetryPolicy): number {
  const exponentialDelay = policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, policy.maxDelayMs);
  const jitter = cappedDelay * policy.jitterFactor * (Math.random() - 0.5);
  return Math.round(cappedDelay + jitter);
}
```

### Health Monitoring Thresholds

```typescript
interface HealthStatus {
  state: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  consecutiveFailures: number;
  successRate: number;         // Last 100 jobs
  lastSuccessTimestamp: number;
  errorPatterns: Record<ErrorCategory, number>;
}

const HEALTH_THRESHOLDS = {
  consecutiveFailuresForDegraded: 5,
  consecutiveFailuresForCritical: 10,
  successRateForDegraded: 0.5,  // 50%
};
```

### Affected Methods
- `Neo4jEmbeddingJobManager.processJobs()` - Add error classification and retry logic
- `Neo4jEmbeddingJobManager._checkRateLimiter()` - Coordinate with retry backoff
- `src/index.ts` scheduled job loops - Apply error recovery
- NEW: `src/utils/errors.ts` - Error classification utilities
- NEW: `Neo4jEmbeddingJobManager.getHealthStatus()` - Health monitoring

### Environment Variables
- `EMBED_JOB_MAX_RETRIES` - Maximum retry attempts (default: 3)
- `EMBED_JOB_RETRY_BASE_DELAY_MS` - Base delay for exponential backoff (default: 1000)
- `EMBED_JOB_LOCK_DURATION_MS` - Job lease duration (default: 300000 = 5 minutes)
- `EMBED_JOB_HEARTBEAT_INTERVAL_MS` - Heartbeat frequency (default: 120000 = 2 minutes)
