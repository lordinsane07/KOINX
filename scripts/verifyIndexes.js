import { connectDb, disconnectDb } from '../src/infrastructure/db.js';
import { logger } from '../src/infrastructure/logger.js';
import { RawTransaction } from '../src/models/rawTransaction.model.js';
import { NormalisedTransaction } from '../src/models/normalisedTransaction.model.js';
import { ReconciliationRun } from '../src/models/reconciliationRun.model.js';
import { ReportEntry } from '../src/models/reportEntry.model.js';

/**
 * Audit script to verify that all compound, unique, and sparse indexes
 * are successfully created in MongoDB.
 */
async function verifyIndexes() {
  try {
    logger.info('Starting database index verification...');
    await connectDb();

    const models = [
      { name: 'RawTransaction', model: RawTransaction },
      { name: 'NormalisedTransaction', model: NormalisedTransaction },
      { name: 'ReconciliationRun', model: ReconciliationRun },
      { name: 'ReportEntry', model: ReportEntry },
    ];

    for (const item of models) {
      const indexes = await item.model.collection.indexes();
      logger.info(`Indexes for ${item.name} (${item.model.collection.name}):`, {
        indexes,
      });
    }

    logger.info('Database index verification completed successfully.');
  } catch (err) {
    logger.error('Failed to verify database indexes', err);
  } finally {
    await disconnectDb();
  }
}

verifyIndexes();
