## MODIFIED Requirements
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
