import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/infrastructure/db.js';
import { ReconciliationRun } from '../src/models/reconciliationRun.model.js';
import { logger } from '../src/infrastructure/logger.js';

/**
 * Seeder script to initialize the database with basic status indicators.
 * Helpful for setting up dev environments.
 */
async function seed() {
  try {
    logger.info('Starting database seeder...');
    await connectDb();

    // Clear existing reconciliation runs
    await ReconciliationRun.deleteMany({});
    logger.info('Cleaned old reconciliation runs.');

    logger.info('Database successfully seeded with clean state.');
  } catch (err) {
    logger.error('Failed to seed database', err);
  } finally {
    await disconnectDb();
  }
}

seed();
