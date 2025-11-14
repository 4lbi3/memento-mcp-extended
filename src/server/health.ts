import http from 'node:http';
import { logger } from '../utils/logger.js';
import type {
  Neo4jEmbeddingJobManager,
  HealthStatus,
} from '../embeddings/Neo4jEmbeddingJobManager.js';

const DEFAULT_HEALTH_PORT = 3001;
const HEALTH_PATH = '/health';

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface HealthServerOptions {
  port?: number;
  path?: string;
}

export function startHealthServer(
  manager: Neo4jEmbeddingJobManager | undefined,
  options: HealthServerOptions = {}
): http.Server {
  const port = options.port ?? parsePositiveNumber(process.env.HEALTH_PORT, DEFAULT_HEALTH_PORT);
  const path = options.path ?? HEALTH_PATH;

  const server = http.createServer(async (req, res) => {
    const requestPath = req.url?.split('?')[0] || '';
    if (requestPath !== path) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    res.setHeader('Content-Type', 'application/json');

    if (!manager) {
      res.writeHead(503);
      res.end(
        JSON.stringify({
          status: 'UNAVAILABLE',
          reason: 'Embedding job manager is not initialized',
        })
      );
      return;
    }

    try {
      const health: HealthStatus = manager.getHealthStatus();
      const statusCode = health.state === 'HEALTHY' ? 200 : 503;
      res.writeHead(statusCode);
      res.end(JSON.stringify(health));
    } catch (error: unknown) {
      logger.error('Failed to evaluate health status', error);
      res.writeHead(500);
      res.end(
        JSON.stringify({
          status: 'ERROR',
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  });

  server.listen(port, () => {
    logger.info('Health endpoint listening', { port, path });
  });

  server.on('error', (error) => {
    logger.error('Health server encountered an error', error);
  });

  return server;
}
