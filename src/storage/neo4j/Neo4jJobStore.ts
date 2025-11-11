import type { Neo4jConnectionManager } from './Neo4jConnectionManager.js';
import { logger } from '../../utils/logger.js';

/**
 * Job status type
 */
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Interface for an embedding job record
 */
export interface EmbedJob {
  id: string;
  entity_uid: string;
  model: string;
  version: string;
  status: JobStatus;
  priority: number;
  created_at: number;
  processed_at?: number;
  lock_owner?: string;
  lock_until?: number;
  error?: string;
  attempts: number;
  max_attempts: number;
}

/**
 * Interface for job enqueuing parameters
 */
export interface EnqueueJobParams {
  entity_uid: string;
  model: string;
  version: string;
  priority?: number;
  max_attempts?: number;
}

/**
 * Interface for leased job information
 */
export interface LeasedJob extends EmbedJob {
  lock_owner: string;
  lock_until: number;
}

/**
 * Interface for job processing results
 */
export interface JobProcessResults {
  processed: number;
  successful: number;
  failed: number;
}

/**
 * Interface for queue status
 */
export interface QueueStatus {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalJobs: number;
}

/**
 * Neo4j-backed job store for embedding jobs
 */
export class Neo4jJobStore {
  private connectionManager: Neo4jConnectionManager;
  private debug: boolean;

  /**
   * Creates a new Neo4j job store
   * @param connectionManager A Neo4j connection manager instance
   * @param debug Whether to enable debug logging (defaults to true)
   */
  constructor(connectionManager: Neo4jConnectionManager, debug = true) {
    this.connectionManager = connectionManager;
    this.debug = debug;
  }

  /**
   * Log debug messages if debug mode is enabled
   * @param message Debug message to log
   */
  private log(message: string): void {
    if (this.debug) {
      logger.debug(`[Neo4jJobStore] ${message}`);
    }
  }

  /**
   * Enqueue a new embedding job, preventing duplicates based on entity_uid, model, and version
   *
   * @param params Job parameters
   * @returns Job ID if created, null if job already exists
   */
  async enqueueJob(params: EnqueueJobParams): Promise<string | null> {
    const { entity_uid, model, version, priority = 1, max_attempts = 3 } = params;

    this.log(`Enqueuing job for entity ${entity_uid}, model ${model}, version ${version}`);

    const query = `
      MERGE (job:EmbedJob {
        entity_uid: $entity_uid,
        model: $model,
        version: $version
      })
      ON CREATE SET
        job.id = randomUUID(),
        job.status = 'pending',
        job.priority = toInteger($priority),
        job.created_at = timestamp(),
        job.attempts = 0,
        job.max_attempts = toInteger($max_attempts),
        job.error = null,
        job.processed_at = null,
        job.lock_owner = null,
        job.lock_until = null
      ON MATCH SET
        job.status = CASE
          WHEN job.status = 'failed' THEN 'pending'
          ELSE job.status
        END
      RETURN job.id, job.status
    `;

    const result = await this.connectionManager.executeQuery(query, {
      entity_uid,
      model,
      version,
      priority,
      max_attempts,
    });

    if (result.records.length === 0) {
      this.log('No job record returned from enqueue operation');
      return null;
    }

    const record = result.records[0];
    const jobId = record.get('job.id') as string;
    const status = record.get('job.status') as string;

    // If the job was already pending, we don't return an ID
    if (status === 'pending') {
      this.log(`Job already exists and is pending: ${jobId}`);
      return null;
    }

    this.log(`Enqueued new job: ${jobId}`);
    return jobId;
  }

  /**
   * Lease a batch of pending jobs for processing
   *
   * @param batchSize Maximum number of jobs to lease
   * @param lockOwner Unique identifier for the worker leasing the jobs
   * @param lockDuration Duration in milliseconds for which jobs should be locked
   * @returns Array of leased jobs
   */
  async leaseJobs(batchSize: number, lockOwner: string, lockDuration: number): Promise<LeasedJob[]> {
    this.log(`Leasing up to ${batchSize} jobs for owner ${lockOwner}`);

    const query = `
      MATCH (job:EmbedJob)
      WHERE job.status = 'pending'
      AND (job.lock_until IS NULL OR job.lock_until < timestamp())
      WITH job
      ORDER BY job.priority DESC, job.created_at ASC
      LIMIT toInteger($batchSize)
      SET job.status = 'processing',
          job.lock_owner = $lockOwner,
          job.lock_until = timestamp() + toInteger($lockDuration),
          job.attempts = job.attempts + 1
      RETURN job {
        .id,
        .entity_uid,
        .model,
        .version,
        .status,
        .priority,
        .created_at,
        .processed_at,
        .lock_owner,
        .lock_until,
        .error,
        .attempts,
        .max_attempts
      } as job
    `;

    const result = await this.connectionManager.executeQuery(query, {
      batchSize,
      lockOwner,
      lockDuration,
    });

    const leasedJobs: LeasedJob[] = result.records.map((record) => {
      const job = record.get('job') as Record<string, any>;
      return {
        ...job,
        lock_owner: job.lock_owner,
        lock_until: job.lock_until,
      } as LeasedJob;
    });

    this.log(`Leased ${leasedJobs.length} jobs`);
    return leasedJobs;
  }

