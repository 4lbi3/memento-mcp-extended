import type { KnowledgeGraphManager } from '../../../KnowledgeGraphManager.js';

/**
 * Handles the delete_entities tool request
 * @param args The arguments for the tool request
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the success message
 */

export async function handleDeleteEntities(
  args: Record<string, unknown>,
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<{ content: Array<{ type: string; text: string }> }> {
  await knowledgeGraphManager.deleteEntities(args.entityNames as string[]);
  return {
    content: [
      {
        type: 'text',
        text: 'Entities deleted successfully',
      },
    ],
  };
}
