/**
 * Test file to verify entity history tracking with Neo4j backend
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Neo4jStorageProvider } from '../../neo4j/Neo4jStorageProvider.js';

// Define test interfaces
interface StoredEntityNode {
  id: string;
  name: string;
  entityType: string;
  observations: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  validFrom: number;
  validTo: number | null;
  changedBy: string | null;
}

// Mock Neo4j dependencies
vi.mock('neo4j-driver', () => {
  const mockSession = {
    run: vi.fn(),
    close: vi.fn(),
  };

  const mockDriver = {
    session: vi.fn().mockReturnValue(mockSession),
    close: vi.fn(),
  };

  const mockInt = (value: number) => ({
    toNumber: () => value,
    toString: () => value.toString(),
    low: value,
    high: 0,
  });

  return {
    default: {
      driver: vi.fn().mockReturnValue(mockDriver),
      auth: {
        basic: vi.fn().mockReturnValue({ username: 'test', password: 'test' }),
      },
      int: mockInt,
      Integer: class Integer {
        low: number;
        high: number;

        constructor(low: number, high: number = 0) {
          this.low = low;
          this.high = high;
        }

        toNumber() {
          return this.low;
        }

        toString() {
          return this.low.toString();
        }
      },
    },
  };
});

vi.mock('../../neo4j/Neo4jSchemaManager', () => ({
  Neo4jSchemaManager: vi.fn().mockImplementation(() => ({
    initializeSchema: vi.fn().mockResolvedValue(undefined),
    ensureEntityNameConstraint: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../neo4j/Neo4jVectorStore', () => ({
  Neo4jVectorStore: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../embeddings/EmbeddingServiceFactory', () => ({
  EmbeddingServiceFactory: {
    createFromEnvironment: vi.fn().mockReturnValue({
      getProviderInfo: () => ({ provider: 'mock', model: 'mock-model', dimensions: 1536 }),
    }),
  },
}));

describe('Neo4j Entity History Tracking Tests', () => {
  let provider: Neo4jStorageProvider;
  let mockDriver: any;
  let mockSession: {
    beginTransaction: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let mockTransaction: {
    run: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
  };
  let mockConnectionManager: any;
  let mockSchemaManager: any;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  let entityStore: Record<string, StoredEntityNode[]>;
  let updateTimestamp: number | null;
  let deleteTimestamp: number | null;

  const resetHistoricalState = () => {
    entityStore = {};
    updateTimestamp = null;
    deleteTimestamp = null;
  };

  const createHistoryRecord = (params: Record<string, unknown>): StoredEntityNode => {
    const name = params.name as string;
    return {
      id: params.id as string,
      name,
      entityType: params.entityType as string,
      observations: params.observations as string,
      version: params.version as number,
      createdAt: (params.createdAt as number) ?? (params.validFrom as number) ?? Date.now(),
      updatedAt: (params.updatedAt as number) ?? (params.now as number) ?? Date.now(),
      validFrom: (params.validFrom as number) ?? (params.now as number),
      validTo: params.validTo === undefined ? null : (params.validTo as number | null),
      changedBy: (params.changedBy as string) ?? null,
    };
  };

  beforeEach(() => {
    // Set up mocks
    mockTransaction = {
      run: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    };

    mockSession = {
      beginTransaction: vi.fn().mockReturnValue(mockTransaction),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockDriver = {
      session: vi.fn().mockReturnValue(mockSession),
      close: vi.fn(),
    };

    mockConnectionManager = {
      getDriver: vi.fn().mockReturnValue(mockDriver),
      getSession: vi.fn().mockResolvedValue(mockSession),
      executeQuery: vi.fn(),
    };

    mockSchemaManager = {
      initializeSchema: vi.fn().mockResolvedValue(true),
      ensureEntityNameConstraint: vi.fn().mockResolvedValue(true),
    };

    resetHistoricalState();

    // Mock Date.now so we can assert temporal ordering
    let fakeTime = 1_000_000;
    nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      fakeTime += 500;
      return fakeTime;
    });

    // Transaction handler simulating Neo4j temporal versioning
    mockTransaction.run.mockImplementation(async (query: string, params: Record<string, unknown> = {}) => {
      const normalized = query.replace(/\s+/g, ' ').trim();

      const names = (params.names as string[]) ?? [];
      const name = (params.name as string) ?? '';

      const getActiveVersion = (entityName: string) => {
        const versions = entityStore[entityName] ?? [];
        return versions.find((node) => node.validTo === null);
      };

      const isActiveEntityDirectMatch =
        normalized.includes('MATCH (e:Entity {name: $name') &&
        normalized.includes('RETURN e') &&
        !normalized.includes('OPTIONAL MATCH') &&
        (normalized.includes('validTo: NULL') || normalized.includes('WHERE e.validTo IS NULL'));

      if (isActiveEntityDirectMatch) {
        const active = getActiveVersion(name);
        if (!active) {
          return { records: [] };
        }
        return {
          records: [
            {
              get: () => ({ properties: { ...active } }),
            },
          ],
        };
      }

      if (normalized.includes('OPTIONAL MATCH (e)-[r:RELATES_TO]->(to:Entity)')) {
        const active = getActiveVersion(name);
        if (!active) {
          return { records: [] };
        }
        return {
          records: [
            {
              get: (key: string) => {
                if (key === 'e') {
                  return { properties: { ...active } };
                }
                if (key === 'outgoing') {
                  return [];
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

      if (
        normalized.includes('WHERE e.name IN $names') &&
        normalized.includes('collect(e.id) AS entityIds')
      ) {
        const now = params.now as number;
        const deletedIds: string[] = [];
        const deletedNames: string[] = [];
        let deletedCount = 0;

        for (const target of names) {
          const active = getActiveVersion(target);
          if (active) {
            active.validTo = now;
            deletedIds.push(active.id);
            deletedNames.push(target);
            deletedCount += 1;
          }
        }

        deleteTimestamp = now;

        return {
          records: [
            {
              get: (key: string) => {
                if (key === 'entityIds') {
                  return deletedIds;
                }
                if (key === 'deletedEntityNames') {
                  return deletedNames;
                }
                if (key === 'deletedEntityCount') {
                  return deletedCount;
                }
                return undefined;
              },
            },
          ],
        };
      }

      if (normalized.includes('MATCH (e:Entity {id: $id})')) {
        const targetId = params.id as string;
        const now = params.now as number;
        for (const versions of Object.values(entityStore)) {
          const target = versions.find((node) => node.id === targetId);
          if (target) {
            target.validTo = now;
            break;
          }
        }

        return { records: [] };
      }

      if (normalized.includes('CREATE (e:Entity')) {
        if (!entityStore[name]) {
          entityStore[name] = [];
        }

        const record = createHistoryRecord(params);
        entityStore[name].push(record);

        if (record.version > 1) {
          updateTimestamp = record.validFrom;
        }

        return {
          records: [
            {
              get: () => ({ properties: { ...record } }),
            },
          ],
        };
      }

      if (normalized.includes('MATCH (e:Entity)-[r:RELATES_TO]->()')) {
        return {
          records: [
            {
              get: () => 0,
            },
          ],
        };
      }

      if (normalized.includes('MATCH ()-[r:RELATES_TO]->(e:Entity)')) {
        return {
          records: [
            {
              get: () => 0,
            },
          ],
        };
      }

      return { records: [] };
    });

    mockConnectionManager.executeQuery.mockImplementation(
      async (query: string, params: Record<string, unknown> = {}) => {
        if (query.includes('ORDER BY e.validFrom ASC') && typeof params.name === 'string') {
          const versions = entityStore[params.name] ?? [];
          return {
            records: versions.map((node) => ({
              get: () => ({ properties: { ...node } }),
            })),
          };
        }
        return { records: [] };
      }
    );

    // Initialize provider with mocks
    const expectedPort = process.env.NEO4J_BOLT_HOST_PORT || '7687';
    const expectedUsername = process.env.NEO4J_USERNAME || 'neo4j';
    const expectedPassword = process.env.NEO4J_PASSWORD || 'memento_password';
    provider = new Neo4jStorageProvider({
      config: {
        uri: `bolt://localhost:${expectedPort}`,
        username: expectedUsername,
        password: expectedPassword,
      },
    });

    // Inject mocks
    (provider as any).connectionManager = mockConnectionManager;
    (provider as any).schemaManager = mockSchemaManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
    nowSpy.mockRestore();
  });

  it('tracks temporal entity history across create, update, and soft delete phases', async () => {
    const entityName = 'media-history';

    await provider.createEntities([
      {
        name: entityName,
        entityType: 'media',
        observations: ['first'],
      },
    ]);

    await provider.createEntities([
      {
        name: entityName,
        entityType: 'media',
        observations: ['second'],
      },
    ]);

    await provider.deleteEntities([entityName]);

    const history = await provider.getEntityHistory(entityName);

    expect(history).toHaveLength(2);
    expect(history[0].version).toBe(1);
    expect(history[0].observations).toEqual(['first']);
    expect(history[0].validTo).toBe(updateTimestamp);
    expect(updateTimestamp).not.toBeNull();

    expect(history[1].version).toBe(2);
    expect(history[1].observations).toEqual(['first', 'second']);
    expect(history[1].validFrom).toBe(updateTimestamp);
    expect(history[1].validTo).toBe(deleteTimestamp);
    expect(deleteTimestamp).not.toBeNull();
  });
});
