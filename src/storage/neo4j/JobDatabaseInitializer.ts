import neo4j from 'neo4j-driver';
import type { Neo4jConfig } from './Neo4jConfig.js';
import { createJobDatabaseConnectionManager } from './Neo4jConnectionManager.js';
import { Neo4jSchemaManager } from './Neo4jSchemaManager.js';
import { logger } from '../../utils/logger.js';

const SYSTEM_DATABASE = 'system';
const DEFAULT_JOB_DATABASE = 'embedding-jobs';
const DATABASE_NOT_FOUND = 'Neo.ClientError.Database.DatabaseNotFound';
const UNAUTHORIZED_ERRORS = new Set([
  'Neo.ClientError.Security.Unauthorized',
  'Neo.ClientError.Security.Forbidden',
]);

interface JobDatabaseCredentials {
  uri: string;
  username: string;
  password: string;
  database: string;
}

/**
 * Ensures the embedding job database exists and has the required schema.
 * Creates the database (via the system database) if it is missing and installs
 * the EmbedJob constraints/indexes before workers start using it.
 */
export async function ensureJobDatabasePrepared(config: Neo4jConfig): Promise<void> {
  const jobCredentials = resolveJobDatabaseCredentials(config);
  await ensureDatabaseExists(jobCredentials);
  await ensureJobSchema(config);
}

function resolveJobDatabaseCredentials(config: Neo4jConfig): JobDatabaseCredentials {
  return {
    uri: config.jobDatabaseUri || config.uri,
    username: config.jobDatabaseUsername || config.username,
    password: config.jobDatabasePassword || config.password,
    database: config.jobDatabaseName || DEFAULT_JOB_DATABASE,
  };
}

async function ensureDatabaseExists(credentials: JobDatabaseCredentials): Promise<void> {
  const driver = neo4j.driver(
    credentials.uri,
    neo4j.auth.basic(credentials.username, credentials.password)
  );
  let session = driver.session({ database: credentials.database });

  try {
    await session.run('RETURN 1 as ok');
    logger.debug(`Embedding job database '${credentials.database}' is available.`);
    return;
  } catch (error) {
    if (!isErrorCode(error, DATABASE_NOT_FOUND)) {
      throw error;
    }

    logger.warn(
      `Embedding job database '${credentials.database}' not found. Attempting automatic creation via system database...`
    );
    await session.close().catch(() => undefined);
    session = driver.session({ database: SYSTEM_DATABASE });

    try {
      await session.run(`CREATE DATABASE \`${credentials.database}\` IF NOT EXISTS`);
      await waitForDatabaseOnline(driver, credentials.database);
      logger.info(`Embedding job database '${credentials.database}' created successfully.`);
    } catch (creationError) {
      if (isUnauthorizedError(creationError)) {
        throw new Error(
          `Unable to create embedding job database '${credentials.database}'. ` +
            'Ensure the configured Neo4j user has admin privileges.'
        );
      }
      throw creationError;
    }
  } finally {
    await session.close().catch(() => undefined);
    await driver.close().catch(() => undefined);
  }
}

async function waitForDatabaseOnline(driver: neo4j.Driver, dbName: string): Promise<void> {
  const maxAttempts = 10;
  const systemSessionFactory = (): neo4j.Session => driver.session({ database: SYSTEM_DATABASE });

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const session = systemSessionFactory();
    try {
      const result = await session.run(
        `
          SHOW DATABASES YIELD name, currentStatus
          WHERE name = $dbName
          RETURN currentStatus
        `,
        { dbName }
      );

      const currentStatus = getRecordValue(result.records[0], 'currentStatus');
      if (typeof currentStatus === 'string' && currentStatus.toUpperCase() === 'ONLINE') {
        return;
      }
    } finally {
      await session.close().catch(() => undefined);
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for Neo4j database '${dbName}' to come online.`);
}

async function ensureJobSchema(config: Neo4jConfig): Promise<void> {
  const jobConnectionManager = createJobDatabaseConnectionManager(config);
  try {
    const schemaManager = new Neo4jSchemaManager(jobConnectionManager, {
      ...config,
      database: config.jobDatabaseName || DEFAULT_JOB_DATABASE,
      uri: config.jobDatabaseUri || config.uri,
    });
    await schemaManager.createEmbedJobConstraints();
  } finally {
    await jobConnectionManager.close();
  }
}

function getRecordValue(
  record: { get?: (key: string) => unknown } | undefined,
  key: string
): unknown {
  if (!record) {
    return undefined;
  }
  if (typeof record.get === 'function') {
    return record.get(key);
  }
  return (record as Record<string, unknown>)[key];
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === code);
}

function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const errorCode = (error as { code?: string }).code;
  return Boolean(errorCode && UNAUTHORIZED_ERRORS.has(errorCode));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
