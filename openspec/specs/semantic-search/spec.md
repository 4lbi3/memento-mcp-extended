# semantic-search Specification

## Purpose

TBD - created by archiving change improve-error-handling. Update Purpose after archive.

## Requirements

### Requirement: Search Result Transparency

Search operations MUST include metadata indicating the actual search strategy used and any fallback behavior that occurred.

#### Scenario: Semantic search success includes search type

- **GIVEN** semantic search is available and requested
- **WHEN** `search(query, {semanticSearch: true})` is called
- **THEN** the result includes `searchType: 'semantic'`
- **AND** `fallbackReason` is not present
- **AND** entities are ranked by embedding similarity

#### Scenario: Semantic search fallback to keyword includes metadata

- **GIVEN** semantic search is requested but embeddings are not available
- **WHEN** `search(query, {semanticSearch: true})` is called
- **THEN** the result includes `searchType: 'keyword'`
- **AND** `fallbackReason` explains why semantic search was unavailable
- **AND** entities are returned using text matching instead of embeddings

#### Scenario: Hybrid search success includes search type

- **GIVEN** hybrid search is requested and both methods are available
- **WHEN** `search(query, {hybridSearch: true})` is called
- **THEN** the result includes `searchType: 'hybrid'`
- **AND** entities are ranked using combined semantic and keyword scoring
- **AND** `fallbackReason` is not present

#### Scenario: Hybrid search degrades to keyword only

- **GIVEN** hybrid search is requested but embedding service is unavailable
- **WHEN** `search(query, {hybridSearch: true})` is called
- **THEN** the result includes `searchType: 'keyword'`
- **AND** `fallbackReason` indicates "embedding_service_unavailable"
- **AND** entities are returned using keyword matching only

### Requirement: Explicit Semantic Search Mode

When semantic search is explicitly requested, the system MUST either provide semantic results or fail with a clear error.

#### Scenario: Strict semantic mode enabled

- **GIVEN** semantic search is explicitly required via configuration
- **AND** embedding service is unavailable
- **WHEN** `search(query, {semanticSearch: true, strictMode: true})` is called
- **THEN** an error is thrown with message "Semantic search unavailable: embedding_service_not_configured"
- **AND** no fallback to keyword search occurs
- **AND** no results are returned

#### Scenario: Strict semantic mode with partial embedding coverage

- **GIVEN** strict semantic mode is enabled
- **AND** only 50% of entities have embeddings
- **WHEN** `search(query, {semanticSearch: true, strictMode: true})` is called
- **THEN** the search executes successfully
- **AND** only entities with embeddings are considered
- **AND** `searchType: 'semantic'` is returned
- **AND** a warning is logged about partial coverage

### Requirement: Fallback Reason Categorization

When search degrades from requested to actual strategy, the reason MUST be categorized for debugging and monitoring.

#### Scenario: Embedding service not configured

- **GIVEN** no embedding service is available
- **WHEN** semantic search is requested
- **THEN** `fallbackReason` is `"embedding_service_not_configured"`

#### Scenario: Vector store initialization failed

- **GIVEN** vector store failed to initialize
- **WHEN** semantic search is attempted
- **THEN** `fallbackReason` is `"vector_store_unavailable"`
- **AND** error details are logged separately

#### Scenario: No entities have embeddings

- **GIVEN** entities exist but none have embedding vectors
- **WHEN** semantic search is executed
- **THEN** `fallbackReason` is `"no_embeddings_available"`
- **AND** keyword search is used as fallback

#### Scenario: Query embedding generation failed

- **GIVEN** embedding service is available
- **AND** query embedding generation throws error
- **WHEN** semantic search is attempted
- **THEN** `fallbackReason` is `"query_embedding_failed"`
- **AND** the original error is included in logs

### Requirement: Search Quality Diagnostics

Search results MUST include diagnostic information to help understand result quality and debug issues.

#### Scenario: Diagnostics include embedding coverage

- **GIVEN** a knowledge graph with 100 entities, 80 with embeddings
- **WHEN** semantic search is performed
- **THEN** result diagnostics include:
  - `totalEntities: 100`
  - `entitiesWithEmbeddings: 80`
  - `embeddingCoverage: 0.8`
- **AND** helps users understand why some entities may be missing

#### Scenario: Diagnostics include search performance

- **GIVEN** any search operation completes
- **WHEN** results are returned
- **THEN** diagnostics include:
  - `timeTaken` in milliseconds
  - `queryVectorGenerationTime` (if semantic)
  - `vectorSearchTime` (if semantic)
  - `totalResults` count
- **AND** enables performance monitoring

#### Scenario: Diagnostics include fallback chain

- **GIVEN** search attempted semantic, fell back to keyword
- **WHEN** results are returned
- **THEN** diagnostics include:
  - `requestedSearchType: 'semantic'`
  - `actualSearchType: 'keyword'`
  - `fallbackReason: 'vector_store_unavailable'`
- **AND** provides full transparency of what occurred
