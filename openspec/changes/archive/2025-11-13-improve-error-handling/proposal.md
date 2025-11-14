# Change: Improve Error Handling and Recovery in Embedding Jobs

## Why

The embedding job processing system currently has inadequate error handling that leads to silent failures and data quality issues:

1. **Job Processing Loop Swallows Errors** - Scheduled job processing catches all errors and logs them, but provides no retry logic for transient failures. This causes embedding jobs to remain stuck indefinitely when temporary network issues occur.

2. **Silent Semantic Search Fallback** - When semantic search fails, the system silently falls back to keyword search without informing the client. Users believe they're getting semantic results when they're actually getting basic keyword matching.

3. **Generic Catch Blocks Without Type Discrimination** - Error handling throughout the codebase uses generic `catch (error)` blocks that don't distinguish between recoverable transient errors (network timeouts) and permanent failures (data corruption). This prevents appropriate recovery strategies.

These issues cause:

- Embedding jobs to hang forever after transient API failures
- Degraded search quality without user awareness
- Silent data quality issues that are difficult to diagnose

## What Changes

### Priority 1: Critical Fixes

1. **Job Processing Error Recovery** (src/index.ts:158-191)

   - Add error classification to distinguish transient vs permanent failures
   - Implement exponential backoff retry for transient errors
   - Add job timeout and automatic unlock mechanism
   - Track consecutive failure count for health monitoring

2. **Semantic Search Fallback Transparency** (src/KnowledgeGraphManager.ts:850-903)
   - Add `searchType: 'semantic' | 'keyword' | 'hybrid'` field to search results
   - Include `fallbackReason` when semantic search degrades to keyword
   - Throw error if semantic search explicitly requested but unavailable
   - Log degradation warnings with context

### Priority 2: Systematic Improvements

3. **Error Classification Utility**

   - Create `src/utils/errors.ts` with error type definitions
   - Implement `classifyError(error: unknown): ErrorCategory` function
   - Define retry policies per error category
   - Standardize error handling patterns across codebase

4. **Job Processing Health Monitoring**
   - Track job processing metrics (success/failure rates)
   - Detect stuck job processor (no completions in X minutes)
   - Add `/health` diagnostic endpoint for monitoring
   - Log actionable warnings when health degrades

### Breaking Changes

- **BREAKING**: `search()` method return type now includes `searchType` and optional `fallbackReason` fields
- **BREAKING**: Semantic search will throw error instead of silent fallback when explicitly requested but unavailable

## Impact

### Affected Specs

- **embedding-jobs** - Job processing error recovery and health monitoring
- **entity-management** (potential) - Search result format changes

### Affected Code

- `src/index.ts` - Job processing and cleanup loops (lines 158-191)
- `src/KnowledgeGraphManager.ts` - Search methods and fallback logic (lines 796-903)
- `src/embeddings/Neo4jEmbeddingJobManager.ts` - Job processing error handling
- `src/storage/neo4j/Neo4jStorageProvider.ts` - Generic catch blocks (16+ locations)
- `src/utils/errors.ts` - NEW file for error classification utilities

### Migration Path

For clients consuming search results:

```typescript
// Before
const results = await manager.search('query', { semanticSearch: true });

// After
const results = await manager.search('query', { semanticSearch: true });
if (results.searchType === 'keyword' && results.fallbackReason) {
  console.warn(`Search degraded: ${results.fallbackReason}`);
}
```

### Testing Requirements

- Unit tests for error classification utility
- Integration tests for job processing retry logic
- Tests for search fallback behavior and transparency
- Health monitoring endpoint validation
