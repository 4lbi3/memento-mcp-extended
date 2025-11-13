import type { KnowledgeGraphManager, Entity } from '../../../KnowledgeGraphManager.js';

/**
 * Handles the create_entities tool request
 * @param args The arguments for the tool request
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the result content
 */

export async function handleCreateEntities(
  args: Record<string, unknown>,
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await knowledgeGraphManager.createEntities(args.entities as Entity[]);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
