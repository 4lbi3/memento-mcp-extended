# Implementation Tasks

## 1. Storage Provider Interface Extension
- [x] 1.1 Add `getEntitiesWithoutEmbeddings(limit?: number): Promise<EntityNode[]>` to `IStorageProvider` interface in `src/storage/interfaces.ts`

## 2. Neo4j Implementation
- [x] 2.1 Implement `getEntitiesWithoutEmbeddings` in `Neo4jStorageProvider` with efficient Cypher query
- [x] 2.2 Add query to find entities where `embedding IS NULL AND validTo IS NULL`
- [x] 2.3 Include LIMIT clause to respect batch size parameter (default to 10)
- [x] 2.4 Ensure query only returns valid (non-deleted) entities

## 3. Tool Handler Logic
- [x] 3.1 Modify `callToolHandler.ts` to remove unsafe `openNodes([])` call
- [x] 3.2 Implement dual-mode logic: check if `entity_name` is provided
- [x] 3.3 Mode 1: If `entity_name` provided, use existing `getEntity()` call for specific entity
- [x] 3.4 Mode 2: If `entity_name` absent, call new `getEntitiesWithoutEmbeddings(limit)` method
- [x] 3.5 Queue embedding jobs for all discovered entities in both modes
- [x] 3.6 Return appropriate feedback messages for each mode

## 4. Tool Schema Update
- [x] 4.1 Update tool description in `src/server/tools.ts` to document dual-mode behavior
- [x] 4.2 Clarify `entity_name` is optional (omit for batch repair mode)
- [x] 4.3 Document `limit` parameter for batch mode (default: 10, prevents overload)
- [x] 4.4 Add usage examples for both modes

## 5. Testing
- [x] 5.1 Test Mode 1: Force regenerate embedding for specific entity
- [x] 5.2 Test Mode 2: Batch repair finds entities without embeddings
- [x] 5.3 Verify limit parameter correctly constrains batch size
- [x] 5.4 Confirm only valid entities (validTo IS NULL) are returned
- [x] 5.5 Test that embedding jobs are properly queued in both modes

## 6. Documentation
- [x] 6.1 Update MCP tool documentation to explain dual-mode operation
- [x] 6.2 Add operational guide for using batch repair mode
- [x] 6.3 Document recommended batch sizes for different graph sizes
