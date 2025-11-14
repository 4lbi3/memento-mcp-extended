/**
 * Type definitions for the benchmark system
 */

export interface BenchmarkConfig {
  llm: {
    model: 'gemini-2.5-flash-lite' | 'gemma-3';
    apiKey: string;
  };
  embedding: {
    openaiApiKey: string;
  };
  mcp: {
    serverPath: string;
    neo4jUri: string;
    neo4jUsername: string;
    neo4jPassword: string;
    neo4jDatabase: string;
  };
  benchmark: {
    factsFile?: string;
    questionsFile?: string;
  };
}

export interface ModelConfig {
  name: string;
  apiEndpoint: string;
  rpm: number; // Requests Per Minute
  tpm: number; // Tokens Per Minute
  rpd: number; // Requests Per Day
  minIntervalMs?: number; // Optional minimum delay between consecutive requests
}

export interface Fact {
  id: string;
  content: string;
  category?: string;
}

export interface Question {
  id: string;
  question: string;
  goldAnswer: string;
  category?: string;
  relatedFactIds?: string[];
}

export interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

export interface Relation {
  from: string;
  to: string;
  relationType: string;
}

export interface IngestResult {
  factsProcessed: number;
  entitiesCreated: number;
  relationsCreated: number;
  observationsAdded: number;
  errors: string[];
  duration: number;
}

export interface RetrievalResult {
  questionId: string;
  question: string;
  retrievedAnswer: string;
  retrievedEntities: string[];
  duration: number;
  error?: string;
}

export interface EvaluationResult {
  questionId: string;
  question: string;
  goldAnswer: string;
  retrievedAnswer: string;
  score: number;
  accuracy: number;
  completeness: number;
  notes: string;
  duration: number;
}

export interface BenchmarkReport {
  timestamp: string;
  config: {
    model: string;
    factsCount: number;
    questionsCount: number;
  };
  ingest: IngestResult;
  retrieval: RetrievalResult[];
  evaluation: {
    results: EvaluationResult[];
    summary: {
      totalScore: number;
      averageScore: number;
      averageAccuracy: number;
      averageCompleteness: number;
      totalQuestions: number;
      successfulQuestions: number;
      failedQuestions: number;
    };
  };
  performance: {
    totalDuration: number;
    ingestDuration: number;
    retrievalDuration: number;
    evaluationDuration: number;
  };
  apiStats: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    retries: number;
  };
}
