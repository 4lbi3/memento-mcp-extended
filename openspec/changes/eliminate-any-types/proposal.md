# Eliminate Pervasive `any` Types and Private Property Access

## Problem Statement

The codebase suffers from pervasive use of `any` types and type assertions (234 occurrences), particularly for accessing internal or optional properties, which breaks encapsulation and type safety. This leads to:

1. **Loss of compile-time type safety**: Type errors go undetected until runtime
2. **Fragile refactoring**: Changes to internal implementation details can break calling code silently
3. **Poor developer experience**: No autocomplete or type hints in IDEs
4. **Runtime errors**: Type mismatches discovered only during execution

## Critical Examples

### 1. Base Interface Type Erasure
**File**: [src/storage/StorageProvider.ts:63](src/storage/StorageProvider.ts#L63)
```typescript
createEntities(entities: any[]): Promise<any[]>;
```
This interface loses all type information throughout the storage layer, forcing callers to use type assertions.

### 2. Private Property Access via String Indexing
**File**: [src/KnowledgeGraphManager.ts:829](src/KnowledgeGraphManager.ts#L829)
```typescript
const embeddingService = this.embeddingJobManager['embeddingService'];
```
Direct access to private properties breaks encapsulation and creates tight coupling.

### 3. Type Assertion Workarounds
**File**: [src/server/handlers/callToolHandler.ts:390-410](src/server/handlers/callToolHandler.ts#L390-L410)
```typescript
const kgmAny = knowledgeGraphManager as any;
if (kgmAny.storageProvider && typeof kgmAny.storageProvider.getEntityEmbedding === 'function')
```
Using `as any` to access private properties completely bypasses TypeScript's type system.

### 4. Connection Manager Access
**File**: [src/index.ts:121](src/index.ts#L121)
```typescript
const entityConnectionManager = (storageProvider as any).connectionManager;
```
Accessing implementation-specific properties without proper abstraction.

## Proposed Solution

This change introduces three complementary improvements to achieve complete type safety:

1. **Generic Type Parameters**: Add generics to `StorageProvider` interface for type-safe entity and relation operations
2. **Public API Methods**: Expose proper public methods for accessing internal services instead of private property access
3. **Type Guards**: Implement runtime type validation for optional methods and capabilities

## Impact

- **Breaking Changes**: `StorageProvider` interface signature changes (major version bump recommended)
- **Migration Path**: Existing implementations need to add generic type parameters
- **Benefits**:
  - Full compile-time type safety across storage layer
  - Refactoring becomes safe with compiler assistance
  - Better IDE support and developer experience
  - Runtime errors prevented by type system

## Success Criteria

1. Zero `any` types in public interfaces (`StorageProvider`, `EmbeddingJobManager`, etc.)
2. No private property access via string indexing or `as any` assertions
3. All tests passing with strict TypeScript configuration
4. Type inference works correctly in calling code without manual annotations

## Related Specs

- `entity-management`: Generic types improve entity CRUD operations
- `embedding-jobs`: Public API methods for embedding service access
- `semantic-search`: Type-safe vector operations

## Dependencies

None - this is a foundational improvement that other features can build upon.

## Timeline

- **Design**: 1-2 days (finalize generic type signatures, API surface)
- **Implementation**: 3-5 days (update interfaces, implementations, tests)
- **Migration**: 1-2 days (update all call sites, verify type safety)
- **Total**: ~1-2 weeks
