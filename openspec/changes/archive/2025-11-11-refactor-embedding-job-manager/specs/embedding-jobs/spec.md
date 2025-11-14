## ADDED Requirements

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
