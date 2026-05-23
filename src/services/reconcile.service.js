import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { config as appConfig } from '../infrastructure/config.js';
import { reconciliationRunRepo } from '../repositories/reconciliationRun.repo.js';
import { ingestionService } from './ingestion.service.js';
import { matchingService } from './matching.service.js';
import { sha256File } from '../infrastructure/checksum.js';
import { logger } from '../infrastructure/logger.js';
import { RUN_STATUS } from '../infrastructure/constants.js';

/**
 * Service to orchestrate the high-level reconciliation run lifecycle.
 * Spawns async background execution jobs, hashes files for idempotency,
 * and maintains run status and metadata.
 */
export const reconcileService = {
  /**
   * Initialise a reconciliation run by computing checksums, checking idempotency,
   * and saving a PENDING run document.
   *
   * @param {string} rawUserPath - Client-provided path to the user CSV
   * @param {string} rawExchangePath - Client-provided path to the exchange CSV
   * @param {object} [overrides] - Config overrides for tolerances
   * @returns {Promise<object>} The created run metadata document (or existing complete run)
   */
  async initRun(rawUserPath, rawExchangePath, overrides = {}) {
    const userPath = resolve(rawUserPath);
    const exchangePath = resolve(rawExchangePath);

    logger.info(`Initialising reconciliation run for files: User: ${userPath}, Exchange: ${exchangePath}`);

    // 1. Compute SHA-256 file checksums for deduplication and integrity checking
    const userChecksum = await sha256File(userPath);
    const exchangeChecksum = await sha256File(exchangePath);

    // Get config tolerances (with request-level overrides)
    const timestampToleranceSecs = overrides.timestampToleranceSecs ?? appConfig.timestampToleranceSecs;
    const quantityTolerancePct = overrides.quantityTolerancePct ?? appConfig.quantityTolerancePct;
    const requireExactType = overrides.requireExactType ?? appConfig.requireExactType;

    // 2. Compute run fingerprint for strict idempotency checking
    const configStr = `${timestampToleranceSecs}:${quantityTolerancePct}:${requireExactType}`;
    const fingerprint = createHash('sha256')
      .update(`${userChecksum}:${exchangeChecksum}:${configStr}`)
      .digest('hex');

    logger.info(`Computed run fingerprint: ${fingerprint}`);

    // 3. Check for existing COMPLETE run with identical fingerprint
    const existingRun = await reconciliationRunRepo.findByFingerprint(fingerprint);
    if (existingRun && existingRun.status === RUN_STATUS.COMPLETE) {
      logger.info(`Idempotency match: Found existing completed run with runId: ${existingRun.runId}`);
      // Returns existing completed run metadata
      return existingRun;
    }

    const runId = uuidv4();

    // 4. Create and persist the PENDING run document
    const newRun = await reconciliationRunRepo.create({
      runId,
      status: RUN_STATUS.PENDING,
      fingerprint,
      config: {
        timestampToleranceSecs,
        quantityTolerancePct,
        requireExactType,
      },
      summary: {
        matched: 0,
        conflicting: 0,
        unmatchedUser: 0,
        unmatchedExchange: 0,
        totalUserRows: 0,
        totalExchangeRows: 0,
        qualitySummary: {
          user: {
            totalRows: 0, validRows: 0, invalidRows: 0, flagBreakdown: {},
          },
          exchange: {
            totalRows: 0, validRows: 0, invalidRows: 0, flagBreakdown: {},
          },
        },
      },
      userFileChecksum: userChecksum,
      exchangeFileChecksum: exchangeChecksum,
      triggeredAt: new Date(),
    });

    logger.info(`Successfully initialised run in PENDING status. Assigned runId: ${runId}`);

    // Store the file paths dynamically on the object for use by the background runner
    const runObject = newRun.toObject ? newRun.toObject() : newRun;
    runObject.userFilePath = userPath;
    runObject.exchangeFilePath = exchangePath;

    return runObject;
  },

  /**
   * Run the ingestion and matching processes in the background.
   * Modifies the run document state (RUNNING -> COMPLETE / PARTIAL)
   * and records detailed error stack traces upon failures.
   *
   * @param {string} runId - Reconciliation run UUID
   * @param {string} userFilePath - Absolute resolved path to the user CSV
   * @param {string} exchangeFilePath - Absolute resolved path to the exchange CSV
   */
  async executeRun(runId, userFilePath, exchangeFilePath) {
    logger.info(`Starting async execution of runId: ${runId}`);

    const run = await reconciliationRunRepo.findByRunId(runId);
    if (!run) {
      logger.error(`Reconciliation run not found on execution start: ${runId}`);
      return;
    }

    const startTime = Date.now();

    try {
      // Transition PENDING -> RUNNING
      await reconciliationRunRepo.updateStatus(runId, RUN_STATUS.RUNNING);

      // 1. Ingest User Transactions
      logger.info(`Ingesting user CSV file for runId: ${runId}`);
      const userIngest = await ingestionService.ingestFile(userFilePath, 'user', runId);

      // 2. Ingest Exchange Transactions
      logger.info(`Ingesting exchange CSV file for runId: ${runId}`);
      const exchangeIngest = await ingestionService.ingestFile(exchangeFilePath, 'exchange', runId);

      // 3. Run Matching Engine
      logger.info(`Running matching engine for runId: ${runId}`);
      const matchOutcome = await matchingService.runMatching(runId, run.config);

      // 4. Compile and save COMPLETE run summary
      const finalSummary = {
        matched: matchOutcome.matched,
        conflicting: matchOutcome.conflicting,
        unmatchedUser: matchOutcome.unmatchedUser,
        unmatchedExchange: matchOutcome.unmatchedExchange,
        totalUserRows: userIngest.totalRows,
        totalExchangeRows: exchangeIngest.totalRows,
        qualitySummary: {
          user: {
            totalRows: userIngest.totalRows,
            validRows: userIngest.validRows,
            invalidRows: userIngest.invalidRows,
            flagBreakdown: userIngest.flagBreakdown,
          },
          exchange: {
            totalRows: exchangeIngest.totalRows,
            validRows: exchangeIngest.validRows,
            invalidRows: exchangeIngest.invalidRows,
            flagBreakdown: exchangeIngest.flagBreakdown,
          },
        },
      };

      const durationMs = Date.now() - startTime;
      logger.info(`Run ${runId} completed successfully in ${durationMs}ms`);

      await reconciliationRunRepo.markComplete(runId, finalSummary);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = `Reconciliation failed in background runner: ${err.message}. Stack: ${err.stack}`;
      logger.error(`Failed executing runId: ${runId} after ${durationMs}ms - ${errorMsg}`);

      // Capture whatever statistics we can compile
      const partialSummary = {
        matched: 0,
        conflicting: 0,
        unmatchedUser: 0,
        unmatchedExchange: 0,
        totalUserRows: 0,
        totalExchangeRows: 0,
        qualitySummary: {
          error: err.message,
        },
      };

      await reconciliationRunRepo.markPartial(runId, partialSummary, err.message);
    }
  },
};
