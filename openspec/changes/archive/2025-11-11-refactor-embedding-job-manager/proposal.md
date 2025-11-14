# Proposal: Refactor Embedding Job Manager

## Summary

Implement a first-class embedding job queue inside Neo4j so the EmbeddingJobManager stops relying on the fake SQLite adapter and can actually persist, lease, and retry jobs. This enables safe asynchronous embedding generation, reduces lock contention, and sets up future scaling across workers.

## Motivation

- Current EmbeddingJobManager never stores jobs because the storage provider exposes a no-op `db`, so scheduling silently fails.
- Embeddings are generated inline inside Neo4j transactions, holding locks while waiting for OpenAI calls.
- Without durable jobs, we cannot throttle, retry, or inspect queue health, making semantic search unreliable.

## Goals

1. Add a Neo4j-backed queue schema (`:EmbedJob` nodes + constraints/indexes) with lease-based processing and retries.
2. Introduce a `Neo4jJobStore` abstraction that encapsulates enqueue/lease/heartbeat/complete/fail Cypher operations.
3. Update `EmbeddingJobManager` bootstrap so it no longer depends on `storageProvider.db` and instead uses the new store.
4. Ensure MCP flows (entity/observation mutations) enqueue embedding work and that background workers process jobs safely.

## Non-Goals

- Changing existing MCP tool surfaces beyond queue wiring.
- Replacing the current embedding service providers (OpenAI/mocks).
- Large-scale performance tuning beyond what the queue enables.

## Approach

1. Define Neo4j schema additions and add them to the setup tooling (schema manager or init script).
2. Implement `Neo4jJobStore` with atomic Cypher queries for enqueueing and leasing batches with lock expiry.
3. Refactor `EmbeddingJobManager` to depend on the store (lease heartbeat, retry handling, logging) and remove the fake DB adapter from `src/index.ts`.
4. Ensure entity/observation flows enqueue jobs (dedupe per entity/version/model when possible).
5. Add Vitest coverage for the store (using the connection manager test doubles) and for the manager's processing loop.
6. Extend docs/OpenSpec specs to describe the durable queue behavior and operational requirements.

## Risks & Mitigations

- **Schema conflicts**: run schema creation idempotently with `IF NOT EXISTS` and document required Neo4j version.
- **Concurrent workers**: leases include owner + expiry; add heartbeat to reclaim stuck jobs.
- **Backward compatibility**: keep synchronous embedding generation behind a flag so rollout can be gradual if needed.

## Validation

- Unit tests for `Neo4jJobStore` queries, including lease expiration and retry.
- Integration test that creates entities, enqueues jobs, runs `processJobs`, and verifies embeddings recorded.
- Manual `openspec validate refactor-embedding-job-manager --strict` before requesting approval.
