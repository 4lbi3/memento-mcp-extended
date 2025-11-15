# Implementation Tasks

## 1. Update deleteEntities() for Soft Delete
- [x] 1.1 Replace DETACH DELETE with SET validTo = timestamp for matched entities
- [x] 1.2 Invalidate all outgoing relationships (WHERE validTo IS NULL, SET validTo = timestamp)
- [x] 1.3 Invalidate all incoming relationships (WHERE validTo IS NULL, SET validTo = timestamp)
- [x] 1.4 Add logging for soft-deleted entity count
- [x] 1.5 Update error handling to reflect soft delete behavior

## 2. Update deleteRelations() for Soft Delete
- [x] 2.1 Replace DELETE with SET validTo = timestamp for matched relationships
- [x] 2.2 Add WHERE validTo IS NULL filter to only soft-delete current relationships
- [x] 2.3 Add logging for soft-deleted relationship count
- [x] 2.4 Update error handling to reflect soft delete behavior

## 3. Add Maintenance Purge Methods
- [x] 3.1 Implement purgeArchivedEntities(cutoffTimestamp) method
- [x] 3.2 Implement purgeArchivedRelations(cutoffTimestamp) method
- [x] 3.3 Add safety checks (prevent purging current versions)
- [x] 3.4 Add transaction support with rollback
- [x] 3.5 Add comprehensive logging for purge operations

## 4. Verify Read Query Filters
- [x] 4.1 Audit all read queries for proper validTo IS NULL filtering
- [x] 4.2 Ensure loadGraph() excludes soft-deleted entities
- [x] 4.3 Ensure getEntity() excludes soft-deleted entities
- [x] 4.4 Ensure relation queries exclude soft-deleted relationships

## 5. Write Tests
- [x] 5.1 Test deleteEntities() sets validTo timestamp correctly
- [x] 5.2 Test deleteEntities() invalidates all relationships
- [x] 5.3 Test deleteRelations() sets validTo timestamp correctly
- [x] 5.4 Test soft-deleted entities not returned by read operations
- [x] 5.5 Test soft-deleted relations not returned by read operations
- [x] 5.6 Test purgeArchivedEntities() permanently removes old versions
- [x] 5.7 Test purgeArchivedRelations() permanently removes old relationships
- [x] 5.8 Test purge methods don't delete current versions
- [x] 5.9 Test historical queries still return soft-deleted data when appropriate
- [x] 5.10 Add integration tests to Neo4jTemporalIntegrity.test.ts

## 6. Documentation
- [x] 6.1 Update code comments in deleteEntities()
- [x] 6.2 Update code comments in deleteRelations()
- [x] 6.3 Add JSDoc for new purge methods
- [x] 6.4 Document purge maintenance procedures
