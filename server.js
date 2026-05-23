import app from './src/app.js';
import { connectDb, disconnectDb } from './src/infrastructure/db.js';
import { logger } from './src/infrastructure/logger.js';
import { config } from './src/infrastructure/config.js';
import { closeQueue } from './src/infrastructure/queue.js';
import { closeWorker } from './src/workers/reconcile.worker.js';

let server;

/**
 * Startup sequence:
 * 1. Connect to MongoDB database
 * 2. Bind express application to the configured PORT
 * 3. Register global shutdown and failure hooks
 */
async function bootstrap() {
  try {
    logger.info('Starting KoinX Reconciliation Engine server...');

    // Connect to database
    await connectDb();

    // Start listening
    server = app.listen(config.port, () => {
      logger.info(`Server successfully bound to PORT: ${config.port} in [${config.nodeEnv}] environment`);
      logger.info(`API Documentation is available at http://localhost:${config.port}/api-docs`);
      logger.info(`Health check available at http://localhost:${config.port}/health`);
    });
  } catch (err) {
    logger.error('Fatal crash during server bootstrap', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

/**
 * Perform a clean, graceful shutdown of the server and database connections.
 * Prevents dropping in-flight transactions or orphaned db threads.
 *
 * @param {string} signal - The exit signal received
 */
async function gracefulShutdown(signal) {
  logger.warn(`Received ${signal}. Starting graceful shutdown...`);

  if (server) {
    logger.info('Closing HTTP server...');
    await new Promise((resolve) => {
      server.close(() => {
        logger.info('HTTP server closed successfully.');
        resolve();
      });
    });
  }

  // Gracefully close BullMQ worker and queue
  try {
    await closeWorker();
    await closeQueue();
  } catch (err) {
    logger.error('Error closing BullMQ background worker/queue', { error: err.message });
  }

  // Gracefully close MongoDB connection
  await disconnectDb();

  logger.info('Graceful shutdown completed. Exiting process.');
  process.exit(0);
}

// ─── Process Lifecycle Events ────────────────────────────────────────────────
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection detected', {
    promise,
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // Crash and exit on unhandled promise rejections per production best practices
  gracefulShutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception detected — shutting down immediately', {
    error: err.message,
    stack: err.stack,
  });
  gracefulShutdown('uncaughtException');
});

// Kickstart server
bootstrap();
