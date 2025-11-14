# Change: Enhance Force Embedding Tool with Dual Mode Operation

## Why

The `force_generate_embedding` MCP tool currently has a critical bug: it calls `knowledgeGraphManager.openNodes([])` to list all entities, but the Neo4j provider returns empty results when the array is empty. This causes the tool to fail in finding entities to process.

Additionally, the current design requires the user to already know which entity needs embedding repair, making it unsuitable for discovering and fixing entities that lack embeddings due to previous failures.

## What Changes

- **Transform tool into dual-mode operation:**
  - **Mode 1 (Specific Force)**: When `entity_name` is provided, force regenerate embedding for that specific entity
  - **Mode 2 (Batch Repair)**: When `entity_name` is absent, find and repair entities missing embeddings in safe batches

- **Add new storage provider method** `getEntitiesWithoutEmbeddings(limit?)` to efficiently query entities lacking embeddings

- **Remove unsafe `openNodes([])` call** that attempts to load the entire graph

- **Add batch safety controls** via `limit` parameter to prevent system overload

This change transforms the tool from a narrow debugging utility into a comprehensive maintenance tool that can both force-regenerate specific embeddings and discover/repair missing embeddings across the graph.

## Impact

- **Affected specs:** `embedding-jobs`
- **Affected code:**
  - `src/server/handlers/callToolHandler.ts` - Tool handler logic
  - `src/storage/interfaces.ts` - Add `getEntitiesWithoutEmbeddings` method to `IStorageProvider`
  - `src/storage/neo4j/Neo4jStorageProvider.ts` - Implement the new method
  - `src/server/tools.ts` - Update tool schema to document dual-mode behavior

- **Benefits:**
  - Fixes the bug preventing entity discovery
  - Adds batch repair capability for operational maintenance
  - Prevents accidental graph-wide operations
  - Provides efficient, query-optimized entity discovery

- **Breaking changes:** None (extends existing tool behavior)
