import { ReconciliationRun } from '../models/reconciliationRun.model.js';
import { REPORT_LIMIT_DEFAULT } from '../infrastructure/constants.js';

/**
 * Repository for reconciliation run lifecycle management.
 * Encapsulates all MongoDB access for the reconciliation_runs collection.
 *
 * Write methods accept an optional session to participate in multi-document
 * MongoDB transactions (e.g. atomically creating a run + inserting raw rows).
 */
export const reconciliationRunRepo = {
  /**
   * Create a new reconciliation run document.
   *
   * @param {Object} data - Document fields matching the ReconciliationRun schema
   * @param {Object} [options] - Mongoose options
   * @param {import('mongoose').ClientSession} [options.session] - MongoDB session for transactions
   * @returns {Promise<import('mongoose').Document>} The created run document
   */
  async create(data, options = {}) {
    const doc = new ReconciliationRun(data);
    return doc.save({ session: options.session ?? null });
  },

  /**
   * Look up a run by its public-facing runId (UUID).
   * Uses lean() since callers only need to read fields, never call
   * Mongoose instance methods on the result.
   *
   * @param {string} runId - The UUID identifying the run
   * @returns {Promise<Object|null>} Lean document or null
   */
  async findByRunId(runId) {
    return ReconciliationRun.findOne({ runId }).lean().exec();
  },

  /**
   * Look up a run by its fingerprint hash.
   * Enables idempotency: before creating a new run the service can check
   * whether an identical (same files + same config) run already exists.
   *
   * @param {string} fingerprint - SHA-256 hash of (userChecksum + exchangeChecksum + config)
   * @returns {Promise<Object|null>} Lean document of the existing run, or null
   */
  async findByFingerprint(fingerprint) {
    return ReconciliationRun.findOne({ fingerprint }).lean().exec();
  },

  /**
   * Transition a run to a new status.
   * Used for PENDING → RUNNING and other non-terminal transitions.
   *
   * @param {string} runId - The UUID identifying the run
   * @param {string} status - New status value (must be in schema enum)
   * @param {Object} [options] - Mongoose options
   * @param {import('mongoose').ClientSession} [options.session] - MongoDB session for transactions
   * @returns {Promise<Object|null>} Updated lean document or null
   */
  async updateStatus(runId, status, options = {}) {
    return ReconciliationRun.findOneAndUpdate(
      { runId },
      { $set: { status } },
      { new: true, session: options.session ?? null },
    )
      .lean()
      .exec();
  },

  /**
   * Mark a run as COMPLETE with final summary statistics.
   * Sets completedAt to the current time — the delta from triggeredAt
   * gives total run duration for observability.
   *
   * @param {string} runId - The UUID identifying the run
   * @param {Object} summary - Aggregate match/conflict/unmatched counts
   * @returns {Promise<Object|null>} Updated lean document or null
   */
  async markComplete(runId, summary) {
    return ReconciliationRun.findOneAndUpdate(
      { runId },
      {
        $set: {
          status: 'COMPLETE',
          summary,
          completedAt: new Date(),
        },
      },
      { new: true },
    )
      .lean()
      .exec();
  },

  /**
   * Mark a run as PARTIAL — processing finished but with errors.
   * Captures whatever summary data was produced before the failure
   * and appends the error message to the run's error log.
   *
   * @param {string} runId - The UUID identifying the run
   * @param {Object} summary - Partial summary statistics
   * @param {string} errorMsg - Human-readable description of what went wrong
   * @returns {Promise<Object|null>} Updated lean document or null
   */
  async markPartial(runId, summary, errorMsg) {
    return ReconciliationRun.findOneAndUpdate(
      { runId },
      {
        $set: {
          status: 'PARTIAL',
          summary,
          completedAt: new Date(),
        },
        $push: { errorLog: errorMsg },
      },
      { new: true },
    )
      .lean()
      .exec();
  },

  /**
   * Append an error message to a run's error log without changing status.
   * Used for non-fatal errors that should be captured but don't warrant
   * transitioning the run to PARTIAL (e.g. a single chunk write failure
   * during a large ingestion).
   *
   * @param {string} runId - The UUID identifying the run
   * @param {string} errorMsg - Error description to append
   * @returns {Promise<Object|null>} Updated lean document or null
   */
  async appendError(runId, errorMsg) {
    return ReconciliationRun.findOneAndUpdate(
      { runId },
      { $push: { errorLog: errorMsg } },
      { new: true },
    )
      .lean()
      .exec();
  },

  /**
   * List reconciliation runs with cursor-based pagination.
   * Uses _id as the cursor because it's monotonically increasing and
   * already indexed — no extra index needed. The cursor value is the
   * _id of the last document from the previous page; we fetch documents
   * with _id greater than the cursor.
   *
   * @param {string|null} cursor - The _id to start after, or null for the first page
   * @param {number} [limit] - Maximum documents to return (defaults to REPORT_LIMIT_DEFAULT)
   * @returns {Promise<{data: Object[], nextCursor: string|null, hasNextPage: boolean}>}
   */
  async findAll(cursor, limit = REPORT_LIMIT_DEFAULT) {
    const filter = cursor ? { _id: { $gt: cursor } } : {};

    // Fetch one extra document to determine whether another page exists
    // without a separate count query.
    const docs = await ReconciliationRun.find(filter)
      .sort({ _id: 1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasNextPage = docs.length > limit;
    const data = hasNextPage ? docs.slice(0, limit) : docs;
    const nextCursor = hasNextPage ? String(data[data.length - 1]._id) : null;

    return { data, nextCursor, hasNextPage };
  },
};
