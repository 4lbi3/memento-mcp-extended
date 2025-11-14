#!/usr/bin/env node
/**
 * Memento MCP Benchmark - Main Entry Point
 * Automated end-to-end benchmark for knowledge graph memory system
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { KnowledgeGraphManager } from '../KnowledgeGraphManager.js';
import { initializeStorageProvider } from '../config/storage.js';
import { EmbeddingServiceFactory } from '../embeddings/EmbeddingServiceFactory.js';
import { Neo4jJobStore } from '../storage/neo4j/Neo4jJobStore.js';
import { Neo4jEmbeddingJobManager } from '../embeddings/Neo4jEmbeddingJobManager.js';
import { createJobDatabaseConnectionManager } from '../storage/neo4j/Neo4jConnectionManager.js';
import { DEFAULT_NEO4J_CONFIG } from '../storage/neo4j/Neo4jConfig.js';
import { logger } from '../utils/logger.js';
import { loadConfig, getDataFilePath } from './config.js';
import { getModelConfig, validateCycleCapacity } from './llm/models.js';
import { LLMClient } from './llm/LLMClient.js';
import { MCPClient } from './mcp/MCPClient.js';
import { IngestPhase } from './phases/IngestPhase.js';
import { RetrievalPhase } from './phases/RetrievalPhase.js';
import { EvaluationPhase } from './phases/EvaluationPhase.js';
import { ReportGenerator } from './report/ReportGenerator.js';
import type { Fact, Question, BenchmarkReport } from './types.js';

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║       Memento MCP Benchmark - Automated Evaluation           ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // Step 1: Load configuration
    console.log('[1/9] Loading configuration...');
    const config = loadConfig();
    console.log(`✓ Configuration loaded (Model: ${config.llm.model})`);

    // Step 2: Load datasets
    console.log('\n[2/9] Loading datasets...');
    const factsPath = getDataFilePath(config, 'facts');
    const questionsPath = getDataFilePath(config, 'questions');

    const facts: Fact[] = JSON.parse(readFileSync(factsPath, 'utf-8'));
    const questions: Question[] = JSON.parse(readFileSync(questionsPath, 'utf-8'));

    console.log(`✓ Loaded ${facts.length} facts and ${questions.length} questions`);

    // Step 3: Validate capacity for 4 cycles/day
    console.log('\n[3/9] Validating model capacity...');
    const modelConfig = getModelConfig(config.llm.model);
    const callsPerCycle = facts.length + questions.length * 3; // 1 per fact + 3 per question
    validateCycleCapacity(config.llm.model, callsPerCycle, 4);
    console.log(
      `✓ Model ${config.llm.model} can support 4+ cycles/day (${callsPerCycle} calls/cycle)`
    );

    // Step 4: Initialize storage and KnowledgeGraphManager
    console.log('\n[4/9] Initializing Memento MCP system...');

    // Override environment variables with benchmark config
    process.env.OPENAI_API_KEY = config.embedding.openaiApiKey;
    if (config.mcp.neo4jUri) process.env.NEO4J_URI = config.mcp.neo4jUri;
    if (config.mcp.neo4jUsername) process.env.NEO4J_USERNAME = config.mcp.neo4jUsername;
    if (config.mcp.neo4jPassword) process.env.NEO4J_PASSWORD = config.mcp.neo4jPassword;
    if (config.mcp.neo4jDatabase) process.env.NEO4J_DATABASE = config.mcp.neo4jDatabase;

    const storageProvider = initializeStorageProvider();
    const embeddingService = EmbeddingServiceFactory.createFromEnvironment();

    // Initialize embedding job manager
    const neo4jConfig = DEFAULT_NEO4J_CONFIG;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entityConnectionManager = (storageProvider as any).connectionManager;
    const jobConnectionManager = createJobDatabaseConnectionManager(neo4jConfig);
    const jobStore = new Neo4jJobStore(jobConnectionManager, true);

    const adaptedStorageProvider = {
      ...storageProvider,
      getEntity: async (name: string) => {
        if (typeof storageProvider.getEntity === 'function') {
          return storageProvider.getEntity(name);
        }
        const result = await storageProvider.openNodes([name]);
        return result.entities[0] || null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      storeEntityVector: async (name: string, embedding: any) => {
        const formattedEmbedding = {
          vector: embedding.vector || embedding,
          model: embedding.model || 'unknown',
          lastUpdated: embedding.lastUpdated || Date.now(),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (storageProvider as any).updateEntityEmbedding === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (storageProvider as any).updateEntityEmbedding(name, formattedEmbedding);
        }
        throw new Error('updateEntityEmbedding not implemented');
      },
    };

    const embeddingJobManager = new Neo4jEmbeddingJobManager(
      adaptedStorageProvider,
      embeddingService,
      jobStore,
      { tokensPerInterval: 20, interval: 60 * 1000 },
      null,
      logger
    );

    const knowledgeGraphManager = new KnowledgeGraphManager({
      storageProvider,
      embeddingJobManager,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vectorStoreOptions: (storageProvider as any).vectorStoreOptions,
    });

    console.log('✓ Memento MCP system initialized');

    // Step 5: Initialize clients
    console.log('\n[5/9] Initializing LLM and MCP clients...');
    const llmClient = new LLMClient(modelConfig, config.llm.apiKey);
    const mcpClient = new MCPClient(knowledgeGraphManager);
    console.log('✓ Clients initialized');

    // Step 6: Clean existing data
    console.log('\n[6/9] Cleaning existing knowledge graph data...');
    await mcpClient.deleteAllEntities();
    console.log('✓ Knowledge graph cleaned');

    // Step 7: Run benchmark phases
    const benchmarkStartTime = Date.now();

    // Phase 1: Ingest
    const ingestPhase = new IngestPhase(llmClient, mcpClient);
    const ingestResult = await ingestPhase.run(facts);

    // Wait for embeddings to be processed
    console.log('\n[7/9] Waiting for embeddings to be generated...');
    await waitForEmbeddings(embeddingJobManager, ingestResult.entitiesCreated);
    console.log('✓ Embeddings generated');

    // Phase 2: Retrieval
    const retrievalPhase = new RetrievalPhase(llmClient, mcpClient);
    const retrievalResults = await retrievalPhase.run(questions);

    // Phase 3: Evaluation
    const evaluationPhase = new EvaluationPhase(llmClient);
    const evaluationResults = await evaluationPhase.run(questions, retrievalResults);

    const totalDuration = Date.now() - benchmarkStartTime;

    // Step 8: Generate report
    console.log('\n[8/9] Generating report...');

    const llmStats = llmClient.getStats();

    // Calculate summary statistics
    const summary = {
      totalScore: evaluationResults.reduce((sum, r) => sum + r.score, 0),
      averageScore:
        evaluationResults.reduce((sum, r) => sum + r.score, 0) / evaluationResults.length,
      averageAccuracy:
        evaluationResults.reduce((sum, r) => sum + r.accuracy, 0) / evaluationResults.length,
      averageCompleteness:
        evaluationResults.reduce((sum, r) => sum + r.completeness, 0) / evaluationResults.length,
      totalQuestions: evaluationResults.length,
      successfulQuestions: evaluationResults.filter((r) => r.score > 0).length,
      failedQuestions: evaluationResults.filter((r) => r.score === 0).length,
    };

    const report: BenchmarkReport = {
      timestamp: new Date().toISOString(),
      config: {
        model: config.llm.model,
        factsCount: facts.length,
        questionsCount: questions.length,
      },
      ingest: ingestResult,
      retrieval: retrievalResults,
      evaluation: {
        results: evaluationResults,
        summary,
      },
      performance: {
        totalDuration,
        ingestDuration: ingestResult.duration,
        retrievalDuration: retrievalResults.reduce((sum, r) => sum + r.duration, 0),
        evaluationDuration: evaluationResults.reduce((sum, r) => sum + r.duration, 0),
      },
      apiStats: {
        totalRequests: llmStats.totalRequests,
        successfulRequests: llmStats.successfulRequests,
        failedRequests: llmStats.failedRequests,
        retries: llmStats.totalRetries,
      },
    };

    const reportGenerator = new ReportGenerator();
    const outputDir = resolve(process.cwd(), 'benchmark-reports');

    // Ensure output directory exists
    const { mkdirSync } = await import('fs');
    try {
      mkdirSync(outputDir, { recursive: true });
    } catch (e) {
      // Directory might already exist
    }

    const { markdownPath, jsonPath } = reportGenerator.generateReports(report, outputDir);
    console.log(`✓ Reports generated:`);
    console.log(`  - Markdown: ${markdownPath}`);
    console.log(`  - JSON: ${jsonPath}`);

    // Step 9: Print summary
    console.log('\n[9/9] Benchmark completed!');
    reportGenerator.printSummary(report);

    // Cleanup
    await jobStore.close();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (storageProvider as any).close === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (storageProvider as any).close();
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Benchmark failed:', error);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

/**
 * Wait for embedding jobs to complete
 */
