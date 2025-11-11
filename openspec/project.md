# Project Context

## Purpose
Memento MCP is a Model Context Protocol (MCP) server that provides long-term memory for LLM clients.  
It stores entities, relations, and observations in a Neo4j knowledge graph, enriches them with vector embeddings, and exposes MCP tools for CRUD, search, and diagnostics.

## Tech Stack
- TypeScript + Node.js (ESM, `ts-node`/`tsx`)
- Neo4j 5.x as primary persistence and vector store
- OpenAI (or mock) embedding services
- Vitest + ESLint + Prettier for quality gates

## Project Conventions

### Code Style
- TypeScript strict-ish typing with ESLint (`typescript-eslint`) and Prettier auto-formatting.
- Prefer async/await, named exports, and dependency injection for testability.
- Logging via `src/utils/logger.ts`; avoid `console.*`.

### Architecture Patterns
- Core manager (`KnowledgeGraphManager`) orchestrates storage providers, embedding jobs, and MCP handlers.
- Storage providers implement `StorageProvider` interface; Neo4j provider is default and handles schema/versioning.
- Embedding generation decoupled via `EmbeddingJobManager` + `EmbeddingServiceFactory`.
- MCP server wires handlers in `src/server`.

### Testing Strategy
- Unit tests with Vitest (`npm test`), colocated under `__vitest__/`.
- Prefer test doubles over live Neo4j/OpenAI; integration tests guarded by `TEST_INTEGRATION`.
- When adding features, provide at least one Vitest covering success + error paths.

### Git Workflow
- Default branch `main`; feature branches named with kebab-case (e.g., `embedding-job-refactor`).
- Conventional commits not enforced, but descriptive messages expected.
- OpenSpec proposals must be approved before implementation of non-trivial changes.

## Domain Context
- Entities = typed nodes with observations and optional embeddings.
- Relations = `RELATES_TO` edges with strength/confidence, versioned via `validFrom/validTo`.
- Neo4j vector indexes power semantic search; embeddings often generated asynchronously.
- MCP clients (Claude, Cursor, etc.) consume tools like `create_entities`, `read_graph`, `force_generate_embedding`.

## Important Constraints
- Node.js ≥ 20; TypeScript ≥ 5.8.
- Neo4j schema must maintain versioned nodes (unique on `(name, validTo)`).
- OpenAI API usage must honor rate limits; fallback mock embeddings available via `MOCK_EMBEDDINGS=true`.
- Avoid blocking the MCP event loop; long-running tasks should be queued.

## External Dependencies
- Neo4j database (local Docker or managed) exposed over Bolt.
- OpenAI embeddings API (or future providers via `EmbeddingServiceFactory`).
- MCP-compatible clients connecting over stdio.
