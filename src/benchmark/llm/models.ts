/**
 * LLM Model configurations with rate limits
 */
import type { ModelConfig } from '../types.js';

export const MODELS: Record<string, ModelConfig> = {
  'gemini-2.5-flash-lite': {
    name: 'gemini-2.5-flash-lite',
    apiEndpoint:
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
    rpm: 15, // Requests Per Minute
    tpm: 250000, // Tokens Per Minute
    rpd: 1000, // Requests Per Day
  },
  'gemma-3': {
    name: 'gemma-3',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemma-2-9b-it:generateContent',
    rpm: 30, // Requests Per Minute
    tpm: 15000, // Tokens Per Minute
    rpd: 14400, // Requests Per Day
  },
};

export function getModelConfig(modelName: string): ModelConfig {
  const config = MODELS[modelName];
  if (!config) {
    throw new Error(
      `Unknown model: ${modelName}. Available models: ${Object.keys(MODELS).join(', ')}`
    );
  }
  return config;
}

/**
 * Calculate maximum cycles per day based on model limits
 * @param modelName The model name
 * @param callsPerCycle Number of LLM calls in a single benchmark cycle
 * @returns Maximum number of cycles that can be run per day
 */
export function calculateMaxCyclesPerDay(modelName: string, callsPerCycle: number): number {
  const config = getModelConfig(modelName);
  return Math.floor(config.rpd / callsPerCycle);
}

/**
 * Validate that a benchmark can run the required number of cycles per day
 * @param modelName The model name
 * @param callsPerCycle Number of LLM calls in a single benchmark cycle
 * @param requiredCycles Minimum number of cycles needed per day (default: 4)
 * @throws Error if the model cannot support the required cycles
 */
export function validateCycleCapacity(
  modelName: string,
  callsPerCycle: number,
  requiredCycles: number = 4
): void {
  const maxCycles = calculateMaxCyclesPerDay(modelName, callsPerCycle);
  if (maxCycles < requiredCycles) {
    throw new Error(
      `Model ${modelName} cannot support ${requiredCycles} cycles/day with ${callsPerCycle} calls/cycle. ` +
        `Maximum possible: ${maxCycles} cycles/day. ` +
        `Please reduce the number of facts/questions in the dataset.`
    );
  }
}
