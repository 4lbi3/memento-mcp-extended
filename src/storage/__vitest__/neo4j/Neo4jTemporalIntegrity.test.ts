/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Neo4jStorageProvider } from '../../neo4j/Neo4jStorageProvider';
import { Neo4jConnectionManager } from '../../neo4j/Neo4jConnectionManager';
import type { Relation } from '../../../types/relation';
import { logger } from '../../../utils/logger';

vi.mock('neo4j-driver', () => ({
  default: {
    auth: { basic: vi.fn().mockReturnValue('auth-token') },
    driver: vi.fn(),
    int: vi.fn(),
    types: {
      Integer: class {
        low = 0;
        high = 0;
        toNumber(): number {
          return this.low;
        }
      },
    },
  },
}));

vi.mock('../../neo4j/Neo4jSchemaManager', () => ({
  Neo4jSchemaManager: vi.fn().mockImplementation(() => ({
    initializeSchema: vi.fn().mockResolvedValue(undefined),
    ensureSchema: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  })),
}));

vi.mock('../../neo4j/Neo4jVectorStore', () => ({
  Neo4jVectorStore: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../../embeddings/EmbeddingServiceFactory', () => ({
  EmbeddingServiceFactory: {
    createFromEnvironment: vi.fn().mockReturnValue({
      getProviderInfo: () => ({ provider: 'mock', model: 'mock-model', dimensions: 1536 }),
    }),
  },
}));

vi.mock('../../neo4j/Neo4jConnectionManager', () => ({
  Neo4jConnectionManager: vi.fn().mockImplementation(() => ({
    getSession: vi.fn(),
    close: vi.fn(),
  })),
}));

