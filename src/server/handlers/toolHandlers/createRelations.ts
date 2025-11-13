import type { KnowledgeGraphManager, Relation } from '../../../KnowledgeGraphManager.js';

/**
 * Handles the create_relations tool request
 * @param args The arguments for the tool request
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the result content
 */

export async function handleCreateRelations(
  args: Record<string, unknown>,
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await knowledgeGraphManager.createRelations(args.relations as Relation[]);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