async function waitForEmbeddings(
  embeddingJobManager: Neo4jEmbeddingJobManager,
  expectedCount: number
): Promise<void> {
  const maxWaitTime = 3 * 60 * 1000; // 3 minutes
  const checkInterval = 5000; // 5 seconds
  const startTime = Date.now();
  let totalProcessed = 0;

  while (Date.now() - startTime < maxWaitTime) {
    const queueStatus = await embeddingJobManager.getQueueStatus();

    if (queueStatus.pending === 0 && queueStatus.processing === 0) {
      if (queueStatus.totalJobs === 0) {
        console.log('  ✓ No embedding jobs were scheduled (queue empty)');
      } else {
        console.log('  ✓ Embedding queue drained');
      }
      return;
    }

    // Process some jobs
    const result = await embeddingJobManager.processJobs(10);
    totalProcessed += result.processed || 0;

    console.log(
      `  Embedding progress: ${totalProcessed} jobs processed (${result.successful} successful, ${result.failed} failed) `
        + `- pending ${queueStatus.pending}, processing ${queueStatus.processing}`
    );

    // If we've processed at least as many jobs as entities, we're likely done
    if (totalProcessed >= expectedCount) {
      console.log('  ✓ All embedding jobs processed');
      return;
    }

    // Wait before next check
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  console.warn('⚠ Embedding generation timeout - proceeding with available embeddings');
}

// Run main function
main();
