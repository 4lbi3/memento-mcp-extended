# Implementation Tasks

## 1. Error Classification Infrastructure
- [ ] 1.1 Create `src/utils/errors.ts` with error type definitions
- [ ] 1.2 Implement `ErrorCategory` enum: `TRANSIENT`, `PERMANENT`, `CRITICAL`
- [ ] 1.3 Implement `classifyError(error: unknown): ErrorCategory` function
- [ ] 1.4 Add error type guards for common error types (network, timeout, validation)
- [ ] 1.5 Write unit tests for error classification utility

## 2. Job Processing Error Recovery
- [ ] 2.1 Refactor job processing loop in `src/index.ts:158-169`
- [ ] 2.2 Add retry logic with exponential backoff for TRANSIENT errors
- [ ] 2.3 Implement job timeout mechanism in `Neo4jEmbeddingJobManager`
- [ ] 2.4 Add heartbeat extension for long-running jobs
- [ ] 2.5 Track consecutive failure count per job
- [ ] 2.6 Add max retry limit configuration (env: `EMBED_JOB_MAX_RETRIES`)
- [ ] 2.7 Write integration tests for retry behavior

## 3. Job Cleanup Error Recovery
- [ ] 3.1 Refactor cleanup loop in `src/index.ts:173-191`
- [ ] 3.2 Apply same error classification and retry logic
- [ ] 3.3 Add tests for cleanup error scenarios

## 4. Semantic Search Transparency
- [ ] 4.1 Update `KnowledgeGraph` interface to include `searchType` field
- [ ] 4.2 Add `fallbackReason?: string` to search results
- [ ] 4.3 Modify `search()` method in `KnowledgeGraphManager.ts:831-907`
- [ ] 4.4 Set `searchType` based on actual search path taken
- [ ] 4.5 Add `fallbackReason` when semantic search degrades
- [ ] 4.6 Throw error when semantic explicitly requested but unavailable
- [ ] 4.7 Write tests for all fallback scenarios

## 5. Neo4jStorageProvider Error Handling
- [ ] 5.1 Apply error classification to `searchNodes()` catch block (line 554)
- [ ] 5.2 Apply error classification to `openNodes()` catch block (line 619)
- [ ] 5.3 Review and update remaining 14+ catch blocks
- [ ] 5.4 Add context to error logs (operation, entities, state)
- [ ] 5.5 Write tests for error recovery paths

## 6. Health Monitoring
- [ ] 6.1 Add job processing metrics tracking to `Neo4jEmbeddingJobManager`
- [ ] 6.2 Implement consecutive failure detection
- [ ] 6.3 Add health status getter method
- [ ] 6.4 Log warnings when health degrades
- [ ] 6.5 Write tests for health monitoring

## 7. Documentation and Migration
- [ ] 7.1 Update API documentation for breaking changes
- [ ] 7.2 Add migration guide for search result consumers
- [ ] 7.3 Update environment variable documentation
- [ ] 7.4 Add troubleshooting guide for error recovery

## 8. Validation and Testing
- [ ] 8.1 Run `openspec validate improve-error-handling --strict`
- [ ] 8.2 Verify all unit tests pass
- [ ] 8.3 Run integration tests with real Neo4j and OpenAI
- [ ] 8.4 Manual testing of error scenarios
- [ ] 8.5 Performance testing to ensure no regression
