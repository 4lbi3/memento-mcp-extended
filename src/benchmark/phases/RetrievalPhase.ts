/**
 * Phase 2: Retrieval
 * Query Memento with questions and retrieve answers
 */
import type { LLMClient } from '../llm/LLMClient.js';
import type { MCPClient } from '../mcp/MCPClient.js';
import type { Question, RetrievalResult } from '../types.js';

const SYSTEM_PROMPT = `You have access to the Memento MCP knowledge graph memory system, which provides you with persistent memory capabilities.
Your memory tools are provided by Memento MCP, a sophisticated knowledge graph implementation.
When asked about past conversations or user information, always check the Memento MCP knowledge graph first.
You should use semantic_search to find relevant information in your memory when answering questions.
Store information in the same language as the user.

Your task is to answer questions using ONLY the information available in the Memento knowledge graph.
First, think about what you need to search for, then use semantic search to find relevant information.
Finally, provide a comprehensive answer based on what you found.

Format your response as follows:
SEARCH_QUERY: <what you will search for>
ANSWER: <your complete answer based on the retrieved information>

If you cannot find relevant information, say "I don't have enough information to answer this question."`;

export class RetrievalPhase {
  private llmClient: LLMClient;
  private mcpClient: MCPClient;

  constructor(llmClient: LLMClient, mcpClient: MCPClient) {
    this.llmClient = llmClient;
    this.mcpClient = mcpClient;
  }

  /**
   * Run the retrieval phase
   * @param questions Array of questions
   * @returns Array of retrieval results
   */
  async run(questions: Question[]): Promise<RetrievalResult[]> {
    const results: RetrievalResult[] = [];

    console.log(`\n[Retrieval Phase] Starting retrieval of ${questions.length} questions...`);

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      console.log(`[Retrieval Phase] Processing question ${i + 1}/${questions.length}: ${question.id}`);

      try {
        const result = await this.retrieveAnswer(question);
        results.push(result);
        console.log(`[Retrieval Phase] ✓ Retrieved answer in ${(result.duration / 1000).toFixed(2)}s`);
      } catch (error) {
        const errorMsg = (error as Error).message;
        results.push({
          questionId: question.id,
          question: question.question,
          retrievedAnswer: '',
          retrievedEntities: [],
          duration: 0,
          error: errorMsg,
        });
        console.error(`[Retrieval Phase] ✗ Failed: ${errorMsg}`);
      }

      // Small delay between questions
      if (i < questions.length - 1) {
        await this.sleep(500);
      }
    }

    console.log(`[Retrieval Phase] Completed ${results.length} retrievals`);
    return results;
  }

  /**
   * Retrieve answer for a single question
   */
  private async retrieveAnswer(question: Question): Promise<RetrievalResult> {
    const startTime = Date.now();

    // Step 1: Ask LLM to formulate search query and answer
    const userPrompt = `Question: ${question.question}

Please search the Memento knowledge graph for relevant information and provide an answer.`;

    const response = await this.llmClient.prompt(SYSTEM_PROMPT, userPrompt, 600);

    // Step 2: Extract search query from LLM response
    const searchQuery = this.extractSearchQuery(response.content);

    // Step 3: Perform semantic search
    const searchResults = await this.mcpClient.semanticSearch(searchQuery, {
      limit: 10,
      minSimilarity: 0.5,
      hybridSearch: true,
    });

    // Step 4: Ask LLM to synthesize answer based on search results
    const contextPrompt = `Based on the following information from the knowledge graph, answer this question:

Question: ${question.question}

Retrieved Information:
${this.formatSearchResults(searchResults)}

Provide a clear, concise answer based ONLY on the information above.`;

    const answerResponse = await this.llmClient.prompt(
      'You are a helpful assistant that answers questions based on provided context.',
      contextPrompt,
      800
    );

    return {
      questionId: question.id,
      question: question.question,
      retrievedAnswer: this.extractAnswer(answerResponse.content),
      retrievedEntities: searchResults.entities.map((e) => e.name),
      duration: Date.now() - startTime,
    };
  }

  /**
   * Extract search query from LLM response
   */
  private extractSearchQuery(content: string): string {
    const match = content.match(/SEARCH_QUERY:\s*(.+?)(?:\n|$)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    // If no explicit search query, use first sentence or first 100 chars
    const firstLine = content.split('\n')[0];
    return firstLine.slice(0, 100).trim();
  }

  /**
   * Extract answer from LLM response
   */
  private extractAnswer(content: string): string {
    const match = content.match(/ANSWER:\s*([\s\S]+)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    return content.trim();
  }

  /**
   * Format search results for LLM context
   */
  private formatSearchResults(searchResults: {
    entities: Array<{
      name: string;
      entityType: string;
      observations: string[];
      similarity?: number;
    }>;
    relations: Array<{
      from: string;
      to: string;
      relationType: string;
    }>;
  }): string {
    let formatted = '';

    // Format entities
    if (searchResults.entities.length > 0) {
      formatted += 'Entities:\n';
      for (const entity of searchResults.entities) {
        formatted += `- ${entity.name} (${entity.entityType}):\n`;
        for (const obs of entity.observations) {
          formatted += `  * ${obs}\n`;
        }
      }
    }

    // Format relations
    if (searchResults.relations.length > 0) {
      formatted += '\nRelations:\n';
      for (const rel of searchResults.relations) {
        formatted += `- ${rel.from} ${rel.relationType} ${rel.to}\n`;
      }
    }

    return formatted || 'No relevant information found.';
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
