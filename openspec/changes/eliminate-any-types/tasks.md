# Implementation Tasks

## Overview

This task list breaks down the type safety improvements into incremental, verifiable work items. Tasks are ordered to minimize breaking changes and enable gradual migration.

## Phase 1: Foundation - Generic Types & Capability Interfaces (Non-Breaking)

### Task 1: Add Generic Parameters to Core Types
**Capability**: `generic-storage-types`
**Validation**: TypeScript compiles without errors; existing tests pass unchanged

- [ ] Add generic parameters to `Entity` and `Relation` types with default values
- [ ] Update `KnowledgeGraph` interface to accept generic type parameters `<TEntity, TRelation>`
- [ ] Set default values: `KnowledgeGraph<TEntity extends Entity = Entity, TRelation extends Relation = Relation>`
- [ ] Run `npm run build` to verify no compilation errors
- [ ] Run `npm test` to ensure all existing tests pass

### Task 2: Update StorageProvider Interface with Generics
**Capability**: `generic-storage-types`
**Validation**: TypeScript compiles; implementations still work without type arguments

- [ ] Add generic parameters to `StorageProvider` interface with defaults
- [ ] Update all method signatures to use `TEntity` and `TRelation` instead of `any`
  - [ ] `createEntities(entities: TEntity[]): Promise<TEntity[]>`
  - [ ] `getEntity(entityName: string): Promise<TEntity | null>`
  - [ ] `loadGraph(): Promise<KnowledgeGraph<TEntity, TRelation>>`
  - [ ] Update all other methods similarly
- [ ] Remove `@typescript-eslint/no-explicit-any` eslint-disable comments for these methods
- [ ] Verify existing code compiles without explicit type arguments (defaults should work)
- [ ] Run tests to ensure runtime behavior unchanged

### Task 3: Define Capability Interfaces
**Capability**: `type-guard-capabilities`
**Validation**: Interfaces compile; no implementation changes yet

- [ ] Create `VectorSearchCapableProvider<TEntity>` interface extending `StorageProvider<TEntity>`
- [ ] Create `TemporalCapableProvider<TEntity, TRelation>` interface extending `StorageProvider<TEntity, TRelation>`
- [ ] Create `EmbeddingCapableProvider` interface extending `StorageProvider`
- [ ] Create `ConnectionCapableProvider` interface extending `StorageProvider`
- [ ] Create `PurgeCapableProvider` interface extending `StorageProvider`
- [ ] Move optional method signatures from `StorageProvider` to capability interfaces
- [ ] Add comprehensive JSDoc comments explaining each capability
- [ ] Run `npm run build` to verify interface definitions are valid

### Task 4: Implement Type Guard Functions
**Capability**: `type-guard-capabilities`
**Validation**: Type guards work correctly at runtime; compile-time narrowing verified

- [ ] Implement `hasVectorSearchCapability(provider)` type guard
- [ ] Implement `hasTemporalCapability(provider)` type guard
- [ ] Implement `hasEmbeddingCapability(provider)` type guard
- [ ] Implement `hasConnectionManager(provider)` type guard
- [ ] Implement `hasPurgeCapability(provider)` type guard
- [ ] Implement `hasSemanticSearchCapabilities(provider)` composite type guard
- [ ] Add unit tests for each type guard (positive and negative cases)
- [ ] Add compile-time type tests to verify type narrowing works
- [ ] Run tests: `npm test`

### Task 5: Update Neo4jStorageProvider Implementation
**Capability**: `generic-storage-types`
**Validation**: Neo4j provider implements all capability interfaces correctly

- [ ] Add generic parameters to `Neo4jStorageProvider` class declaration
- [ ] Explicitly implement capability interfaces (e.g., `implements EmbeddingCapableProvider, TemporalCapableProvider`)
- [ ] Update internal method signatures to use typed generics instead of `any`
- [ ] Update `ExtendedEntity` and `ExtendedRelation` type definitions
- [ ] Verify all interface requirements are satisfied
- [ ] Run Neo4j storage provider tests: `npm test -- Neo4jStorageProvider`
- [ ] Verify no type errors with `npx tsc --noEmit`

### Task 6: Update FileStorageProvider Implementation
**Capability**: `generic-storage-types`
**Validation**: File provider works with generic types; no capability interfaces needed

- [ ] Add generic parameters to `FileStorageProvider` class declaration
- [ ] Update method signatures to use `TEntity` and `TRelation` types
- [ ] Remove `any` types from implementation
- [ ] Run file storage provider tests: `npm test -- FileStorageProvider`
- [ ] Verify type safety with `npx tsc --noEmit`

## Phase 2: Public API Methods (Non-Breaking)

