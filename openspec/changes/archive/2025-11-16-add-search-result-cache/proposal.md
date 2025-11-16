## Why
- repeated keyword searches and diagnostic flows currently hit Neo4j every time, which can slow down MCP query throughput and surface more DoS risk under high-frequency read patterns.
- A fully implemented `SearchResultCache` already exists, but it is never wired up to any storage provider, so the existing logic never benefits from memoized results.
- Integrating the cache makes the keyword path much cheaper for repeated queries while still honoring TTLs and clearing when the graph changes, improving latency without changing the surface API.

## What Changes
- wire `Neo4jStorageProvider.searchNodes()` through `SearchResultCache`, including cache key construction, hit detection, and storing the warm `KnowledgeGraph` blob.
- invalidate the cache whenever entities or relations are created, updated, or deleted so stale data cannot be served and the cache behaves like a short-lived read-through layer; expose optional `searchCacheConfig` to tune TTL/size.
- add targeted Vitest coverage that proves cache hits short-circuit database queries and that a mutating call flushes the cache before the next search, and document the new expectation in the semantic-search spec requirements.

## Impact
- introduces a new configuration knob for the Neo4j provider but keeps existing defaults (e.g. 5 minute TTL, 100MB cap) while enabling caching for nearly every deployment.
- search latency for repeated keyword queries drops sharply, but the cache is cleared whenever the graph changes so eventual consistency is preserved.
- tests and diagnostics can now assert cache behavior, making regressions easier to catch earlier.
