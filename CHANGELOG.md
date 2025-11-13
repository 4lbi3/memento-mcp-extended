# Changelog

All notable changes to Memento MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.9.11] - 2025-11-13

### Changed
- **TypeScript Type Safety Improvements:** Eliminated unsafe `any` type usage for `knowledgeGraphManager` parameter across the MCP server layer
  - Replaced `any` with proper `KnowledgeGraphManager` type in `setup.ts`, `callToolHandler.ts`, and all 5 tool handler files
  - Added type imports and type assertions for function parameters (e.g., `args.entities as Entity[]`, `args.relations as Relation[]`)
  - Diagnostic tools (`force_generate_embedding`, `debug_embedding_config`, `get_entity_embedding`, `diagnose_vector_search`) use documented `as any` assertions only where accessing private internals
  - Enables full IDE autocomplete and compile-time type checking for all `KnowledgeGraphManager` method calls
  - Prevents runtime errors from typos in method names or incorrect parameter types
  - No breaking changes - all existing functionality preserved, TypeScript compilation passes without errors

## [0.3.9.10] - 2025-11-13

### Changed
- **Code Refactoring:** Eliminated code duplication in vector search logic between `semanticSearch` and `findSimilarEntities`
  - `semanticSearch` now delegates the core vector search operations to `findSimilarEntities` instead of duplicating the query logic
  - Removed ~120 lines of duplicate vector search code (lines 2089-2209) from `semanticSearch`
  - Both methods now share a single, centralized implementation of the Neo4j vector query and batch entity retrieval
  - Maintains all existing functionality: diagnostics tracking, filtering, relation loading, and text search fallback
  - Reduces maintenance burden and prevents future regression of the N+1 query fix (from version 0.3.9.5)
  - No breaking changes - all existing tests pass without modification

## [0.3.9.9] - 2025-11-13

### Fixed
- **Entity Embedding Retrieval:** Fixed `nodeToEntity` method to properly include embedding data when converting Neo4j nodes to Entity objects
  - Embeddings are now correctly returned by `loadGraph()`, `searchNodes()`, `openNodes()`, `getEntity()`, `getEntityHistory()`, and `findSimilarEntities()`
  - When an entity has an embedding stored in Neo4j, it's now properly converted to the `EntityEmbedding` format with `vector`, `model`, and `lastUpdated` fields
  - For newly created entities (without embeddings yet), the field correctly remains `undefined`
  - Improves debugging and enables future logic that depends on checking embedding presence
  - No breaking changes - backward compatible as `embedding` was already declared optional in the `Entity` interface

## [0.3.9.8] - 2025-11-12

### Changed
- `KnowledgeGraphManager.createEntities` now delegates deduplication entirely to the storage provider, avoiding `loadGraph()` and in-memory entity maps.
- `Neo4jStorageProvider.createEntities` implements an indexed upsert workflow with temporal versioning merges, emitting debug logs for create/merge/skip paths.

### Performance
- Resolved the O(n) memory spike during entity creation by moving deduplication to Neo4j; memory usage remains constant regardless of existing graph size.
- Added `scripts/benchmark-create-entities.ts` to measure end-to-end performance. On a local Neo4j instance, two sequential batches of 10,000 entities completed in **5.41s** and **4.55s** respectively with RSS deltas of **+126 MB** and **-29 MB**, confirming flat memory utilisation across batches.

### Fixed
- Covered the new upsert semantics with unit tests in `Neo4jTemporalIntegrity.test.ts`, ensuring new entity, merge, and idempotent scenarios all respect `_createNewEntityVersion` contracts.

## [0.3.9.7] - 2025-11-12

### Fixed
- **Critical:** Fixed embedding generation failure after entity versioning
  - `Neo4jVectorStore.addVector` now includes `validTo: NULL` filter to match only current entity versions
  - `Neo4jVectorStore.removeVector` now includes `validTo: NULL` filter for consistency
  - Metadata update operations now correctly target current entity versions only
  - Prevents ambiguous MERGE failures when archived entity versions exist
  - Ensures embeddings are properly stored on the latest entity version after `addObservations` or `deleteObservations`
  - All embedding job operations now work correctly with the temporal versioning system

## [0.3.9.6] - 2025-11-12

### Performance
- **Critical Performance Improvement:** Decoupled embedding generation from database transactions in entity creation
  - Entity creation time reduced by **200x** (from ~2-5 seconds per entity to ~10ms)
  - Database transaction duration reduced from O(n × 2s) to O(n × 10ms) where n = number of entities
  - Eliminated transaction timeouts when creating 20+ entities (was >60s, now <200ms for 20 entities)
  - Removed duplicate embedding generation (was done synchronously in storage provider AND asynchronously via job queue)
  - Embeddings are now eventually consistent via the existing job queue infrastructure
  - No breaking changes to public APIs - transparent performance optimization

## [0.3.9.5] - 2025-11-12

### Fixed
- Eliminated the N+1 lookup pattern in `Neo4jStorageProvider` by batching `findSimilarEntities` and `semanticSearch` entity fetches; both paths now run with two queries regardless of result count, delivering ~10-100× faster response times without changing any public API.

## [0.3.9.4] - 2025-11-12

### Fixed
- **Critical:** Fixed temporal relationship integrity issues in Neo4j storage provider
  - `deleteObservations` now preserves all relationships through entity versioning
  - All relationship creation operations validate entity temporal state (`validTo IS NULL`)
  - Prevents creation of phantom relationships to archived entity versions
  - Fixes relationship graph corruption that caused exponential relationship proliferation
  - Refactored ~100 lines of duplicated versioning logic into shared `_createNewEntityVersion` method
  - Added dedicated Neo4j temporal integrity tests that assert relationship recreation, metadata preservation, logging, and validation across all versioning paths

