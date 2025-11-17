/**
 * Test file for the listToolsHandler module
 * Migrated from Jest to Vitest and converted to TypeScript
 */
import { describe, test, expect } from 'vitest';
import { handleListToolsRequest } from '../listToolsHandler.js';
import type { StorageProvider } from '../../../storage/StorageProvider.js';

describe('handleListToolsRequest', () => {
  test('should return a list of available tools', async () => {
    // Act
    const result = await handleListToolsRequest();

    // Assert
    expect(result).toBeDefined();
    expect(result.tools).toBeDefined();
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBeGreaterThan(0);

    // Check that each tool has the required properties
    result.tools.forEach((tool) => {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe('string');
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
    });

    // Check if specific tools are present
    const toolNames = result.tools.map((tool) => tool.name);
    expect(toolNames).toContain('create_entities');
    expect(toolNames).toContain('read_graph');
    expect(toolNames).toContain('search_nodes');
  });

  test('should include temporal tools when provider supports temporal capability', async () => {
    const temporalProvider = {
      getEntityHistory: () => Promise.resolve([]),
      getRelationHistory: () => Promise.resolve([]),
      getGraphAtTime: () => Promise.resolve({ entities: [], relations: [] }),
      getDecayedGraph: () => Promise.resolve({ entities: [], relations: [] }),
    } as StorageProvider;

    const result = await handleListToolsRequest(temporalProvider);
    const toolNames = result.tools.map((tool) => tool.name);
    expect(toolNames).toContain('get_entity_history');
    expect(toolNames).toContain('get_relation_history');
    expect(toolNames).toContain('get_graph_at_time');
    expect(toolNames).toContain('get_decayed_graph');
  });

  test('should include purge tools when provider supports purge capability', async () => {
    const purgeProvider = {
      purgeArchivedEntities: () => Promise.resolve(0),
      purgeArchivedRelations: () => Promise.resolve(0),
    } as StorageProvider;

    const result = await handleListToolsRequest(purgeProvider);
    const toolNames = result.tools.map((tool) => tool.name);
    expect(toolNames).toContain('purge_archived_entities');
    expect(toolNames).toContain('purge_archived_relations');
  });
});
