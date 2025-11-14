# Implementation Tasks

## 1. Error Classification Infrastructure

- [x] 1.1 Create `src/utils/errors.ts` with error type definitions
- [x] 1.2 Implement `ErrorCategory` enum: `TRANSIENT`, `PERMANENT`, `CRITICAL`
- [x] 1.3 Implement `classifyError(error: unknown): ErrorCategory` function
- [x] 1.4 Add error type guards for common error types (network, timeout, validation)
- [x] 1.5 Write unit tests for error classification utility

## 2. Job Processing Error Recovery

- [x] 2.1 Refactor job processing loop in `src/index.ts:158-169`
- [x] 2.2 Add retry logic with exponential backoff for TRANSIENT errors
- [x] 2.3 Implement job timeout mechanism in `Neo4jEmbeddingJobManager`
- [x] 2.4 Add heartbeat extension for long-running jobs
- [x] 2.5 Track consecutive failure count per job
- [x] 2.6 Add max retry limit configuration (env: `EMBED_JOB_MAX_RETRIES`)
- [x] 2.7 Write integration tests for retry behavior

## 3. Job Cleanup Error Recovery

## 3. Job Cleanup Error Recovery

- [x] 3.1 Refactor cleanup loop in `src/index.ts:173-191`
- [x] 3.2 Apply same error classification and retry logic
- [x] 3.3 Add tests for cleanup error scenarios

## 4. Semantic Search Transparency

- [x] 4.1 Update `KnowledgeGraph` interface to include `searchType` field
- [x] 4.2 Add `fallbackReason?: string` to search results
- [x] 4.3 Modify `search()` method in `KnowledgeGraphManager.ts:831-907`
- [x] 4.4 Set `searchType` based on actual search path taken
- [x] 4.5 Add `fallbackReason` when semantic search degrades
- [x] 4.6 Throw error when semantic explicitly requested but unavailable
- [x] 4.7 Write tests for all fallback scenarios

## 5. Neo4jStorageProvider Error Handling

## 5. Neo4jStorageProvider Error Handling

- [x] 5.1 Apply error classification to `searchNodes()` catch block (line 554)
- [x] 5.2 Apply error classification to `openNodes()` catch block (line 619)
- [x] 5.3 Review and update remaining 14+ catch blocks
- [x] 5.4 Add context to error logs (operation, entities, state)
- [x] 5.5 Write tests for error recovery paths

## 6. Health Monitoring

- [x] 6.1 Add job processing metrics tracking to `Neo4jEmbeddingJobManager`
- [x] 6.2 Implement consecutive failure detection
- [x] 6.3 Add health status getter method
- [x] 6.4 Log warnings when health degrades
- [x] 6.5 Write tests for health monitoring

## 7. Documentation and Migration

- [x] 7.1 Update API documentation for breaking changes
- [x] 7.2 Add migration guide for search result consumers
- [x] 7.3 Update environment variable documentation
- [x] 7.4 Add troubleshooting guide for error recovery

## 8. Validation and Testing

## 8. Validation and Testing

- [x] 8.1 Run `openspec validate improve-error-handling --strict`
- [x] 8.2 Verify all unit tests pass
- [x] 8.3 Run integration tests with real Neo4j and OpenAI
- [x] 8.4 Manual testing of error scenarios
- [x] 8.5 Performance testing to ensure no regression
