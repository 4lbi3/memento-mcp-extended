/**
 * @vitest-environment node
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { Neo4jConnectionManager } from '../../neo4j/Neo4jConnectionManager';
import { Neo4jSchemaManager } from '../../neo4j/Neo4jSchemaManager';

const isIntegrationTest = process.env.TEST_INTEGRATION === 'true';
const describeIntegration = isIntegrationTest ? describe : describe.skip;

if (!isIntegrationTest) {
  console.info(
    'Neo4j integration tests are skipped by default. Set TEST_INTEGRATION=true to run them.'
  );
}

describeIntegration('Neo4j Integration Test', () => {
  let connectionManager: Neo4jConnectionManager;
  let schemaManager: Neo4jSchemaManager;
  let systemManager: Neo4jConnectionManager;
  const boltPort = process.env.NEO4J_BOLT_HOST_PORT || '7687';
  const username = process.env.NEO4J_USERNAME || 'neo4j';
  const password = process.env.NEO4J_PASSWORD || 'memento_password';
  const uri = process.env.NEO4J_URI || `bolt://localhost:${boltPort}`;
  const rawDatabaseName = process.env.NEO4J_INTEGRATION_DATABASE || 'integrationtest';
  const sanitized = rawDatabaseName.replace(/[^0-9A-Za-z]/g, '');
  const targetDatabase = sanitized || 'integrationtest';

  beforeAll(async () => {
    systemManager = new Neo4jConnectionManager({
      uri,
      username,
      password,
      database: 'system',
    });

    try {
      await systemManager.executeQuery(
        `CREATE DATABASE ${targetDatabase} IF NOT EXISTS WAIT`,
        {}
      );
    } catch (error) {
      console.warn('Unable to create integration database (it may already exist)', error);
    }

    connectionManager = new Neo4jConnectionManager({
      uri,
      username,
      password,
      database: targetDatabase,
    });
    schemaManager = new Neo4jSchemaManager(connectionManager);
  });

  afterAll(async () => {
    await connectionManager.close();

    try {
      await systemManager.executeQuery(
        `DROP DATABASE ${targetDatabase} IF EXISTS WAIT`,
        {}
      );
    } catch (error) {
      console.warn('Unable to drop integration database (it may be in use)', error);
    }
    await systemManager.close();
  });

  it('should connect to the isolated Neo4j Integration database', async () => {
    const session = await connectionManager.getSession();
    const result = await session.run('RETURN 1 as value');
    await session.close();

    expect(result.records[0].get('value').toNumber()).toBe(1);
  });

  it('should execute schema operations on the dedicated database', async () => {
    await expect(schemaManager.createEntityConstraints()).resolves.not.toThrow();

    const session = await connectionManager.getSession();
    const result = await session.run('SHOW CONSTRAINTS WHERE name = $name', {
      name: 'entity_name',
    });
    await session.close();

    expect(result.records.length).toBeGreaterThan(0);
  });

  it('should create vector index without touching production schema', async () => {
    await expect(
      schemaManager.createVectorIndex('test_vector_index', 'TestEntity', 'embedding', 128)
    ).resolves.not.toThrow();

    const exists = await schemaManager.vectorIndexExists('test_vector_index');
    expect(exists).toBe(true);
  });
});
