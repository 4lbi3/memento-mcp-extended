import neo4j, { type Driver } from 'neo4j-driver';
import { performance } from 'node:perf_hooks';
import 'dotenv/config';
import { DEFAULT_NEO4J_CONFIG } from '../src/storage/neo4j/Neo4jConfig.js';
import { Neo4jConnectionManager } from '../src/storage/neo4j/Neo4jConnectionManager.js';
import { Neo4jStorageProvider } from '../src/storage/neo4j/Neo4jStorageProvider.js';
import type { Entity } from '../src/KnowledgeGraphManager.js';

// Ensure deterministic environment defaults for the benchmark
process.env.MOCK_EMBEDDINGS = process.env.MOCK_EMBEDDINGS ?? 'true';
process.env.EMBED_JOB_RETENTION_DAYS = process.env.EMBED_JOB_RETENTION_DAYS ?? '14';

interface BenchmarkResult {
  batchSize: number;
  durationMs: number;
  memoryStartMb: number;
  memoryEndMb: number;
  memoryDeltaMb: number;
}

function toMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function captureMemory(): number {
  if (typeof global.gc === 'function') {
    global.gc();
  }
  return toMb(process.memoryUsage().rss);
}

async function createTemporaryDatabase(driver: Driver, dbName: string): Promise<void> {
  const session = driver.session({ database: 'system' });
  try {
    await session.run(`CREATE DATABASE \`${dbName}\` IF NOT EXISTS WAIT`);
  } finally {
    await session.close();
  }
}

async function dropTemporaryDatabase(driver: Driver, dbName: string): Promise<void> {
  const session = driver.session({ database: 'system' });
  try {
    await session.run(`DROP DATABASE \`${dbName}\` IF EXISTS`);
  } finally {
    await session.close();
  }
}

function generateEntities(count: number, prefix: string): Entity[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}-entity-${index}`,
    entityType: 'benchmark',
    observations: [`Observation for ${prefix} entity ${index}`],
  }));
}

async function runBatch(
  storageProvider: Neo4jStorageProvider,
  batchSize: number,
  prefix: string
): Promise<BenchmarkResult> {
  const entities = generateEntities(batchSize, prefix);
  const startMemory = captureMemory();
  const startTime = performance.now();
  await storageProvider.createEntities(entities);
  const endTime = performance.now();
  const endMemory = captureMemory();

  return {
    batchSize,
    durationMs: Math.round((endTime - startTime) * 100) / 100,
    memoryStartMb: startMemory,
    memoryEndMb: endMemory,
    memoryDeltaMb: Math.round((endMemory - startMemory) * 100) / 100,
  };
}

async function main(): Promise<void> {
  const baseConfig = { ...DEFAULT_NEO4J_CONFIG };
  const driver = neo4j.driver(
    baseConfig.uri,
    neo4j.auth.basic(baseConfig.username, baseConfig.password)
  );
  const benchmarkDb = `benchmark-${Date.now()}`;

  console.log(`\n📊 Running createEntities benchmark on temporary database "${benchmarkDb}"\n`);

  try {
    await createTemporaryDatabase(driver, benchmarkDb);

    const config = {
      ...baseConfig,
      database: benchmarkDb,
    };
    const connectionManager = new Neo4jConnectionManager(config);
    const storageProvider = new Neo4jStorageProvider({
      config,
      connectionManager,
    });

    // Wait briefly for schema initialization
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const baseline = await runBatch(storageProvider, 10_000, 'baseline');
    const scale = await runBatch(storageProvider, 10_000, 'scale');

    console.table([
      {
        Batch: 'Baseline',
        'Entities Created': baseline.batchSize,
        'Duration (ms)': baseline.durationMs,
        'Start RSS (MB)': baseline.memoryStartMb,
        'End RSS (MB)': baseline.memoryEndMb,
        'Δ RSS (MB)': baseline.memoryDeltaMb,
      },
      {
        Batch: 'Scale Test',
        'Entities Created': scale.batchSize,
        'Duration (ms)': scale.durationMs,
        'Start RSS (MB)': scale.memoryStartMb,
        'End RSS (MB)': scale.memoryEndMb,
        'Δ RSS (MB)': scale.memoryDeltaMb,
      },
    ]);

    const durationRatio = Math.round((scale.durationMs / baseline.durationMs) * 100) / 100;
    const memoryDeltaRatio =
      baseline.memoryDeltaMb === 0
        ? 0
        : Math.round((scale.memoryDeltaMb / baseline.memoryDeltaMb) * 100) / 100;

    console.log('\nSummary:');
    console.log(`- Duration ratio (scale / baseline): ${durationRatio}x`);
    console.log(`- Memory delta ratio (scale / baseline): ${memoryDeltaRatio}x`);
    console.log(
      '\nℹ️  Expectation: ratios close to 1.0 confirm O(1) memory usage and linear performance per batch.'
    );

    await storageProvider.close();
  } finally {
    await dropTemporaryDatabase(driver, benchmarkDb);
    await driver.close();
  }
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
