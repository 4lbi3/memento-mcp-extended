## ADDED Requirements

### Requirement: Stale Job Recovery
The job processing system MUST automatically recover jobs that are stuck in `processing` status with expired locks, preventing permanent queue freeze from worker failures.

#### Scenario: Expired processing jobs reset to pending
- **GIVEN** a job is in `processing` status with `lock_until` timestamp in the past
- **WHEN** the stale job recovery mechanism runs
- **THEN** the job is reset to `pending` status
- **AND** the `lock_owner` and `lock_until` fields are cleared
- **AND** the job becomes available for leasing by any worker
- **AND** the attempt counter is not reset (preserves failure tracking)

#### Scenario: Active jobs not recovered prematurely
- **GIVEN** a job is in `processing` status with valid lock (lock_until > current time)
- **WHEN** the stale job recovery mechanism runs
- **THEN** the job remains in `processing` status
- **AND** the lock is not cleared
- **AND** the job is not available for leasing

#### Scenario: Background recovery runs periodically
- **GIVEN** the embedding job manager is running
- **WHEN** the configured recovery interval elapses (default: 60 seconds)
- **THEN** the stale job recovery process executes
- **AND** logs the number of jobs recovered
- **AND** schedules the next recovery run

#### Scenario: Recovery on worker startup
- **GIVEN** a worker is starting up
- **WHEN** the worker initializes
- **THEN** it immediately runs stale job recovery once
- **AND** ensures any jobs from previous crashed workers are recovered
- **AND** then begins normal periodic recovery

### Requirement: Explicit Job Lease Release
The job processing system MUST provide a mechanism to explicitly release job leases back to pending status when processing cannot continue.

#### Scenario: Batch release of unleased jobs
- **GIVEN** a worker has leased 10 jobs but only processed 3
- **WHEN** the worker calls `releaseJobs()` with the IDs of the 7 unprocessed jobs
- **THEN** all 7 jobs are reset to `pending` status
- **AND** their `lock_owner` and `lock_until` fields are cleared
- **AND** the jobs become immediately available for other workers
- **AND** only jobs owned by the calling worker are released

#### Scenario: Release ignores jobs not owned by caller
- **GIVEN** worker A has leased jobs [1, 2, 3]
- **AND** worker B has leased jobs [4, 5, 6]
- **WHEN** worker A calls `releaseJobs([2, 3, 5])`
- **THEN** jobs 2 and 3 are released (owned by A)
- **AND** job 5 is NOT released (owned by B)
- **AND** the method returns count of successfully released jobs (2)

#### Scenario: Empty release is safe no-op
- **GIVEN** a worker calls `releaseJobs([])`
- **THEN** no database query is executed
- **AND** the method returns 0
- **AND** no errors are thrown

## MODIFIED Requirements

### Requirement: Rate Limiting and Resource Management
Embedding API calls MUST be rate-limited to prevent abuse and respect provider limits. Rate limiting MUST NOT prevent error recovery or cause job abandonment.

#### Scenario: Rate limit enforcement with job release
- **GIVEN** a worker has leased 10 jobs
- **AND** rate limit tokens are exhausted after processing 3 jobs
- **WHEN** the rate limiter blocks further processing
- **THEN** the worker releases the 7 unprocessed jobs back to pending
- **AND** the 3 processed jobs complete normally (success or failure)
- **AND** released jobs become immediately available for other workers or future runs

#### Scenario: Rate limit does not interfere with retry
- **GIVEN** a job fails with TRANSIENT error and needs retry
- **WHEN** the retry is scheduled after backoff delay
- **THEN** the retry respects rate limiting
- **AND** waits for available tokens before making API call
- **AND** retry backoff timer is separate from rate limit timer

#### Scenario: Heartbeat maintains locks during rate limit pause
- **GIVEN** a worker is processing jobs
- **WHEN** rate limit pause occurs mid-batch
- **THEN** jobs that are actively being processed maintain their locks via heartbeat
- **AND** jobs that were not started are released immediately
- **AND** heartbeat continues for active jobs until completion

### Requirement: Job Lifecycle Management
Jobs MUST support complete lifecycle management including cleanup, retry operations, stale job recovery, and error recovery with environment-driven retention of terminal states.

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

#### Scenario: Stale job recovery prevents permanent freeze
- **GIVEN** a worker crashes while processing jobs
- **WHEN** the job lock expires without heartbeat
- **THEN** the background recovery process detects the stale job
- **AND** resets it to `pending` status
- **AND** the job can be reprocessed by another worker
- **AND** the system does not require manual intervention

### Requirement: Job Timeout and Heartbeat
Jobs MUST have configurable timeout and heartbeat mechanisms to prevent indefinite lock holding and enable automatic recovery of abandoned jobs.

#### Scenario: Job timeout releases lock for crashed workers
- **GIVEN** a worker leases a job with lock duration 5 minutes
- **AND** the worker crashes without completing the job
- **WHEN** 5 minutes elapse without heartbeat
- **THEN** the job lock expires automatically
- **AND** the stale job recovery process resets the job to pending
- **AND** another worker can lease and process the job
- **AND** the job is not counted as failed (allows retry)

#### Scenario: Long-running job extends lock via heartbeat
- **GIVEN** a worker is processing a job that takes longer than lock duration
- **WHEN** the worker sends heartbeat signals every 2 minutes
- **THEN** the job lock is extended for another 5 minutes
- **AND** the job remains owned by the current worker
- **AND** other workers cannot lease the job
- **AND** stale job recovery does not interfere with active processing

#### Scenario: Worker fails to heartbeat within interval
- **GIVEN** a worker has leased jobs but stops responding
- **WHEN** no heartbeat is received and lock expires
- **THEN** the stale job recovery detects expired locks
- **AND** resets jobs to pending status
- **AND** logs recovery events for monitoring
