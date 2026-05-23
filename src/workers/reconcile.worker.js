import { Worker } from 'bullmq';
import { redisConnection } from '../infrastructure/queue.js';
import { reconcileService } from '../services/reconcile.service.js';
import { config } from '../infrastructure/config.js';
import { logger } from '../infrastructure/logger.js';

export const worker = redisConnection ? new Worker(
  'reconcile-jobs',
  async (job) => {
    const { runId, userFilePath, exchangeFilePath } = job.data;
    logger.info(`[BullMQ Worker] Picked up reconciliation job: ${job.id} for runId: ${runId}`);

    // Execute the matching runner synchronously inside the worker process
    await reconcileService.executeRun(runId, userFilePath, exchangeFilePath);
  },
  {
    connection: redisConnection,
    concurrency: config.workerConcurrency, // scale processing based on concurrency cap
  },
) : null;

if (worker) {
  logger.info('Initializing BullMQ background worker listener...');

  worker.on('completed', (job) => {
    logger.info(`[BullMQ Worker] Job ${job.id} completed successfully.`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[BullMQ Worker] Job ${job?.id} failed - ${err.message}`, err);
  });
}

/**
 * Gracefully close the BullMQ worker.
 *
 * @returns {Promise<void>}
 */
export async function closeWorker() {
  logger.info('Closing BullMQ background worker...');
  await worker.close();
}
