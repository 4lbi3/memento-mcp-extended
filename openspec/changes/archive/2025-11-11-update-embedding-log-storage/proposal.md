## Why
- Embedding job nodes produce high churn that competes with the knowledge graph for I/O and cache, degrading traversal/search performance.
- Operational work (backups, restores) on the knowledge graph should exclude volatile embedding job data so we can discard/recreate it without risking real entities.
- Monitoring the job queue footprint is easier when it lives in a dedicated Neo4j database, making runaway queues obvious and isolated.
- Embedding job logs currently have no automated retention, so they accumulate indefinitely although they are only useful for a short debug/audit window.

## What Changes
- Provision and require a dedicated Neo4j database for `:EmbedJob` nodes separate from the main graph that stores `:Entity` data.
- Introduce configuration that makes the job database connection explicit (URI, auth) and keeps operational tasks—backup, maintenance, monitoring—isolated.
- Define an environment-controlled retention window (default 14 days, allowed 7-30) for terminal jobs and enforce cleanup via APOC-driven TTL queries.
- Expose a scheduled cleanup mechanism that deletes `completed` and `failed` jobs older than the retention window while keeping in-flight jobs untouched.

## Impact
- Deployment must create and manage a second Neo4j database and grant workers credentials for both stores.
- Observability dashboards and alerts should track the dedicated queue database separately (disk usage, node counts, APOC cleanup success).
- Runtime configuration now includes retention knobs; misconfiguration outside 7-30 days should be rejected at startup to avoid silent data hoarding or premature deletion.
