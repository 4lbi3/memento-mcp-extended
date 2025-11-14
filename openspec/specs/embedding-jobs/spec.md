# Embedding Jobs Capability

## Purpose
The embedding jobs capability provides durable, asynchronous processing of vector embeddings for entities in the knowledge graph. Jobs are persisted in Neo4j and processed by background workers with lease-based locking, retry logic, and rate limiting.
## Requirements
### Requirement: Durable Embedding Job Queue
Embedding jobs MUST be persisted in a Neo4j database that is dedicated to the queue and isolated from the knowledge graph storing `:Entity` data.

#### Scenario: Queue isolation protects graph performance
- **GIVEN** the embedding job manager is initialized
- **WHEN** it stores or leases `:EmbedJob` nodes
- **THEN** all operations target the dedicated "embedding-jobs" Neo4j database using its own URI/credentials
- **AND** no job nodes are created in the primary knowledge graph so traversal/read workloads remain unaffected by queue churn.

#### Scenario: Independent maintenance and recovery
- **GIVEN** the dedicated job database experiences failure or requires maintenance
- **WHEN** operators rebuild it from scratch
- **THEN** the knowledge graph remains intact and only pending embedding jobs are lost
- **AND** backups for the primary graph can exclude transient queue data.

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

### Requirement: Entity Creation Integration
The storage provider MUST NOT generate embeddings synchronously during entity creation transactions. All embedding generation SHALL be delegated to the asynchronous job queue.

#### Scenario: Entity created without blocking on embeddings
- **GIVEN** a storage provider receives a request to create entities
- **WHEN** the `createEntities` method executes
- **THEN** entities are persisted in the database without embeddings
- **AND** the database transaction completes in milliseconds
- **AND** no network calls to embedding providers occur within the transaction
- **AND** the transaction does not hold locks while waiting for API responses

#### Scenario: Embedding jobs scheduled after entity creation
- **GIVEN** entities have been created in the database
- **WHEN** the `KnowledgeGraphManager.createEntities` method completes
- **THEN** embedding jobs are scheduled for each new entity
- **AND** the jobs are queued in the dedicated embedding job database
- **AND** background workers process the jobs asynchronously
- **AND** embeddings are added to entities when workers complete the jobs

#### Scenario: Fast transaction prevents lock contention
- **GIVEN** multiple concurrent requests to create entities
- **WHEN** transactions execute without synchronous embedding generation
- **THEN** each transaction completes in <100ms
- **AND** database locks are held only for fast local operations
- **AND** concurrent operations do not block each other
- **AND** transaction timeout errors do not occur even with 50+ entities

#### Scenario: No duplicate embedding generation
- **GIVEN** an entity is being created
- **WHEN** the storage provider completes the entity creation
- **THEN** exactly one embedding job is scheduled for the entity
- **AND** the embedding is generated exactly once by the job worker
- **AND** no synchronous embedding generation occurs during entity creation

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

### Requirement: Batch Embedding Repair Discovery
The storage provider MUST provide an efficient method to discover entities that lack embeddings, enabling operational maintenance and recovery from past failures.

#### Scenario: Query entities without embeddings
- **GIVEN** the knowledge graph contains entities with and without embeddings
- **WHEN** the storage provider's `getEntitiesWithoutEmbeddings(limit)` method is called
- **THEN** it returns only valid entities where `embedding IS NULL AND validTo IS NULL`
- **AND** the result set is limited to the specified `limit` parameter (default: 10)
- **AND** the query executes efficiently using Neo4j indexes

#### Scenario: Batch size control prevents overload
- **GIVEN** the graph contains 1000 entities without embeddings
- **WHEN** `getEntitiesWithoutEmbeddings(50)` is called
- **THEN** exactly 50 entities are returned
- **AND** the system does not attempt to load the entire graph
- **AND** memory usage remains bounded

#### Scenario: Only valid entities returned
- **GIVEN** the graph contains entities with `validTo` timestamps (soft-deleted)
- **WHEN** `getEntitiesWithoutEmbeddings(100)` is called
- **THEN** soft-deleted entities are excluded from results
- **AND** only entities with `validTo IS NULL` are returned

### Requirement: Force Embedding Tool Dual Mode Operation
The `force_generate_embedding` MCP tool MUST support two distinct operational modes: specific entity forcing and batch repair discovery.

#### Scenario: Mode 1 - Force specific entity embedding
- **GIVEN** an entity named "Alberto Rocco" exists in the graph
- **WHEN** the tool is called with `entity_name: "Alberto Rocco"`
- **THEN** the tool retrieves that specific entity via `getEntity("Alberto Rocco")`
- **AND** queues exactly one embedding job for that entity
- **AND** returns success message identifying the entity

#### Scenario: Mode 2 - Batch repair discovers missing embeddings
- **GIVEN** the tool is called without `entity_name` parameter
- **WHEN** `limit: 20` is provided
- **THEN** the tool calls `getEntitiesWithoutEmbeddings(20)`
- **AND** queues embedding jobs for all returned entities
- **AND** returns count of entities discovered and queued
- **AND** does not attempt to load the entire graph

#### Scenario: Default batch limit prevents accidents
- **GIVEN** the tool is called without `entity_name` and without `limit`
- **WHEN** the tool executes in batch repair mode
- **THEN** it defaults to `limit: 10`
- **AND** processes at most 10 entities
- **AND** prevents accidental system overload

#### Scenario: Mode detection based on parameters
- **GIVEN** the tool handler receives input parameters
- **WHEN** `entity_name` is present (even if `limit` is also present)
- **THEN** Mode 1 (specific force) is used
- **AND** `limit` parameter is ignored
- **WHEN** `entity_name` is absent
- **THEN** Mode 2 (batch repair) is used
- **AND** `limit` parameter controls batch size

#### Scenario: Safe entity discovery replaces unsafe openNodes
- **GIVEN** the tool needs to discover entities for batch repair
- **WHEN** Mode 2 executes
- **THEN** it calls the efficient `getEntitiesWithoutEmbeddings(limit)` method
- **AND** it does NOT call `knowledgeGraphManager.openNodes([])`
- **AND** the query is bounded by the limit parameter
- **AND** memory usage remains proportional to limit, not graph size

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
