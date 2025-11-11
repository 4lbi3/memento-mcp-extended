# Changelog

All notable changes to Memento MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