## [0.3.9.3] - 2025-11-11

### Added
- Automatic provisioning for the dedicated `embedding-jobs` Neo4j database, including creation of the queue constraints/indexes when the configured user has admin rights.
- Startup validation now blocks until the job database exists and is online, preventing workers from running without the required datastore.
- Unit coverage for the new job database initializer to ensure the creation/wait logic keeps working.

### Changed
- `DEFAULT_NEO4J_CONFIG` now honors `NEO4J_URI` for the primary and job databases, so custom Bolt ports are respected everywhere (CLI, workers, and bootstrapper).
- README/environment samples (including the Claude Desktop MCP snippet) explicitly require `EMBED_JOB_RETENTION_DAYS`, matching the fail-fast runtime validation.
- OpenSpec change `update-embedding-log-storage` has been archived and merged into the canonical `embedding-jobs` spec.

### Fixed
- Workers no longer fail on first boot when the job database is missing; the bootstrapper creates it via the `system` database and waits until it reaches `ONLINE`.

## [0.3.9.2] - 2025-11-11

### Added
- Neo4j-backed embedding job queue is now documented in the README, including Cypher snippets to inspect, clean up, or purge `:EmbedJob` nodes.
- OpenSpec change `refactor-embedding-job-manager` archived after successful validation.

### Changed
- Embedding jobs now store per-entity version IDs, so each entity version automatically receives a fresh embedding.
- Queue Cypher queries force integer parameters (`toInteger(...)`) to avoid `10.0` vs `10` issues when leasing jobs.
- Default job creation initializes all diagnostic fields (`lock_owner`, `lock_until`, `error`, `processed_at`) so Cypher queries can safely access them.
- `EmbeddingJobManager` now reads the real entity `version` from Neo4j and schedules an idempotent job per version.
- Knowledge graph `Entity` interface now exposes the optional `version` field returned by Neo4j.

### Fixed
- Background worker no longer crashes when leasing jobs in environments that serialize numbers as floats.
- Jobs scheduled after observation updates now actually enqueue (the previous logic hard-coded version `1` and skipped new versions).
- Documentation explains how to monitor and clean the job queue, preventing confusion about “stuck” `:EmbedJob` nodes.

## [0.3.9.1] - 2025-11-11

### Added
- Introduced `env.example` with the minimal OpenAI and Neo4j variables so local setups and CI share the same defaults.
- Documented the current architecture and configuration expectations in `docs/detailed-project-analysis.md`.
- Enabled the full Vitest suite by reworking the previously skipped Neo4j integration specs so they now run with environment-driven configuration.
- Updated `README.md` with fork context and a guided environment-setup workflow based on the new `.env` file.

### Changed
- Neo4j configuration now derives the Bolt port, username, and password from the environment everywhere (`src/config/storage.ts`, `src/storage/neo4j/Neo4jConfig.ts`, and all related tests), eliminating hard-coded credentials.
- Vitest loads `.env` automatically (`vitest.config.ts`), ensuring unit and integration tests respect the same connection settings as the application.
- Updated `docker-compose.yml` to forward `NEO4J_*` values for auth and port mappings so containers run with the same credentials and ports used by the tests and CLI utilities.

### Removed
- Dropped the outdated `example.env` in favor of the new `env.example` template.

## [0.3.9] - 2025-05-08

### Changed

- Updated dependencies to latest versions:
  - @modelcontextprotocol/sdk from 1.8.0 to 1.11.0
  - axios from 1.8.4 to 1.9.0
  - dotenv from 16.4.7 to 16.5.0
  - eslint from 9.23.0 to 9.26.0
  - eslint-config-prettier from 10.1.1 to 10.1.3
  - glob from 11.0.1 to 11.0.2
  - openai from 4.91.1 to 4.97.0
  - tsx from 4.19.3 to 4.19.4
  - typescript from 5.8.2 to 5.8.3
  - vitest and @vitest/coverage-v8 from 3.1.1 to 3.1.3
  - zod from 3.24.2 to 3.24.4
  - @typescript-eslint/eslint-plugin and @typescript-eslint/parser from 8.29.0 to 8.32.0

## [0.3.8] - 2025-04-01

### Added

- Initial public release
- Knowledge graph memory system with entities and relations
- Neo4j storage backend with unified graph and vector storage
- Semantic search using OpenAI embeddings
- Temporal awareness with version history for all graph elements
- Time-based confidence decay for relations
- Rich metadata support for entities and relations
- MCP tools for entity and relation management
- Support for Claude Desktop, Cursor, and other MCP-compatible clients
- Docker support for Neo4j setup
- CLI utilities for database management
- Comprehensive documentation and examples

### Changed

- Migrated storage from SQLite + Chroma to unified Neo4j backend
- Enhanced vector search capabilities with Neo4j's native vector indexing
- Improved performance for large knowledge graphs

## [0.3.0] - [Unreleased]

### Added

- Initial beta version with Neo4j support
- Vector search integration
- Basic MCP server functionality

## [0.2.0] - [Unreleased]

### Added

- SQLite and Chroma storage backends
- Core knowledge graph data structures
- Basic entity and relation management

## [0.1.0] - [Unreleased]

### Added

- Project initialization
- Basic MCP server framework
- Core interfaces and types
