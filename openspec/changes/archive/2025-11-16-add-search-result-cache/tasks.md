## Tasks
- [x] 1.1 Review `SearchResultCache.ts` to understand its API, current tests, and determine the cache key/TTL surface we need for `searchNodes`.
- [x] 1.2 Update `Neo4jStorageProvider` to accept an optional `searchCacheConfig`, instantiate the cache, use it inside `searchNodes`, and invalidate it after any entity/relation mutations.
- [x] 1.3 Add or extend Vitest coverage to confirm repeated `searchNodes` calls reuse cached results and that a mutating operation clears the cache before the next lookup.
- [x] 1.4 Update `semantic-search` spec and the changelog to describe the caching behavior so downstream consumers know about the new performance expectation.
