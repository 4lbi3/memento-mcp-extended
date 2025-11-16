## ADDED Requirements
### Requirement: Cache repeated keyword searches
Keyword search results (i.e. `searchNodes`) MUST reuse cached graphs when the query text, filter parameters, and limit are identical to a previous execution and the cache entry is still within its TTL, preventing repeated Cypher work for the same parameters while the entry remains fresh.

#### Scenario: Repeated keyword search serves cached graph
- **GIVEN** the Neo4j storage provider has already executed `searchNodes('foo', {limit: 5})`
- **AND** the underlying graph has not changed since the cache entry was stored
- **WHEN** `searchNodes('foo', {limit: 5})` is called again before the TTL expires
- **THEN** the result is returned from the cache
- **AND** no new Cypher queries are executed against Neo4j during the second call
- **AND** `timeTaken` or diagnostics can signal the cache hit so operators know the latency reflects the cache layer.

#### Scenario: Cache invalidates when graph mutates
- **GIVEN** a cached result exists for `searchNodes('foo', {limit: 5})`
- **AND** an entity or relation is created, updated, or deleted via the Neo4j provider
- **WHEN** `searchNodes('foo', {limit: 5})` is called again
- **THEN** the cache entry is cleared before the second search is executed
- **AND** the second call issues fresh Neo4j queries so the returned graph reflects the mutation.
