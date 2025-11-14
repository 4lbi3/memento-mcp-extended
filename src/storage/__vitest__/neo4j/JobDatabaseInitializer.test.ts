import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Neo4jConfig } from '../../neo4j/Neo4jConfig.js';
import { ensureJobDatabasePrepared } from '../../neo4j/JobDatabaseInitializer.js';

interface RunHandlerArgs {
  database: string;
  query: string;
  params: Record<string, unknown>;
}

interface RunHandlerResult {
  records: Array<{ get?: (key: string) => unknown }>;
}

// Use vi.hoisted to properly declare all variables that will be used in factory functions
const {
  neo4jRunHandler,
  setRunHandler,
  createEmbedJobConstraintsMock,
  neo4jSchemaManagerMock,
  jobConnectionCloseMock,
  createJobDatabaseConnectionManagerMock,
} = vi.hoisted(() => {
  const neo4jRunHandler: {
    current: (args: RunHandlerArgs) => Promise<RunHandlerResult>;
  } = {
    current: async () => ({ records: [] }),
  };

  function setRunHandler(fn: (args: RunHandlerArgs) => Promise<RunHandlerResult>) {
    const spyFn = vi.fn(fn);
    neo4jRunHandler.current = spyFn;
    return spyFn;
  }

  const createEmbedJobConstraintsMock = vi.fn().mockResolvedValue(undefined);
  const jobConnectionCloseMock = vi.fn().mockResolvedValue(undefined);

  const neo4jSchemaManagerMock = vi.fn().mockImplementation(() => ({
    createEmbedJobConstraints: createEmbedJobConstraintsMock,
  }));

  const createJobDatabaseConnectionManagerMock = vi.fn(() => ({
    close: jobConnectionCloseMock,
  }));

  return {
    neo4jRunHandler,
    setRunHandler,
    createEmbedJobConstraintsMock,
    neo4jSchemaManagerMock,
    jobConnectionCloseMock,
    createJobDatabaseConnectionManagerMock,
  };
});

vi.mock('neo4j-driver', () => {
  const driverMock = {
    session: vi.fn(({ database }) => ({
      run: (query: string, params: Record<string, unknown>) =>
        neo4jRunHandler.current({ database, query, params }),
      close: vi.fn().mockResolvedValue(undefined),
    })),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const driverFactory = vi.fn(() => driverMock);
  const authBasic = vi.fn(() => ({}));

  return {
    default: {
      driver: driverFactory,
      auth: { basic: authBasic },
    },
    auth: { basic: authBasic },
  };
});

vi.mock('../../neo4j/Neo4jSchemaManager.js', () => ({
  Neo4jSchemaManager: neo4jSchemaManagerMock,
}));

vi.mock('../../neo4j/Neo4jConnectionManager.js', () => ({
  createJobDatabaseConnectionManager: createJobDatabaseConnectionManagerMock,
}));

const baseConfig: Neo4jConfig = {
  uri: 'bolt://localhost:7687',
  username: 'neo4j',
  password: 'pass',
  database: 'neo4j',
  vectorIndexName: 'entity_embeddings',
  vectorDimensions: 1536,
  similarityFunction: 'cosine',
  jobDatabaseName: 'embedding-jobs',
  embedJobRetentionDays: 14,
};

describe('ensureJobDatabasePrepared', () => {
  beforeEach(() => {
    setRunHandler(async () => ({ records: [] }));
    createEmbedJobConstraintsMock.mockClear();
    neo4jSchemaManagerMock.mockClear();
    createJobDatabaseConnectionManagerMock.mockClear();
    jobConnectionCloseMock.mockClear();
  });

  it('skips creation when job database already exists', async () => {
    const handlerMock = setRunHandler(async ({ database, query }) => {
      expect(database).toBe('embedding-jobs');
      expect(query).toContain('RETURN 1');
      return { records: [] };
    }) as unknown as typeof neo4jRunHandler.current;

    await ensureJobDatabasePrepared(baseConfig);

    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(createJobDatabaseConnectionManagerMock).toHaveBeenCalledTimes(1);
    expect(createEmbedJobConstraintsMock).toHaveBeenCalledTimes(1);
  });

  it('creates the database and waits until it is online when missing', async () => {
    let showStatusCalls = 0;

    const handlerMock = setRunHandler(async ({ database, query }) => {
      if (database === 'embedding-jobs') {
        throw { code: 'Neo.ClientError.Database.DatabaseNotFound' };
      }

      if (database === 'system' && query.includes('CREATE DATABASE')) {
        return { records: [] };
      }

      if (database === 'system' && query.includes('SHOW DATABASES')) {
        showStatusCalls += 1;
        return {
          records: [
            {
              get: (key: string) =>
                key === 'currentStatus' ? (showStatusCalls > 1 ? 'ONLINE' : 'CREATING') : null,
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${query}`);
    }) as unknown as typeof neo4jRunHandler.current;

    await ensureJobDatabasePrepared(baseConfig);

    expect(handlerMock).toHaveBeenCalled();
    expect(createJobDatabaseConnectionManagerMock).toHaveBeenCalledTimes(1);
    expect(createEmbedJobConstraintsMock).toHaveBeenCalledTimes(1);
  });
});
