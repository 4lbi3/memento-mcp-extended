import type { KnowledgeGraphManager } from '../../../KnowledgeGraphManager.js';
import { formatKnowledgeGraphForDisplay } from '../utils/graphFormatter.js';

/**
 * Handles the read_graph tool request
 * @param args The arguments for the tool request
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the result content
 */

export async function handleReadGraph(
  args: Record<string, unknown>,
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await knowledgeGraphManager.readGraph();
  return {
    content: [
      {
        type: 'text',
        text: formatKnowledgeGraphForDisplay(result),
      },
    ],
  };
}
