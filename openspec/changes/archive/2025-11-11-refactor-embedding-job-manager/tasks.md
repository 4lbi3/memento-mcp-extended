# Tasks

## 1. Schema & Store
- [x] 1.1 Add Neo4j constraints/indexes for `:EmbedJob` via schema manager/init scripts.
- [x] 1.2 Implement `Neo4jJobStore` with enqueue/lease/heartbeat/complete/fail operations and tests.

## 2. EmbeddingJobManager Refactor
- [x] 2.1 Remove fake `db` adapter from bootstrap and inject the new job store.
- [x] 2.2 Update `EmbeddingJobManager` to use the store (lease ownership, heartbeat, retry logging).
- [x] 2.3 Ensure entity/observation flows enqueue jobs through the new API.

## 3. Validation & Docs
- [x] 3.1 Add/extend Vitest coverage for queue processing.
- [x] 3.2 Document deployment steps (schema commands, env vars) and update OpenSpec specs.
- [x] 3.3 Run `openspec validate refactor-embedding-job-manager --strict`.
