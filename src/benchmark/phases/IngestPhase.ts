/**
 * Phase 1: Ingest
 * Load facts and use LLM to interpret and store them in Memento
 */
import type { LLMClient } from '../llm/LLMClient.js';
import type { MCPClient } from '../mcp/MCPClient.js';
import type { Fact, IngestResult, Entity, Relation } from '../types.js';

const SYSTEM_PROMPT = `You have access to the Memento MCP knowledge graph memory system, which provides you with persistent memory capabilities.
Your memory tools are provided by Memento MCP, a sophisticated knowledge graph implementation.
When asked about past conversations or user information, always check the Memento MCP knowledge graph first.
You should use semantic_search to find relevant information in your memory when answering questions.
Store information in the same language as the user.

Your task is to analyze facts and extract structured information to store in the knowledge graph.
For each fact, identify:
1. Entities (people, places, things, concepts) with their types
2. Observations (detailed facts about each entity)
3. Relations between entities

Return your response in the following JSON format:
{
  "entities": [
    {
      "name": "entity name",
      "entityType": "type of entity (person, place, concept, etc.)",
      "observations": ["observation 1", "observation 2"]
    }
  ],
  "relations": [
    {
      "from": "entity name",
      "to": "entity name",
      "relationType": "type of relation (works_at, located_in, etc.)"
    }
  ]
}

IMPORTANT: Return ONLY valid JSON, no additional text or explanations.`;

export class IngestPhase {
  private llmClient: LLMClient;
  private mcpClient: MCPClient;

  constructor(llmClient: LLMClient, mcpClient: MCPClient) {
    this.llmClient = llmClient;
    this.mcpClient = mcpClient;
  }

  /**
   * Run the ingest phase
   * @param facts Array of facts to ingest
   * @returns Ingest results
   */
  async run(facts: Fact[]): Promise<IngestResult> {
    const startTime = Date.now();
    const result: IngestResult = {
      factsProcessed: 0,
      entitiesCreated: 0,
      relationsCreated: 0,
      observationsAdded: 0,
      errors: [],
      duration: 0,
    };

    console.log(`\n[Ingest Phase] Starting ingest of ${facts.length} facts...`);

    // Process facts in batches to avoid overwhelming the system
    const batchSize = 3;
    for (let i = 0; i < facts.length; i += batchSize) {
      const batch = facts.slice(i, i + batchSize);
      console.log(`[Ingest Phase] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(facts.length / batchSize)}...`);

      for (const fact of batch) {
        try {
          await this.processFact(fact, result);
          result.factsProcessed++;
          console.log(`[Ingest Phase] ✓ Processed fact ${result.factsProcessed}/${facts.length}: ${fact.id}`);
        } catch (error) {
          const errorMsg = `Failed to process fact ${fact.id}: ${(error as Error).message}`;
          result.errors.push(errorMsg);
          console.error(`[Ingest Phase] ✗ ${errorMsg}`);
        }
      }

      // Small delay between batches to respect rate limits
      if (i + batchSize < facts.length) {
        await this.sleep(1000);
      }
    }

    result.duration = Date.now() - startTime;
    console.log(`[Ingest Phase] Completed in ${(result.duration / 1000).toFixed(2)}s`);
    console.log(`[Ingest Phase] Stats: ${result.entitiesCreated} entities, ${result.relationsCreated} relations, ${result.observationsAdded} observations`);

    return result;
  }

  /**
   * Process a single fact
   */
  private async processFact(fact: Fact, result: IngestResult): Promise<void> {
    // Ask LLM to extract structured information from the fact
    const userPrompt = `Analyze this fact and extract entities, observations, and relations:\n\n"${fact.content}"\n\nReturn only valid JSON.`;

    const response = await this.llmClient.prompt(SYSTEM_PROMPT, userPrompt, 800);

    // Parse LLM response
    const structured = this.parseStructuredData(response.content);

    // Store entities if any
    if (structured.entities && structured.entities.length > 0) {
      await this.mcpClient.createEntities(structured.entities);
      result.entitiesCreated += structured.entities.length;
      result.observationsAdded += structured.entities.reduce(
        (sum, e) => sum + (e.observations?.length || 0),
        0
      );
    }

    // Store relations if any
    if (structured.relations && structured.relations.length > 0) {
      await this.mcpClient.createRelations(structured.relations);
      result.relationsCreated += structured.relations.length;
    }
  }

  /**
   * Parse structured data from LLM response
   */
  private parseStructuredData(content: string): {
    entities: Entity[];
    relations: Relation[];
  } {
    try {
      // Try to extract JSON from the response
      // Sometimes LLM adds extra text before/after JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      };
    } catch (error) {
      console.error('[IngestPhase] Failed to parse LLM response:', content);
      throw new Error(`Failed to parse structured data: ${(error as Error).message}`);
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
