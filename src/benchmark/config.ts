/**
 * Configuration management for benchmark
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { BenchmarkConfig } from './types.js';

const DEFAULT_CONFIG_PATH = 'benchmark.config.json';

/**
 * Load benchmark configuration from file
 * @param configPath Path to config file (default: benchmark.config.json)
 * @returns Parsed configuration
 */
export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): BenchmarkConfig {
  try {
    const absolutePath = resolve(process.cwd(), configPath);
    const configContent = readFileSync(absolutePath, 'utf-8');
    const config = JSON.parse(configContent) as BenchmarkConfig;

    // Validate required fields
    validateConfig(config);

    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Configuration file not found: ${configPath}\n` +
          `Please create a benchmark.config.json file in the project root.\n` +
          `See benchmark.config.json.example for reference.`
      );
    }
    throw error;
  }
}

/**
 * Validate configuration
 */
function validateConfig(config: BenchmarkConfig): void {
  const errors: string[] = [];

  // Validate LLM config
  if (!config.llm) {
    errors.push('Missing "llm" configuration');
  } else {
    if (!config.llm.model) {
      errors.push('Missing "llm.model"');
    }
    if (!config.llm.apiKey) {
      errors.push('Missing "llm.apiKey"');
    }
    if (config.llm.apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
      errors.push('Please set a valid API key in "llm.apiKey"');
    }
    if (!['gemini-1.5-flash', 'gemma-3'].includes(config.llm.model)) {
      errors.push(
        `Invalid model "${config.llm.model}". Must be "gemini-1.5-flash" or "gemma-3"`
      );
    }
  }

  // Validate embedding config
  if (!config.embedding) {
    errors.push('Missing "embedding" configuration');
  } else {
    if (!config.embedding.openaiApiKey) {
      errors.push('Missing "embedding.openaiApiKey"');
    }
    if (config.embedding.openaiApiKey === 'YOUR_OPENAI_API_KEY_HERE') {
      errors.push('Please set a valid OpenAI API key in "embedding.openaiApiKey"');
    }
  }

  // Validate MCP config
  if (!config.mcp) {
    errors.push('Missing "mcp" configuration');
  } else {
    if (!config.mcp.serverPath) {
      errors.push('Missing "mcp.serverPath"');
    }
    if (!config.mcp.neo4jUri) {
      errors.push('Missing "mcp.neo4jUri"');
    }
    if (!config.mcp.neo4jUsername) {
      errors.push('Missing "mcp.neo4jUsername"');
    }
    if (!config.mcp.neo4jPassword) {
      errors.push('Missing "mcp.neo4jPassword"');
    }
    if (!config.mcp.neo4jDatabase) {
      errors.push('Missing "mcp.neo4jDatabase"');
    }
  }

  if (errors.length > 0) {
    throw new Error(
      'Invalid configuration:\n' + errors.map((e) => `  - ${e}`).join('\n')
    );
  }
}

/**
 * Get data file path from config
 */
export function getDataFilePath(config: BenchmarkConfig, type: 'facts' | 'questions'): string {
  const path =
    type === 'facts'
      ? config.benchmark?.factsFile || 'src/benchmark/data/facts.json'
      : config.benchmark?.questionsFile || 'src/benchmark/data/questions.json';

  return resolve(process.cwd(), path);
}
