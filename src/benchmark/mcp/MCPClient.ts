/**
 * MCP Client for benchmark
 * Simulates human interaction with Memento MCP tools
 */
import type { KnowledgeGraphManager } from '../../KnowledgeGraphManager.js';
import type { Entity, Relation } from '../types.js';

export interface MCPToolCall {
  tool: string;
  arguments: Record<string, unknown>;
  duration: number;
  success: boolean;
  error?: string;
}

export class MCPClient {
  private knowledgeGraphManager: KnowledgeGraphManager;
  private toolCalls: MCPToolCall[] = [];

  constructor(knowledgeGraphManager: KnowledgeGraphManager) {
    this.knowledgeGraphManager = knowledgeGraphManager;
  }

  /**
   * Create entities in the knowledge graph
   */
  async createEntities(entities: Entity[]): Promise<void> {
    const startTime = Date.now();
    try {
      await this.knowledgeGraphManager.createEntities(entities);
      this.recordToolCall('create_entities', { entities }, Date.now() - startTime, true);
    } catch (error) {
      this.recordToolCall(
        'create_entities',
        { entities },
        Date.now() - startTime,
        false,
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Create relations in the knowledge graph
   */
  async createRelations(relations: Relation[]): Promise<void> {
    const startTime = Date.now();
    try {
      // Convert our Relation type to KnowledgeGraphManager's Relation type
      const kgRelations = relations.map((r) => ({
        from: r.from,
        to: r.to,
        relationType: r.relationType,
      }));
      await this.knowledgeGraphManager.createRelations(kgRelations);
      this.recordToolCall('create_relations', { relations }, Date.now() - startTime, true);
    } catch (error) {
      this.recordToolCall(
        'create_relations',
        { relations },
        Date.now() - startTime,
        false,
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Add observations to existing entities
   */
  async addObservations(observations: Array<{ entityName: string; contents: string[] }>): Promise<void> {
    const startTime = Date.now();
    try {
      await this.knowledgeGraphManager.addObservations(observations);
      this.recordToolCall('add_observations', { observations }, Date.now() - startTime, true);
    } catch (error) {
      this.recordToolCall(
        'add_observations',
        { observations },
        Date.now() - startTime,
        false,
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Perform semantic search
   */
  async semanticSearch(
    query: string,
    options?: {
      limit?: number;
      minSimilarity?: number;
      entityTypes?: string[];
      hybridSearch?: boolean;
      semanticWeight?: number;
    }
  ): Promise<{
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
  }> {
    const startTime = Date.now();
    try {
      const searchOptions = {
        limit: options?.limit || 10,
        minSimilarity: options?.minSimilarity || 0.6,
        entityTypes: options?.entityTypes || [],
        hybridSearch: options?.hybridSearch !== undefined ? options.hybridSearch : true,
        semanticWeight: options?.semanticWeight || 0.6,
        semanticSearch: true,
      };

      const result = await this.knowledgeGraphManager.search(query, searchOptions);
      this.recordToolCall(
        'semantic_search',
        { query, ...options },
        Date.now() - startTime,
        true
      );
      return result;
    } catch (error) {
      this.recordToolCall(
        'semantic_search',
        { query, ...options },
        Date.now() - startTime,
        false,
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Search nodes by query string
   */
  async searchNodes(query: string): Promise<{
    entities: Array<{
      name: string;
      entityType: string;
      observations: string[];
    }>;
    relations: Array<{
      from: string;
      to: string;
      relationType: string;
    }>;
  }> {
    const startTime = Date.now();
    try {
      const result = await this.knowledgeGraphManager.searchNodes(query);
      this.recordToolCall('search_nodes', { query }, Date.now() - startTime, true);
      return result;
    } catch (error) {
      this.recordToolCall(
        'search_nodes',
        { query },
        Date.now() - startTime,
        false,
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Open specific nodes by name
   */
  async openNodes(names: string[]): Promise<{
    entities: Array<{
      name: string;
      entityType: string;
      observations: string[];
    }>;
    relations: Array<{
      from: string;
      to: string;
      relationType: string;
    }>;
  }> {
    const startTime = Date.now();
    try {
      const result = await this.knowledgeGraphManager.openNodes(names);
      this.recordToolCall('open_nodes', { names }, Date.now() - startTime, true);
      return result;
    } catch (error) {
      this.recordToolCall(
        'open_nodes',
        { names },
        Date.now() - startTime,
        false,
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Read entire graph
   */
  async readGraph(): Promise<{
    entities: Array<{
      name: string;
      entityType: string;
      observations: string[];
    }>;
    relations: Array<{
      from: string;
      to: string;
      relationType: string;
    }>;
  }> {
    const startTime = Date.now();
    try {
      const result = await this.knowledgeGraphManager.readGraph();
      this.recordToolCall('read_graph', {}, Date.now() - startTime, true);
      return result;
    } catch (error) {
      this.recordToolCall(
        'read_graph',
        {},
        Date.now() - startTime,
        false,
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Delete all entities (for cleanup between benchmark runs)
   */
  async deleteAllEntities(): Promise<void> {
    const startTime = Date.now();
    try {
      const graph = await this.knowledgeGraphManager.readGraph();
      const entityNames = graph.entities.map((e) => e.name);
      if (entityNames.length > 0) {
        await this.knowledgeGraphManager.deleteEntities(entityNames);
      }
      this.recordToolCall('delete_entities', { entityNames }, Date.now() - startTime, true);
    } catch (error) {
      this.recordToolCall(
        'delete_entities',
        {},
        Date.now() - startTime,
        false,
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Record a tool call for statistics
   */
  private recordToolCall(
    tool: string,
    args: Record<string, unknown>,
    duration: number,
    success: boolean,
    error?: string
  ): void {
    this.toolCalls.push({
      tool,
      arguments: args,
      duration,
      success,
      error,
    });
  }

  /**
   * Get all tool calls
   */
  getToolCalls(): MCPToolCall[] {
    return [...this.toolCalls];
  }

  /**
   * Reset tool call history
   */
  resetToolCalls(): void {
    this.toolCalls = [];
  }
}
