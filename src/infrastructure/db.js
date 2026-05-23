import mongoose from 'mongoose';

import { config } from './config.js';
// eslint-disable-next-line import/no-named-as-default
import logger from './logger.js';

/**
 * Establish a MongoDB connection using the URI from config.
 *
 * Mongoose manages its own connection pool internally; calling this
 * once at startup is sufficient. Event listeners surface connectivity
 * issues to the logger so ops can react without tailing raw driver logs.
 *
 * @returns {Promise<typeof mongoose>} The mongoose instance (for chaining / testing)
 */
export async function connectDb() {
  // Surface ongoing connectivity issues after the initial connect succeeds
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { error: err.message });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected — driver will attempt reconnection');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });

  try {
    await mongoose.connect(config.mongodbUri);
    logger.info('MongoDB connected', { uri: config.mongodbUri.replace(/\/\/.*@/, '//<credentials>@') });
    return mongoose;
  } catch (err) {
    logger.error('MongoDB initial connection failed', {
      uri: config.mongodbUri.replace(/\/\/.*@/, '//<credentials>@'),
      error: err.message,
    });
    throw err;
  }
}

/**
 * Gracefully close the MongoDB connection.
 *
 * Called during SIGTERM / SIGINT handlers and at the end of integration tests
 * to avoid dangling connections and open-handle warnings in Jest.
 *
 * @returns {Promise<void>}
 */
export async function disconnectDb() {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected gracefully');
  } catch (err) {
    logger.error('Error during MongoDB disconnect', { error: err.message });
    throw err;
  }
}
