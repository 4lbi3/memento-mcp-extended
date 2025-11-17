import type { KnowledgeGraphManager } from '../../../KnowledgeGraphManager.js';

type AddObservationsArgs = {
  observations?: unknown;
  strength?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

type ObservationInput = {
  entityName?: unknown;
  contents?: unknown;
  strength?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Handles the add_observations tool request
 * @param args The arguments for the tool request
 * @param knowledgeGraphManager The KnowledgeGraphManager instance
 * @returns A response object with the result content
 */

export async function handleAddObservations(
  args: AddObservationsArgs,
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    // Enhanced logging for debugging
    process.stderr.write(`[DEBUG] addObservations handler called at ${new Date().toISOString()}\n`);
    process.stderr.write(`[DEBUG] FULL ARGS: ${JSON.stringify(args, null, 2)}\n`);
    process.stderr.write(`[DEBUG] ARGS KEYS: ${Object.keys(args).join(', ')}\n`);
    process.stderr.write(
      `[DEBUG] ARGS TYPES: ${Object.keys(args)
        .map((k) => `${k}: ${typeof args[k]}`)
        .join(', ')}\n`
    );

    if (!args.observations || !Array.isArray(args.observations)) {
      throw new Error('Invalid observations: must be an array');
    }

    const defaultStrength = 0.9;
    const defaultConfidence = 0.95;

    const normalizedStrength = typeof args.strength === 'number' ? args.strength : defaultStrength;
    if (args.strength === undefined) {
      process.stderr.write(`[DEBUG] Adding default strength value: ${normalizedStrength}\n`);
      args.strength = normalizedStrength;
    }

    const metadataFallback: Record<string, unknown> =
      args.metadata && isPlainObject(args.metadata) ? args.metadata : { source: 'API call' };

    const processedObservations = args.observations.map((rawObservation) => {
      if (!isPlainObject(rawObservation)) {
        throw new Error('Each observation must be an object containing required fields');
      }

      const observation = rawObservation as ObservationInput;

      if (typeof observation.entityName !== 'string' || observation.entityName.trim() === '') {
        throw new Error('Missing required parameter: entityName');
      }

      if (
        !Array.isArray(observation.contents) ||
        observation.contents.some((item) => typeof item !== 'string')
      ) {
        throw new Error('Missing required parameter: contents (must be an array of strings)');
      }

      const obsStrength =
        typeof observation.strength === 'number' ? observation.strength : normalizedStrength;

      const obsConfidence =
        typeof observation.confidence === 'number'
          ? observation.confidence
          : typeof args.confidence === 'number'
            ? args.confidence
            : defaultConfidence;

      const obsMetadata =
        observation.metadata && isPlainObject(observation.metadata)
          ? observation.metadata
          : metadataFallback;

      process.stderr.write(
        `[DEBUG] Processing observation for ${observation.entityName}, using strength: ${obsStrength}\n`
      );

      return {
        entityName: observation.entityName,
        contents: observation.contents,
        strength: obsStrength,
        confidence: obsConfidence,
        metadata: obsMetadata,
      };
    });

    // Call knowledgeGraphManager
    process.stderr.write(
      `[DEBUG] Calling knowledgeGraphManager.addObservations with ${processedObservations.length} observations\n`
    );
    process.stderr.write(`[DEBUG] PROCESSED: ${JSON.stringify(processedObservations, null, 2)}\n`);

    const result = await knowledgeGraphManager.addObservations(processedObservations);

    process.stderr.write(`[DEBUG] addObservations result: ${JSON.stringify(result, null, 2)}\n`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              result,
              debug: {
                timestamp: Date.now(),
                input_args: args,
                processed_observations: processedObservations,
                tool_version: 'v2 with debug info',
              },
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: unknown) {
    const err =
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : 'Unknown error');
    // Enhanced error logging for debugging
    process.stderr.write(`[ERROR] addObservations error: ${err.message}\n`);
    process.stderr.write(`[ERROR] Stack trace: ${err.stack || 'No stack trace available'}\n`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: err.message,
              debug: {
                timestamp: Date.now(),
                input_args: args || 'No args available',
                error_type: err.constructor.name,
                error_stack: err.stack?.split('\n') || 'No stack trace',
                tool_version: 'v2 with debug info',
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