describe('Neo4j Temporal Integrity', () => {
  let storageProvider: Neo4jStorageProvider;
  let mockSession: {
    beginTransaction: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let mockTransaction: {
    run: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
  };
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockTransaction = {
      run: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    };

    mockSession = {
      beginTransaction: vi.fn().mockReturnValue(mockTransaction),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const connectionManager = new (Neo4jConnectionManager as unknown as {
      new (): { getSession: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    })();
    connectionManager.getSession.mockResolvedValue(mockSession);

    storageProvider = new Neo4jStorageProvider({
      connectionManager,
      config: { uri: 'bolt://test', username: 'neo4j', password: 'pass' },
    });

    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('_createNewEntityVersion', () => {
    it('recreates all relationships with incremented versions and preserved metadata', async () => {
      const outgoingCalls: Record<string, unknown>[] = [];
      const incomingCalls: Record<string, unknown>[] = [];
      const now = Date.now();

      mockTransaction.run.mockImplementation(async (query: string, params: Record<string, unknown>) => {
        if (query.includes('collect(DISTINCT {rel: r, to: to})')) {
          return {
            records: [
              {
                get: (key: string) => {
                  if (key === 'e') {
                    return {
                      properties: {
                        id: 'entity-id',
                        name: 'EntityA',
                        entityType: 'Person',
                        observations: JSON.stringify(['obs-a']),
                        version: 1,
                        createdAt: now - 5000,
                      },
                    };
                  }
                  if (key === 'outgoing') {
                    return [
                      {
                        rel: {
                          properties: {
                            id: 'rel-out',
                            relationType: 'KNOWS',
                            strength: 0.9,
                            confidence: 0.8,
                            metadata: { channel: 'sensor' },
                            version: 1,
                            createdAt: now - 4000,
                          },
                        },
                        to: { properties: { name: 'EntityB' } },
                      },
                    ];
                  }
                  if (key === 'incoming') {
                    return [
                      {
                        rel: {
                          properties: {
                            id: 'rel-in',
                            relationType: 'MENTIONS',
                            strength: 0.7,
                            confidence: 0.95,
                            metadata: { source: 'feed' },
                            version: 2,
                            createdAt: now - 3000,
                          },
                        },
                        from: { properties: { name: 'EntityC' } },
                      },
                    ];
                  }
                  return null;
                },
              },
            ],
          };
        }

        if (query.includes('SET e.validTo = $now')) {
          return { records: [] };
        }

        if (query.trim().startsWith('CREATE (e:Entity')) {
          return { records: [{ get: () => ({ properties: { id: 'new-entity-id' } }) }] };
        }

        if (query.includes('MATCH (from:Entity {id: $fromId})')) {
          outgoingCalls.push(params);
          return { records: [{ get: () => ({}) }] };
        }

        if (query.includes('MATCH (from:Entity {name: $fromName})') && query.includes('MATCH (to:Entity {id: $toId})')) {
          incomingCalls.push(params);
          return { records: [{ get: () => ({}) }] };
        }

        return { records: [] };
      });

      const result = await (storageProvider as any)._createNewEntityVersion(mockTransaction, 'EntityA', ['obs-a', 'obs-b']);

      expect(result.success).toBe(true);
      expect(outgoingCalls).toHaveLength(1);
      expect(incomingCalls).toHaveLength(1);
      expect(outgoingCalls[0].version).toBe(2);
      expect(incomingCalls[0].version).toBe(3);
      expect(outgoingCalls[0].metadata).toEqual({ channel: 'sensor' });
      expect(incomingCalls[0].metadata).toEqual({ source: 'feed' });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns when target entity is missing during relationship recreation', async () => {
      mockTransaction.run.mockImplementation(async (query: string) => {
        if (query.includes('collect(DISTINCT {rel: r, to: to})')) {
          return {
            records: [
              {
                get: (key: string) => {
                  if (key === 'e') {
                    return {
                      properties: {
                        id: 'entity-id',
                        name: 'EntityA',
                        entityType: 'Person',
                        observations: JSON.stringify(['obs']),
                        version: 1,
                        createdAt: Date.now() - 1000,
                      },
                    };
                  }
                  if (key === 'outgoing') {
                    return [
                      {
                        rel: { properties: { id: 'rel-out', relationType: 'KNOWS', version: 1 } },
                        to: { properties: { name: 'EntityB' } },
                      },
                    ];
                  }
                  if (key === 'incoming') {
                    return [];
                  }
                  return null;
                },
              },
            ],
          };
        }

        if (query.includes('SET e.validTo = $now')) {
          return { records: [] };
        }

        if (query.trim().startsWith('CREATE (e:Entity')) {
          return { records: [{ get: () => ({ properties: { id: 'new' } }) }] };
        }

        if (query.includes('MATCH (from:Entity {id: $fromId})')) {
          return { records: [] };
        }

        return { records: [] };
      });

      await (storageProvider as any)._createNewEntityVersion(mockTransaction, 'EntityA', ['obs']);

      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to recreate outgoing relationship to EntityB - target entity not found in current state'
      );
    });
  });

  describe('createEntities upsert behavior', () => {
    it('creates a brand new entity when none exists', async () => {
      const versionSpy = vi.spyOn(storageProvider as any, '_createNewEntityVersion');
      const createQueries: Array<Record<string, unknown>> = [];

      mockTransaction.run.mockImplementation(async (query: string, params: Record<string, unknown>) => {
        if (query.includes('MATCH (e:Entity {name: $name, validTo: NULL})')) {
          return { records: [] };
        }

        if (query.includes('CREATE (e:Entity')) {
          createQueries.push(params);
          return {
            records: [
              {
                get: (key: string) => {
                  if (key === 'e') {
                    return {
                      properties: {
                        id: 'new-id',
                        name: params.name,
                        entityType: params.entityType,
                        observations: params.observations,
                        version: params.version,
                        createdAt: params.createdAt,
                        updatedAt: params.updatedAt,
                        validFrom: params.validFrom,
                        validTo: null,
                        changedBy: params.changedBy ?? null,
                      },
                    };
                  }
                  return undefined;
                },
              },
            ],
          };
        }

        return { records: [] };
      });

      const entities = [{ name: 'FreshEntity', entityType: 'person', observations: ['fact1'] }];
      const result = await storageProvider.createEntities(entities);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('FreshEntity');
      expect(createQueries).toHaveLength(1);
      expect(versionSpy).not.toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();

      versionSpy.mockRestore();
    });

    it('merges new observations into an existing entity', async () => {
      const versionSpy = vi
        .spyOn(storageProvider as any, '_createNewEntityVersion')
        .mockResolvedValue({ entityName: 'MergedEntity', success: true });

      let matchCalls = 0;
      mockTransaction.run.mockImplementation(async (query: string, params: Record<string, unknown>) => {
        if (query.includes('MATCH (e:Entity {name: $name, validTo: NULL})')) {
          matchCalls += 1;
          if (matchCalls === 1) {
            return {
              records: [
                {
                  get: () => ({
                    properties: {
                      id: 'existing-id',
                      name: params.name,
                      entityType: 'person',
                      observations: JSON.stringify(['fact1']),
                      version: 2,
                      createdAt: 1,
                      updatedAt: 1,
                      validFrom: 1,
                      validTo: null,
                      changedBy: null,
                    },
                  }),
                },
              ],
            };
          }

          return {
            records: [
              {
                get: () => ({
                  properties: {
                    id: 'existing-id',
                    name: params.name,
                    entityType: 'person',
                    observations: JSON.stringify(['fact1', 'fact2']),
                    version: 3,
                    createdAt: 1,
                    updatedAt: 2,
                    validFrom: 2,
                    validTo: null,
                    changedBy: null,
                  },
                }),
              },
            ],
          };
        }

        return { records: [] };
      });

      const entities = [{ name: 'MergedEntity', entityType: 'person', observations: ['fact2'] }];
      const result = await storageProvider.createEntities(entities);

      expect(versionSpy).toHaveBeenCalledTimes(1);
      expect(versionSpy).toHaveBeenCalledWith(expect.anything(), 'MergedEntity', ['fact1', 'fact2']);
      expect(result).toHaveLength(1);
      expect(result[0].observations).toEqual(['fact1', 'fact2']);

      versionSpy.mockRestore();
    });

    it('skips versioning when observations are identical (idempotent)', async () => {
      const versionSpy = vi.spyOn(storageProvider as any, '_createNewEntityVersion');

      mockTransaction.run.mockImplementation(async (query: string, params: Record<string, unknown>) => {
        if (query.includes('MATCH (e:Entity {name: $name, validTo: NULL})')) {
          return {
            records: [
              {
                get: () => ({
                  properties: {
                    id: 'existing-id',
                    name: params.name,
                    entityType: 'person',
                    observations: JSON.stringify(['fact1', 'fact2']),
                    version: 5,
                    createdAt: 10,
                    updatedAt: 10,
                    validFrom: 10,
                    validTo: null,
                    changedBy: null,
                  },
                }),
              },
            ],
          };
        }

        return { records: [] };
      });

      const entities = [{ name: 'StableEntity', entityType: 'person', observations: ['fact1', 'fact2'] }];
      const result = await storageProvider.createEntities(entities);

      expect(result).toHaveLength(1);
      expect(result[0].observations).toEqual(['fact1', 'fact2']);
      expect(versionSpy).not.toHaveBeenCalled();

      versionSpy.mockRestore();
    });
  });

  describe('createRelations temporal validation', () => {
    it('matches only current entities before creating relationships', async () => {
      const relations: Relation[] = [{ from: 'EntityA', to: 'EntityB', relationType: 'KNOWS' }];

      mockTransaction.run
        .mockImplementationOnce(async (query: string) => {
          expect(query).toContain('WHERE from.validTo IS NULL');
          expect(query).toContain('WHERE to.validTo IS NULL');
          return { records: [{ get: () => ({}) }] };
        })
        .mockImplementationOnce(async (query: string, params: Record<string, unknown>) => {
          expect(query).toContain('WHERE from.validTo IS NULL');
          expect(query).toContain('WHERE to.validTo IS NULL');
          expect(params.validTo).toBeNull();
          return {
            records: [
              {
                get: (key: string) => {
                  if (key === 'r') {
                    return { properties: { relationType: 'KNOWS' } };
                  }
                  if (key === 'from') {
                    return { properties: { name: 'EntityA' } };
                  }
                  if (key === 'to') {
                    return { properties: { name: 'EntityB' } };
                  }
                  return null;
                },
              },
            ],
          };
        });

      const created = await storageProvider.createRelations(relations);

      expect(created).toHaveLength(1);
      expect(created[0].relationType).toBe('KNOWS');
    });

    it('skips creation and logs when entities are archived', async () => {
      mockTransaction.run.mockResolvedValueOnce({ records: [] });

      const created = await storageProvider.createRelations([{ from: 'Old', to: 'Archived', relationType: 'KNOWS' }]);

      expect(created).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        'Skipping relation creation: One or both entities not found (Old -> Archived)'
      );
    });
  });

  describe('updateRelation temporal validation', () => {
    it('throws when current entity versions do not exist', async () => {
      mockTransaction.run
        .mockResolvedValueOnce({
          records: [
            {
              get: () => ({
                properties: {
                  id: 'rel-id',
                  version: 1,
                  createdAt: Date.now() - 1000,
                  strength: 0.9,
                  confidence: 0.8,
                },
              }),
            },
          ],
        })
        .mockResolvedValueOnce({ records: [] });

      await expect(
        storageProvider.updateRelation({ from: 'EntityA', to: 'EntityB', relationType: 'KNOWS' })
      ).rejects.toThrow('Entity EntityA or EntityB not found in current state');
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });
  });

  describe('deleteObservations', () => {
    it('recreates relationships with preserved metadata after deletions', async () => {
      const outgoingCalls: Record<string, unknown>[] = [];

      mockTransaction.run
        .mockResolvedValueOnce({
          records: [
            {
              get: (key: string) => {
                if (key === 'e') {
                  return {
                    properties: {
                      id: 'entity-id',
                      name: 'EntityA',
                      entityType: 'Person',
                      observations: JSON.stringify(['obs-a', 'obs-b']),
                      version: 5,
                      createdAt: Date.now() - 2000,
                    },
                  };
                }
                return null;
              },
            },
          ],
        })
        .mockImplementation(async (query: string, params: Record<string, unknown>) => {
          if (query.includes('collect(DISTINCT {rel: r, to: to})')) {
            return {
              records: [
                {
                  get: (key: string) => {
                    if (key === 'e') {
                      return {
                        properties: {
                          id: 'entity-id',
                          name: 'EntityA',
                          entityType: 'Person',
                          observations: JSON.stringify(['obs-a']),
                          version: 5,
                          createdAt: Date.now() - 3000,
                        },
                      };
                    }
                    if (key === 'outgoing') {
                      return [
                        {
                          rel: {
                            properties: {
                              id: 'rel-out',
                              relationType: 'KNOWS',
                              version: 2,
                              strength: 0.5,
                              confidence: 0.8,
                              metadata: { reason: 'friend' },
                              createdAt: Date.now() - 4000,
                            },
                          },
                          to: { properties: { name: 'EntityB' } },
                        },
                      ];
                    }
                    if (key === 'incoming') {
                      return [];
                    }
                    return null;
                  },
                },
              ],
            };
          }

          if (query.includes('SET e.validTo = $now')) {
            return { records: [] };
          }

          if (query.trim().startsWith('CREATE (e:Entity')) {
            return { records: [{ get: () => ({ properties: { id: 'new' } }) }] };
          }

          if (query.includes('MATCH (from:Entity {id: $fromId})')) {
            outgoingCalls.push(params);
            return { records: [{ get: () => ({}) }] };
          }

          return { records: [] };
        });

      await storageProvider.deleteObservations([{ entityName: 'EntityA', observations: ['obs-b'] }]);

      expect(outgoingCalls).toHaveLength(1);
      expect(outgoingCalls[0].version).toBe(3);
      expect(outgoingCalls[0].metadata).toEqual({ reason: 'friend' });
    });
  });
});