  /**
   * Send a heartbeat for leased jobs to extend their lock
   *
   * @param jobIds Array of job IDs to heartbeat
   * @param lockOwner The owner of the jobs (must match)
   * @param lockDuration Duration in milliseconds to extend the lock
   * @returns Number of jobs that were successfully heartbeated
   */
  async heartbeatJobs(jobIds: string[], lockOwner: string, lockDuration: number): Promise<number> {
    if (jobIds.length === 0) {
      return 0;
    }

    this.log(`Heartbeating ${jobIds.length} jobs for owner ${lockOwner}`);

    const query = `
      MATCH (job:EmbedJob)
      WHERE job.id IN $jobIds
      AND job.lock_owner = $lockOwner
      AND job.status = 'processing'
      SET job.lock_until = timestamp() + toInteger($lockDuration)
      RETURN count(job) as updated
    `;

    const result = await this.connectionManager.executeQuery(query, {
      jobIds,
      lockOwner,
      lockDuration,
    });

    const updated = result.records[0]?.get('updated') as number || 0;
    this.log(`Heartbeated ${updated} jobs`);
    return updated;
  }

  /**
   * Complete a job successfully
   *
   * @param jobId ID of the job to complete
   * @param lockOwner The owner of the job (must match)
   * @returns true if job was completed, false otherwise
   */
  async completeJob(jobId: string, lockOwner: string): Promise<boolean> {
    this.log(`Completing job ${jobId} for owner ${lockOwner}`);

    const query = `
      MATCH (job:EmbedJob {id: $jobId, lock_owner: $lockOwner})
      WHERE job.status = 'processing'
      SET job.status = 'completed',
          job.processed_at = timestamp(),
          job.lock_owner = null,
          job.lock_until = null
      RETURN count(job) as updated
    `;

    const result = await this.connectionManager.executeQuery(query, {
      jobId,
      lockOwner,
    });

    const updated = result.records[0]?.get('updated') as number || 0;
    const success = updated > 0;

    this.log(`Job completion ${success ? 'successful' : 'failed'}: ${jobId}`);
    return success;
  }

  /**
   * Fail a job, either marking it for retry or as permanently failed
   *
   * @param jobId ID of the job to fail
   * @param lockOwner The owner of the job (must match)
   * @param error Optional error message
   * @returns true if job was failed, false otherwise
   */
  async failJob(jobId: string, lockOwner: string, error?: string): Promise<boolean> {
    this.log(`Failing job ${jobId} for owner ${lockOwner}`);

    const query = `
      MATCH (job:EmbedJob {id: $jobId, lock_owner: $lockOwner})
      WHERE job.status = 'processing'
      SET job.error = $error,
          job.processed_at = timestamp(),
          job.lock_owner = null,
          job.lock_until = null,
          job.status = CASE
            WHEN job.attempts >= job.max_attempts THEN 'failed'
            ELSE 'pending'
          END
      RETURN count(job) as updated
    `;

    const result = await this.connectionManager.executeQuery(query, {
      jobId,
      lockOwner,
      error: error || null,
    });

    const updated = result.records[0]?.get('updated') as number || 0;
    const success = updated > 0;

    this.log(`Job failure ${success ? 'successful' : 'failed'}: ${jobId}`);
    return success;
  }

  /**
   * Get the current status of the job queue
   *
   * @returns Queue statistics
   */
  async getQueueStatus(): Promise<QueueStatus> {
    this.log('Getting queue status');

    const query = `
      MATCH (job:EmbedJob)
      RETURN
        count(job) as total,
        sum(CASE WHEN job.status = 'pending' THEN 1 ELSE 0 END) as pending,
        sum(CASE WHEN job.status = 'processing' THEN 1 ELSE 0 END) as processing,
        sum(CASE WHEN job.status = 'completed' THEN 1 ELSE 0 END) as completed,
        sum(CASE WHEN job.status = 'failed' THEN 1 ELSE 0 END) as failed
    `;

    const result = await this.connectionManager.executeQuery(query, {});

    if (result.records.length === 0) {
      return {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        totalJobs: 0,
      };
    }

    const record = result.records[0];
    const status = {
      pending: record.get('pending') as number || 0,
      processing: record.get('processing') as number || 0,
      completed: record.get('completed') as number || 0,
      failed: record.get('failed') as number || 0,
      totalJobs: record.get('total') as number || 0,
    };

    this.log(`Queue status: ${JSON.stringify(status)}`);
    return status;
  }

