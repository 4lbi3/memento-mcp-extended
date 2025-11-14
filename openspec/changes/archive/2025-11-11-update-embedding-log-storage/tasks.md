## Implementation

- [x] Wire the embedding job manager to read a dedicated Neo4j connection string/credentials for job data and document the deployment requirement.
- [x] Introduce `EMBED_JOB_RETENTION_DAYS` (default 14, range 7-30) with validation at startup and expose it to infrastructure.
- [x] Implement an APOC-driven cleanup routine that purges `completed`/`failed` jobs older than the retention window and emit metrics/logs for each run.
