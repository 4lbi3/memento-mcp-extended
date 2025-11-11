# Embedding Jobs Capability

## Overview
The embedding jobs capability provides durable, asynchronous processing of vector embeddings for entities in the knowledge graph. Jobs are persisted in Neo4j and processed by background workers with lease-based locking, retry logic, and rate limiting.

## Requirements

### Requirement: Durable Embedding Job Queue
Embedding generation MUST be orchestrated through a Neo4j-backed queue so that work persists across process restarts and supports retries.

#### Scenario: Job enqueued on entity mutation
- **GIVEN** an entity is created or its observations change
- **WHEN** the write is acknowledged
- **THEN** a corresponding job node `(:EmbedJob {entity_uid, status: 'pending'})` exists in Neo4j
- **AND** duplicate jobs for the same entity version are avoided via idempotent keys.

#### Scenario: Worker leases and completes jobs
- **GIVEN** pending jobs exist
- **WHEN** a worker calls `processJobs`
- **THEN** jobs transition to `status: 'processing'` with `lock_owner` and `lock_until`
- **AND** upon successful embedding they transition to `status: 'completed'` with `processed_at` set.

#### Scenario: Lease expiry triggers retry
- **GIVEN** a job is `processing` but `lock_until` has passed
- **WHEN** another worker leases jobs
- **THEN** the expired job becomes available again and its `attempts` counter increments
- **AND** after `max_attempts` it transitions to `status: 'failed'` with the last error stored.

### Requirement: Rate Limiting and Resource Management
Embedding API calls MUST be rate-limited to prevent abuse and respect provider limits.

#### Scenario: Rate limit enforcement
- **GIVEN** a worker is processing jobs
- **WHEN** rate limit tokens are exhausted
- **THEN** job processing pauses until tokens are replenished
- **AND** remaining leased jobs maintain their locks for later completion.

### Requirement: Job Lifecycle Management
Jobs MUST support complete lifecycle management including cleanup and retry operations.

#### Scenario: Failed job retry
- **GIVEN** jobs exist with `status: 'failed'`
- **WHEN** `retryFailedJobs` is called
- **THEN** failed jobs reset to `status: 'pending'` with cleared error state
- **AND** attempt counters reset to allow reprocessing.

#### Scenario: Job cleanup
- **GIVEN** completed jobs exist older than the retention threshold
- **WHEN** `cleanupJobs` is called
- **THEN** old completed jobs are permanently deleted from Neo4j
- **AND** failed jobs are preserved for manual inspection.

## Design Decisions

### Neo4j Schema
- `:EmbedJob` nodes with properties: `id`, `entity_uid`, `model`, `version`, `status`, `priority`, `created_at`, `processed_at`, `lock_owner`, `lock_until`, `error`, `attempts`, `max_attempts`
- Uniqueness constraint on `(entity_uid, model, version)` prevents duplicate jobs
- Indexes on `status` for efficient querying and `lock_until` for lease expiry detection

### Lease-Based Processing
- Jobs are leased with owner/timestamp to prevent duplicate processing
- Lock duration defaults to 5 minutes with heartbeat support
- Expired leases automatically make jobs available for retry

### Retry Logic
- Failed jobs increment attempt counter
- Jobs marked permanently failed after `max_attempts` (default: 3)
- Failed jobs can be manually reset for retry

## Deployment Requirements

### Schema Initialization
Run Neo4j schema setup before deploying:
```bash
# Initialize Neo4j schema including embedding job constraints
npx neo4j-cli init --uri bolt://localhost:7687 --username neo4j --password your_password
```

### Environment Variables
- `EMBEDDING_RATE_LIMIT_TOKENS`: Maximum embedding requests per interval (default: 20)
- `EMBEDDING_RATE_LIMIT_INTERVAL`: Rate limit interval in milliseconds (default: 60000)
- `OPENAI_API_KEY`: Required for embedding generation (falls back to mock embeddings if missing)

### Monitoring
- Queue status available via `getQueueStatus()` method
- Job processing metrics logged with worker identification
- Failed jobs preserved for debugging and manual retry

## Operational Procedures

### Starting Workers
Multiple worker processes can run simultaneously:
```typescript
// Workers automatically coordinate via lease-based locking
const worker = new Neo4jEmbeddingJobManager(storageProvider, embeddingService, jobStore);
setInterval(() => worker.processJobs(10), 10000); // Process every 10 seconds
```

### Queue Maintenance
Periodic cleanup prevents unbounded growth:
```typescript
// Clean up completed jobs older than 7 days
await jobManager.cleanupJobs(7 * 24 * 60 * 60 * 1000);
```

### Troubleshooting
- Check queue status for stuck jobs: `jobStore.getQueueStatus()`
- Reset failed jobs: `jobStore.retryFailedJobs()`
- Monitor worker logs for processing errors and rate limit hits
