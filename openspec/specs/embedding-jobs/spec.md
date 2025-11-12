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
Embedding API calls MUST be rate-limited to prevent abuse and respect provider limits.

#### Scenario: Rate limit enforcement
- **GIVEN** a worker is processing jobs
- **WHEN** rate limit tokens are exhausted
- **THEN** job processing pauses until tokens are replenished
- **AND** remaining leased jobs maintain their locks for later completion.

### Requirement: Job Lifecycle Management
Jobs MUST support complete lifecycle management including cleanup and retry operations with environment-driven retention of terminal states.

#### Scenario: TTL cleanup via APOC
- **GIVEN** `EMBED_JOB_RETENTION_DAYS` is set (default 14, allowed 7-30)
- **WHEN** the scheduled cleanup runs using an APOC query
- **THEN** jobs in `status: 'completed'` or `status: 'failed'` older than the configured number of days are deleted
- **AND** pending or processing jobs remain untouched.

#### Scenario: Retention configuration validated
- **GIVEN** `EMBED_JOB_RETENTION_DAYS` is missing or outside 7-30
- **WHEN** the embedding worker boots
- **THEN** it fails fast with a configuration error so we do not silently retain logs forever or delete them too aggressively.

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