### Task 7: Add Public API to EmbeddingJobManager
**Capability**: `public-api-encapsulation`
**Validation**: Public methods work; private access still works (deprecated)

- [ ] Add `public getEmbeddingService(): EmbeddingService` method to `Neo4jEmbeddingJobManager`
- [ ] Add `public getModelInfo(): { name: string; dimensions: number }` method
- [ ] Add JSDoc comments with `@public` tags
- [ ] Add deprecation notice to direct private property access pattern (comment only, don't break)
- [ ] Add unit tests for new public methods
- [ ] Run embedding job manager tests: `npm test -- EmbeddingJobManager`

### Task 8: Add Connection Manager Public API
**Capability**: `public-api-encapsulation`
**Validation**: `getConnectionManager()` method works correctly

- [ ] Add `public getConnectionManager(): Neo4jConnectionManager` to `Neo4jStorageProvider`
- [ ] Add JSDoc comment explaining when to use this method
- [ ] Add unit test verifying method returns connection manager
- [ ] Run Neo4j provider tests: `npm test -- Neo4jStorageProvider`

### Task 9: Add Storage Provider Accessor to KnowledgeGraphManager
**Capability**: `public-api-encapsulation`
**Validation**: Tool handlers can access storage provider through public API

- [ ] Add `public getStorageProvider(): StorageProvider` method to `KnowledgeGraphManager`
- [ ] Add JSDoc comment
- [ ] Add unit test
- [ ] Run KnowledgeGraphManager tests: `npm test -- KnowledgeGraphManager`

## Phase 3: Migration - Update Call Sites (Breaking Changes)

### Task 10: Migrate KnowledgeGraphManager Embedding Access
**Capability**: `public-api-encapsulation`
**Validation**: No private property access in KnowledgeGraphManager

- [ ] Replace `this.embeddingJobManager['embeddingService']` with `this.embeddingJobManager.getEmbeddingService()` in `findSimilarEntities()` (line ~829)
- [ ] Replace similar access in `semanticSearch()` method (line ~975)
- [ ] Remove all `['embeddingService']` string-indexed access from the file
- [ ] Verify no `as any` casts related to embedding access remain
- [ ] Run semantic search tests: `npm test -- KnowledgeGraphManager`
- [ ] Manually test `findSimilarEntities` and `semanticSearch` functionality

### Task 11: Migrate index.ts Connection Manager Access
**Capability**: `public-api-encapsulation`
**Validation**: No `as any` casts for connection manager access

- [ ] Replace `(storageProvider as any).connectionManager` with capability check (line ~121)
- [ ] Import `hasConnectionManager` type guard
- [ ] Wrap access in `if (hasConnectionManager(storageProvider))` conditional
- [ ] Add proper error handling if capability not available
- [ ] Remove `@typescript-eslint/no-explicit-any` eslint-disable comment
- [ ] Run initialization tests: `npm test -- index.test`
- [ ] Manually verify server startup works

### Task 12: Migrate callToolHandler.ts Embedding Access
**Capability**: `public-api-encapsulation`, `type-guard-capabilities`
**Validation**: No `kgmAny` variable; capability-based access only

- [ ] Remove `const kgmAny = knowledgeGraphManager as any;` declaration (line ~390)
- [ ] Replace with `const storageProvider = knowledgeGraphManager.getStorageProvider();`
- [ ] Import `hasEmbeddingCapability` type guard
- [ ] Wrap embedding access in `if (hasEmbeddingCapability(storageProvider))` check
- [ ] Update error messages to indicate capability not supported
- [ ] Remove all `kgmAny.storageProvider` references
- [ ] Remove `@typescript-eslint/no-explicit-any` eslint-disable comments
- [ ] Run tool handler tests: `npm test -- callToolHandler`
- [ ] Manually test `get_entity_embedding` tool

### Task 13: Migrate Other Tool Handlers
**Capability**: `type-guard-capabilities`
**Validation**: All tool handlers use capability pattern

- [ ] Search for `as any` in `src/server/handlers/` directory
- [ ] Replace each instance with appropriate capability check
- [ ] For temporal operations, use `hasTemporalCapability()` type guard
- [ ] For purge operations, use `hasPurgeCapability()` type guard
- [ ] Run all handler tests: `npm test -- handlers/`

### Task 14: Update Type Assertions in Tests
**Capability**: `generic-storage-types`
**Validation**: Test code uses proper types, not `any`

- [ ] Search for `as any` in `src/__vitest__/` directory
- [ ] Review each usage - keep only truly necessary test-specific casts
- [ ] Replace entity creation tests to use properly typed entities
- [ ] Update mock provider implementations with generic types
- [ ] Run full test suite: `npm test`

## Phase 4: Strict Type Checking (Breaking Changes)

### Task 15: Enable Stricter TypeScript Configuration
**Capability**: All capabilities
**Validation**: Project compiles under strict mode; all tests pass

- [ ] Update `tsconfig.json` to enable `strict: true`
- [ ] Enable `noImplicitAny: true` (if not already enabled)
- [ ] Enable `strictNullChecks: true` (if not already enabled)
- [ ] Enable `strictFunctionTypes: true` (if not already enabled)
- [ ] Fix any new type errors revealed by strict mode
- [ ] Run `npx tsc --noEmit` to verify no compilation errors
- [ ] Run full test suite: `npm test`

### Task 16: Remove ESLint Suppressions
**Capability**: All capabilities
**Validation**: No `@typescript-eslint/no-explicit-any` suppressions remain (except justified cases)

- [ ] Search codebase for `@typescript-eslint/no-explicit-any` comments
- [ ] Remove suppressions from `StorageProvider.ts` (should be fixed now)
- [ ] Remove suppressions from `KnowledgeGraphManager.ts`
- [ ] Remove suppressions from `callToolHandler.ts`
- [ ] Remove suppressions from other handler files
- [ ] Keep only justified suppressions (document why in comment)
- [ ] Run `npm run lint` to verify no new violations
- [ ] Fix any reported `any` usage appropriately

### Task 17: Update Documentation
**Capability**: All capabilities
**Validation**: Documentation accurately reflects new type-safe APIs

- [ ] Update `README.md` with examples of generic storage provider usage
- [ ] Document capability interfaces and when to use them
- [ ] Add migration guide for existing code using old patterns
- [ ] Update inline code comments to reflect new APIs
- [ ] Add examples of type guard usage to developer documentation
- [ ] Document breaking changes in `CHANGELOG.md`

## Phase 5: Validation & Testing

### Task 18: Add Type-Level Tests
**Capability**: `generic-storage-types`, `type-guard-capabilities`
**Validation**: Type inference works as expected

- [ ] Create `src/__type-tests__/StorageProvider.test-d.ts` for compile-time type tests
- [ ] Add tests for generic parameter inference
- [ ] Add tests for type narrowing with type guards
- [ ] Add tests for capability interface composition
- [ ] Run type tests with `tsd` or similar tool
- [ ] Verify all type-level tests pass

### Task 19: Integration Testing
**Capability**: All capabilities
**Validation**: End-to-end workflows function correctly with new types

- [ ] Test entity creation through MCP tools (type-safe flow)
- [ ] Test semantic search with proper type inference
- [ ] Test temporal queries with capability checking
- [ ] Test embedding generation and retrieval
- [ ] Run integration tests: `npm run test:integration` (if available)
- [ ] Manually test common workflows in development environment

### Task 20: Performance & Regression Testing
**Capability**: All capabilities
**Validation**: No performance regression from type changes

- [ ] Run benchmark suite if available
- [ ] Compare performance metrics before and after changes
- [ ] Verify no runtime overhead from type guards (should be negligible)
- [ ] Test with large datasets to ensure type safety doesn't impact performance
- [ ] Document any performance findings

## Dependencies & Parallelization

### Can be done in parallel:
- Tasks 1-2 (generic types foundation)
- Tasks 3-4 (capability interfaces and type guards)
- Tasks 7-9 (adding public API methods)

### Must be sequential:
- Tasks 1-6 must complete before tasks 10-14 (foundation before migration)
- Tasks 10-14 must complete before task 15 (migrate before strict mode)
- Task 15 must complete before task 16 (strict mode before removing suppressions)

### Optional tasks (can be done last):
- Task 17 (documentation) - can be done anytime after task 13
- Task 18 (type-level tests) - can be done anytime after task 4
- Tasks 19-20 (integration/performance) - final validation only

## Success Metrics

Upon completion, verify:

1. ✅ Zero `any` types in public `StorageProvider` interface
2. ✅ Zero private property access via string indexing or `as any`
3. ✅ All tests passing with `strict: true` in tsconfig.json
4. ✅ No `@typescript-eslint/no-explicit-any` suppressions in core files
5. ✅ Type inference works correctly (verified by type-level tests)
6. ✅ IDE autocomplete and type hints work throughout codebase
7. ✅ `npm run build` completes without errors or warnings
8. ✅ `npm run lint` passes without type-related violations

## Estimated Timeline

- **Phase 1** (Tasks 1-6): 2-3 days
- **Phase 2** (Tasks 7-9): 1 day
- **Phase 3** (Tasks 10-14): 2-3 days
- **Phase 4** (Tasks 15-17): 1-2 days
- **Phase 5** (Tasks 18-20): 1-2 days

**Total**: ~7-11 days of focused development work
