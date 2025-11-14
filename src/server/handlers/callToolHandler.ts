import * as toolHandlers from './toolHandlers/index.js';
import type { KnowledgeGraphManager, Relation } from '../../KnowledgeGraphManager.js';
import { gatherDebugEmbeddingConfig } from '../../diagnostics/debugEmbeddingConfig.js';
import { formatKnowledgeGraphForDisplay } from './utils/graphFormatter.js';

/**
 * Handles the CallTool request.
 * Delegates to the appropriate tool handler based on the tool name.
 *
 * @param request The CallTool request object
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the result content
 * @throws Error if the tool is unknown or arguments are missing
 */

export async function handleCallToolRequest(
  request: { params?: { name?: string; arguments?: Record<string, unknown> } },
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!request) {
    throw new Error('Invalid request: request is null or undefined');
  }

  if (!request.params) {
    throw new Error('Invalid request: missing params');
  }

  const { name, arguments: args } = request.params;

  if (!name) {
    throw new Error('Invalid request: missing tool name');
  }

  if (!args) {
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  try {
    switch (name) {
      case 'create_entities':
        return await toolHandlers.handleCreateEntities(args, knowledgeGraphManager);

      case 'read_graph':
        return await toolHandlers.handleReadGraph(args, knowledgeGraphManager);

      case 'create_relations':
        return await toolHandlers.handleCreateRelations(args, knowledgeGraphManager);

      case 'add_observations':
        return await toolHandlers.handleAddObservations(args, knowledgeGraphManager);

      case 'delete_entities':
        return await toolHandlers.handleDeleteEntities(args, knowledgeGraphManager);

      case 'delete_observations':
        await knowledgeGraphManager.deleteObservations(
          args.deletions as Array<{ entityName: string; observations: string[] }>
        );
        return { content: [{ type: 'text', text: 'Observations deleted successfully' }] };

      case 'delete_relations':
        await knowledgeGraphManager.deleteRelations(args.relations as Relation[]);
        return { content: [{ type: 'text', text: 'Relations deleted successfully' }] };

      case 'get_relation':
        const relation = await knowledgeGraphManager.getRelation(
          String(args.from),
          String(args.to),
          String(args.relationType)
        );
        if (!relation) {
          return {
            content: [
              {
                type: 'text',
                text: `Relation not found: ${args.from} -> ${args.relationType} -> ${args.to}`,
              },
            ],
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(relation, null, 2) }] };

      case 'update_relation':
        await knowledgeGraphManager.updateRelation(args.relation as Relation);
        return { content: [{ type: 'text', text: 'Relation updated successfully' }] };

      case 'search_nodes':
        return {
          content: [
            {
              type: 'text',
              text: formatKnowledgeGraphForDisplay(
                await knowledgeGraphManager.searchNodes(String(args.query))
              ),
            },
          ],
        };

      case 'open_nodes':
        return {
          content: [
            {
              type: 'text',
              text: formatKnowledgeGraphForDisplay(
                await knowledgeGraphManager.openNodes(args.names as string[])
              ),
            },
          ],
        };

      case 'get_entity_history':
        try {
          const history = await knowledgeGraphManager.getEntityHistory(String(args.entityName));
          return { content: [{ type: 'text', text: JSON.stringify(history, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error retrieving entity history: ${errorMessage}` }],
          };
        }

      case 'get_relation_history':
        try {
          const history = await knowledgeGraphManager.getRelationHistory(
            String(args.from),
            String(args.to),
            String(args.relationType)
          );
          return { content: [{ type: 'text', text: JSON.stringify(history, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error retrieving relation history: ${errorMessage}` }],
          };
        }

      case 'get_graph_at_time':
        try {
          const graph = await knowledgeGraphManager.getGraphAtTime(Number(args.timestamp));
          return { content: [{ type: 'text', text: JSON.stringify(graph, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error retrieving graph at time: ${errorMessage}` }],
          };
        }

      case 'get_decayed_graph':
        try {
          // NOTE: getDecayedGraph currently does not accept parameters
          // The reference_time and decay_factor arguments are ignored for now
          const graph = await knowledgeGraphManager.getDecayedGraph();

          return { content: [{ type: 'text', text: JSON.stringify(graph, null, 2) }] };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error retrieving decayed graph: ${errorMessage}` }],
          };
        }

      case 'force_generate_embedding': {
        try {
          const kgmAny = knowledgeGraphManager as any;
          const embeddingJobManager = kgmAny.embeddingJobManager;

          if (!embeddingJobManager) {
            process.stderr.write(`[ERROR] EmbeddingJobManager not initialized\n`);
            throw new Error('EmbeddingJobManager not initialized');
          }

          const entityNameArg =
            args.entity_name !== undefined && args.entity_name !== null
              ? String(args.entity_name).trim()
              : '';
          const hasEntityName = entityNameArg.length > 0;
          const requestedLimitNumber = Number(args.limit);
          const batchLimit =
            Number.isFinite(requestedLimitNumber) && requestedLimitNumber > 0
              ? Math.floor(requestedLimitNumber)
              : 10;

          process.stderr.write(
            `[DEBUG] Force generating embedding tool invoked. mode=${
              hasEntityName ? 'specific' : 'batch'
            }, entityName=${entityNameArg || 'n/a'}, limit=${args.limit ?? 'default'}\n`
          );

          if (hasEntityName) {
            process.stderr.write(
              `[DEBUG] Mode 1: forcing embedding for entity ${entityNameArg}\n`
            );

            if (
              !kgmAny.storageProvider ||
              typeof kgmAny.storageProvider.getEntity !== 'function'
            ) {
              throw new Error(
                'Storage provider must implement getEntity() for specific force mode'
              );
            }

            const entity = await kgmAny.storageProvider.getEntity(entityNameArg);
            if (!entity) {
              process.stderr.write(
                `[ERROR] Entity not found: ${entityNameArg}\n`
              );
              throw new Error(`Entity not found: ${entityNameArg}`);
            }

            const jobId = await embeddingJobManager.scheduleEntityEmbedding(entity.name);
            process.stderr.write(
              `[DEBUG] Scheduled embedding job for ${entity.name} (jobId=${jobId ?? 'existing'})\n`
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      mode: 'specific',
                      entity: entity.name,
                      job_id: jobId,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          process.stderr.write(
            `[DEBUG] Mode 2: batch repair, discovering up to ${batchLimit} entities without embeddings\n`
          );

          if (
            !kgmAny.storageProvider ||
            typeof kgmAny.storageProvider.getEntitiesWithoutEmbeddings !== 'function'
          ) {
            throw new Error(
              'Storage provider does not support discovering entities without embeddings'
            );
          }

          const entitiesWithoutEmbeddings = await kgmAny.storageProvider.getEntitiesWithoutEmbeddings(
            batchLimit
          );

          if (!entitiesWithoutEmbeddings || entitiesWithoutEmbeddings.length === 0) {
            process.stderr.write(`[DEBUG] No entities found without embeddings\n`);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      mode: 'batch',
                      discovered: 0,
                      limit: batchLimit,
                      message: 'No entities without embeddings were found',
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          const jobResults: Array<{
            entity: string;
            jobId: string | null;
            status: 'scheduled' | 'already queued' | 'error';
            error?: string;
          }> = [];

          for (const entity of entitiesWithoutEmbeddings) {
            try {
              const jobId = await embeddingJobManager.scheduleEntityEmbedding(entity.name);
              jobResults.push({
                entity: entity.name,
                jobId: jobId ?? null,
                status: jobId ? 'scheduled' : 'already queued',
              });
            } catch (jobError: unknown) {
              const errorMessage =
                jobError instanceof Error ? jobError.message : String(jobError ?? 'unknown error');
              process.stderr.write(
                `[ERROR] Failed to schedule embedding for ${entity.name}: ${errorMessage}\n`
              );
              jobResults.push({
                entity: entity.name,
                jobId: null,
                status: 'error',
                error: errorMessage,
              });
            }
          }

          const queuedCount = jobResults.filter((result) => result.status !== 'error').length;
          const failedCount = jobResults.filter((result) => result.status === 'error').length;
          const newlyScheduledCount = jobResults.filter((result) => result.status === 'scheduled')
            .length;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: failedCount === 0,
                    mode: 'batch',
                    limit: batchLimit,
                    discovered: entitiesWithoutEmbeddings.length,
                    queued: queuedCount,
                    newly_scheduled: newlyScheduledCount,
                    failed: failedCount,
                    jobs: jobResults,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error: any) {
          process.stderr.write(`[ERROR] Failed to force generate embedding: ${error.message}\n`);
          if (error.stack) {
            process.stderr.write(`[ERROR] Stack trace: ${error.stack}\n`);
          }
          return {
            content: [{ type: 'text', text: `Failed to generate embedding: ${error.message}` }],
          };
        }
      }

      case 'semantic_search':
        try {
          // Extract search options from args
          const searchOptions = {
            limit: Number(args.limit) || 10,
            minSimilarity: Number(args.min_similarity) || 0.6,
            entityTypes: (args.entity_types as string[]) || [],
            hybridSearch: args.hybrid_search !== undefined ? Boolean(args.hybrid_search) : true,
            semanticWeight: Number(args.semantic_weight) || 0.6,
            semanticSearch: true,
          };

          // Call the search method with semantic search options
          const results = await knowledgeGraphManager.search(String(args.query), searchOptions);

          return {
            content: [{ type: 'text', text: formatKnowledgeGraphForDisplay(results) }],
          };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error performing semantic search: ${errorMessage}` }],
          };
        }

      case 'get_entity_embedding':
        try {
          // NOTE: This diagnostic tool accesses private KnowledgeGraphManager internals
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const kgmAny = knowledgeGraphManager as any;

          // Check if entity exists
          const entity = await knowledgeGraphManager.openNodes([String(args.entity_name)]);
          if (!entity.entities || entity.entities.length === 0) {
            return { content: [{ type: 'text', text: `Entity not found: ${args.entity_name}` }] };
          }

          // Access the embedding using appropriate interface
          if (
            kgmAny.storageProvider &&
            typeof kgmAny.storageProvider.getEntityEmbedding === 'function'
          ) {
            type EntityEmbedding = {
              vector: number[];
              model?: string;
              lastUpdated?: number;
            };

            const embedding: EntityEmbedding | null = await kgmAny.storageProvider.getEntityEmbedding(
              String(args.entity_name)
            );

            if (!embedding) {
              return {
                content: [
                  { type: 'text', text: `No embedding found for entity: ${args.entity_name}` },
                ],
              };
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      entityName: args.entity_name,
                      embedding: embedding.vector,
                      model: embedding.model || 'unknown',
                      dimensions: embedding.vector ? embedding.vector.length : 0,
                      lastUpdated: embedding.lastUpdated || Date.now(),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: `Embedding retrieval not supported by this storage provider`,
                },
              ],
            };
          }
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error retrieving entity embedding: ${errorMessage}` }],
          };
        }

      case 'debug_embedding_config':
        try {
          const diagnosticInfo = await gatherDebugEmbeddingConfig(knowledgeGraphManager);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(diagnosticInfo, null, 2),
              },
            ],
          };
        } catch (error: Error | unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          process.stderr.write(`[ERROR] Error in debug_embedding_config: ${errorMessage}\n`);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: errorMessage,
                    stack: errorStack,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

      case 'diagnose_vector_search':
        // NOTE: This diagnostic tool accesses private KnowledgeGraphManager internals
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kgmAnyDiagnose = knowledgeGraphManager as any;

        if (
          kgmAnyDiagnose.storageProvider &&
          typeof kgmAnyDiagnose.storageProvider.diagnoseVectorSearch === 'function'
        ) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(await kgmAnyDiagnose.storageProvider.diagnoseVectorSearch()),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: 'Diagnostic method not available',
                    storageType: kgmAnyDiagnose.storageProvider
                      ? kgmAnyDiagnose.storageProvider.constructor.name
                      : 'unknown',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: Error | unknown) {
    throw error;
  }
}
