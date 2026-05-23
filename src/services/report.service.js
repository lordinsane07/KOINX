import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
// eslint-disable-next-line import/no-unresolved
import { stringify } from 'csv-stringify/sync';
import { reportEntryRepo } from '../repositories/reportEntry.repo.js';
import { reconciliationRunRepo } from '../repositories/reconciliationRun.repo.js';
import { ReportEntry } from '../models/reportEntry.model.js';
import { NotFoundError } from '../infrastructure/errors.js';
import { config } from '../infrastructure/config.js';
import { logger } from '../infrastructure/logger.js';
import {
  REPORT_PAGE_DEFAULT,
  REPORT_LIMIT_DEFAULT,
} from '../infrastructure/constants.js';

/**
 * Service to handle report retrieval, aggregation, and export.
 * Formats database documents into clean JSON payloads and structured CSVs.
 */
export const reportService = {
  /**
   * Retrieve a paginated list of report entries for a run, along with metadata.
   *
   * @param {string} runId - Run UUID
   * @param {object} paginationParams - Page, limit and category filter
   * @returns {Promise<{
   *   run: object,
   *   data: object[],
   *   pagination: { page: number, limit: number, total: number, pages: number }
   * }>}
   */
  async getFullReport(runId, { page = REPORT_PAGE_DEFAULT, limit = REPORT_LIMIT_DEFAULT, category } = {}) {
    logger.info(`Fetching full report for runId: ${runId}, category: ${category || 'ALL'}`);

    const run = await reconciliationRunRepo.findByRunId(runId);
    if (!run) {
      throw new NotFoundError(`Reconciliation run not found: ${runId}`, { runId });
    }

    const data = await reportEntryRepo.findByRun(runId, { page, limit, category });
    const total = await reportEntryRepo.countByRun(runId, category);

    return {
      run: {
        runId: run.runId,
        status: run.status,
        triggeredAt: run.triggeredAt,
        completedAt: run.completedAt,
        summary: run.summary,
      },
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Fetch the summary stats only for a run.
   *
   * @param {string} runId - Run UUID
   * @returns {Promise<object>} Clean summary payload with duration
   */
  async getSummary(runId) {
    logger.info(`Fetching summary for runId: ${runId}`);

    const run = await reconciliationRunRepo.findByRunId(runId);
    if (!run) {
      throw new NotFoundError(`Reconciliation run not found: ${runId}`, { runId });
    }

    const durationMs = run.completedAt && run.triggeredAt
      ? new Date(run.completedAt).getTime() - new Date(run.triggeredAt).getTime()
      : null;

    return {
      runId: run.runId,
      status: run.status,
      config: run.config,
      summary: run.summary,
      triggeredAt: run.triggeredAt,
      completedAt: run.completedAt,
      durationMs,
      errorLog: run.errorLog,
    };
  },

  /**
   * Fetch only unmatched rows with reasons.
   *
   * @param {string} runId - Run UUID
   * @param {object} paginationParams - Page and limit
   * @returns {Promise<{
   *   data: object[],
   *   pagination: { page: number, limit: number, total: number, pages: number }
   * }>}
   */
  async getUnmatched(runId, { page = REPORT_PAGE_DEFAULT, limit = REPORT_LIMIT_DEFAULT } = {}) {
    logger.info(`Fetching unmatched entries for runId: ${runId}`);

    const run = await reconciliationRunRepo.findByRunId(runId);
    if (!run) {
      throw new NotFoundError(`Reconciliation run not found: ${runId}`, { runId });
    }

    const data = await reportEntryRepo.findUnmatched(runId, { page, limit });

    // Count unmatched entries using mongo query
    const total = await ReportEntry.countDocuments({
      runId,
      category: { $in: ['UNMATCHED_USER', 'UNMATCHED_EXCHANGE'] },
    }).exec();

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Generate a structured CSV report and save it to the reports output folder.
   * Format features columns for both user and exchange data side-by-side
   * to ease manual auditing of conflicts and unmatched entries.
   *
   * @param {string} runId - Run UUID
   * @returns {Promise<string>} Absolute path to the generated CSV file
   */
  async generateCsv(runId) {
    logger.info(`Generating CSV report for runId: ${runId}`);

    const run = await reconciliationRunRepo.findByRunId(runId);
    if (!run) {
      throw new NotFoundError(`Reconciliation run not found: ${runId}`, { runId });
    }

    // Fetch all entries without pagination
    const entries = await ReportEntry.find({ runId }).sort({ _id: 1 }).lean().exec();

    const csvRows = entries.map((entry) => {
      const u = entry.userRecord || {};
      const e = entry.exchangeRecord || {};

      return {
        category: entry.category,
        reason: entry.reason,
        match_score: entry.matchScore != null ? entry.matchScore : '',
        user_transaction_id: u.transaction_id || u.exchange_id || u.exchangeId || '',
        user_timestamp: u.timestamp || '',
        user_type: u.type || '',
        user_asset: u.asset || '',
        user_quantity: u.quantity || '',
        exchange_transaction_id: e.transaction_id || e.exchange_id || e.exchangeId || '',
        exchange_timestamp: e.timestamp || '',
        exchange_type: e.type || '',
        exchange_asset: e.asset || '',
        exchange_quantity: e.quantity || '',
      };
    });

    const csvOutput = stringify(csvRows, {
      header: true,
      columns: [
        { key: 'category', header: 'Category' },
        { key: 'reason', header: 'Reason' },
        { key: 'match_score', header: 'Match Score' },
        { key: 'user_transaction_id', header: 'User Transaction ID' },
        { key: 'user_timestamp', header: 'User Timestamp' },
        { key: 'user_type', header: 'User Type' },
        { key: 'user_asset', header: 'User Asset' },
        { key: 'user_quantity', header: 'User Quantity' },
        { key: 'exchange_transaction_id', header: 'Exchange Transaction ID' },
        { key: 'exchange_timestamp', header: 'Exchange Timestamp' },
        { key: 'exchange_type', header: 'Exchange Type' },
        { key: 'exchange_asset', header: 'Exchange Asset' },
        { key: 'exchange_quantity', header: 'Exchange Quantity' },
      ],
    });

    // Ensure directory exists
    await mkdir(config.reportOutputDir, { recursive: true });

    const outputPath = resolve(config.reportOutputDir, `${runId}.csv`);
    writeFileSync(outputPath, csvOutput, 'utf-8');

    logger.info(`Successfully wrote CSV report to: ${outputPath}`);
    return outputPath;
  },
};