  /**
   * Retry failed jobs by resetting their status to pending
   *
   * @returns Number of jobs reset for retry
   */
  async retryFailedJobs(): Promise<number> {
    this.log('Retrying failed jobs');

    const query = `
      MATCH (job:EmbedJob)
      WHERE job.status = 'failed'
      SET job.status = 'pending',
          job.attempts = 0,
          job.error = null,
          job.processed_at = null,
          job.lock_owner = null,
          job.lock_until = null
      RETURN count(job) as reset
    `;

    const result = await this.connectionManager.executeQuery(query, {});
    const reset = result.records[0]?.get('reset') as number || 0;

    this.log(`Reset ${reset} failed jobs for retry`);
    return reset;
  }

  /**
   * Clean up old completed and failed jobs based on retention policy
   *
   * @param retentionDays Number of days to retain completed/failed jobs (7-30 days), or milliseconds for backward compatibility
   * @returns Number of jobs cleaned up
   */
  async cleanupJobs(retentionDays = 14): Promise<number> {
    // For backward compatibility, if a very large number is passed, assume it's milliseconds
    // Convert to days (any value > 100 is likely milliseconds)
    const actualRetentionDays = retentionDays > 100
      ? Math.max(7, Math.min(30, Math.round(retentionDays / (24 * 60 * 60 * 1000))))
      : retentionDays;

    // Validate retention days
    if (actualRetentionDays < 7 || actualRetentionDays > 30) {
      throw new Error(`Retention days must be between 7 and 30, got ${actualRetentionDays}`);
    }

    const cutoffTime = Date.now() - (actualRetentionDays * 24 * 60 * 60 * 1000);

    this.log(`Cleaning up completed/failed jobs older than ${new Date(cutoffTime).toISOString()} (${actualRetentionDays} days retention)`);

    const query = `
      MATCH (job:EmbedJob)
      WHERE (job.status = 'completed' OR job.status = 'failed')
      AND job.processed_at < $cutoffTime
      AND job.processed_at IS NOT NULL
      DELETE job
      RETURN count(job) as deleted
    `;

    const result = await this.connectionManager.executeQuery(query, { cutoffTime });
    const deleted = result.records[0]?.get('deleted') as number || 0;

    this.log(`Cleaned up ${deleted} old completed/failed jobs`);
    return deleted;
  }

  /**
   * Scheduled cleanup using APOC TTL for completed and failed jobs
   *
   * @param retentionDays Number of days to retain jobs (7-30 days)
   * @returns Number of jobs cleaned up
   */
  async scheduledCleanupJobs(retentionDays = 14): Promise<number> {
    // For backward compatibility, if a very large number is passed, assume it's milliseconds
    // Convert to days (any value > 100 is likely milliseconds)
    const actualRetentionDays = retentionDays > 100
      ? Math.max(7, Math.min(30, Math.round(retentionDays / (24 * 60 * 60 * 1000))))
      : retentionDays;

    // Validate retention days
    if (actualRetentionDays < 7 || actualRetentionDays > 30) {
      throw new Error(`Retention days must be between 7 and 30, got ${actualRetentionDays}`);
    }

    const cutoffTime = Date.now() - (actualRetentionDays * 24 * 60 * 60 * 1000);

    this.log(`Running scheduled cleanup for jobs older than ${new Date(cutoffTime).toISOString()}`);

    // Use APOC periodic iterate for efficient bulk deletion
    const query = `
      CALL apoc.periodic.iterate(
        "MATCH (job:EmbedJob)
         WHERE (job.status = 'completed' OR job.status = 'failed')
         AND job.processed_at < $cutoffTime
         AND job.processed_at IS NOT NULL
         RETURN job",
        "DELETE job",
        {batchSize: 1000, parallel: false, iterateList: true}
      )
      YIELD batches, total
      RETURN total as deleted
    `;

    try {
      const result = await this.connectionManager.executeQuery(query, { cutoffTime });
      const deleted = result.records[0]?.get('deleted') as number || 0;

      this.log(`Scheduled cleanup completed: ${deleted} jobs removed`);
      return deleted;
    } catch (error) {
      // Fallback to regular cleanup if APOC is not available
      this.log('APOC not available, falling back to regular cleanup');
      return await this.cleanupJobs(retentionDays);
    }
  }

  /**
   * Close the connection manager
   */
  async close(): Promise<void> {
    this.log('Closing connection manager');
    await this.connectionManager.close();
  }
}
