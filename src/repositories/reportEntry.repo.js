import mongoose from 'mongoose';
import { ReportEntry } from '../models/reportEntry.model.js';
import {
  BULK_INSERT_CHUNK_SIZE,
  REPORT_PAGE_DEFAULT,
  REPORT_LIMIT_DEFAULT,
} from '../infrastructure/constants.js';

/**
 * Splits an array into fixed-size chunks for batch processing.
 *
 * @param {Array} arr - Source array to partition
 * @param {number} size - Maximum elements per chunk
 * @returns {Array<Array>} Array of chunks
 */
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Build a MongoDB filter for report entry queries.
 * Centralised here to keep the optional category logic DRY across
 * the multiple query methods that accept it.
 *
 * @param {string} runId - The reconciliation run identifier
 * @param {string} [category] - Optional category filter
 * @returns {Object} MongoDB filter object
 */
function buildFilter(runId, category) {
  const filter = { runId };
  if (category) {
    filter.category = category;
  }
  return filter;
}

/**
 * Repository for reconciliation report entries.
 * Encapsulates all MongoDB access for the report_entries collection.
 *
 * Provides both offset-based pagination (backward compat with existing
 * API consumers) and cursor-based pagination (preferred for large datasets
 * to avoid the skip(N) performance cliff).
 */
export const reportEntryRepo = {
  /**
   * Bulk-insert report entries in chunked batches.
   * Called once per run after all four matching passes complete.
   * Uses ordered:false — if a single entry fails validation we still
   * want the rest of the report to persist.
   *
   * @param {Object[]} entries - Array of report entry objects
   * @param {Object} [options] - Mongoose options
   * @param {import('mongoose').ClientSession} [options.session] - MongoDB session for transactions
   * @returns {Promise<import('mongoose').Document[]>} All inserted documents
   */
  async bulkCreate(entries, options = {}) {
    if (!entries.length) return [];

    const batches = chunk(entries, BULK_INSERT_CHUNK_SIZE);
    const results = [];

    for (const batch of batches) {
      const inserted = await ReportEntry.insertMany(batch, {
        ordered: false,
        session: options.session ?? null,
      });
      results.push(...inserted);
    }

    return results;
  },

  /**
   * Fetch report entries using offset-based (page/limit) pagination.
   * Kept for backward compatibility with API consumers that send
   * ?page=N&limit=M. For new integrations prefer findByCursor().
   *
   * @param {string} runId - The reconciliation run identifier
   * @param {Object} [params] - Pagination and filter parameters
   * @param {number} [params.page] - 1-indexed page number
   * @param {number} [params.limit] - Max entries per page
   * @param {string} [params.category] - Optional category filter
   * @returns {Promise<Object[]>} Lean documents for the requested page
   */
  async findByRun(runId, { page = REPORT_PAGE_DEFAULT, limit = REPORT_LIMIT_DEFAULT, category } = {}) {
    const filter = buildFilter(runId, category);
    const skip = (page - 1) * limit;

    return ReportEntry.find(filter)
      .sort({ _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
  },

  /**
   * Fetch report entries using cursor-based pagination.
   * Uses _id as the cursor — it's monotonically increasing and already
   * indexed, so cursor > _id is an efficient range scan.  Returns one
   * extra document to determine hasNextPage without a count query.
   *
   * @param {string} runId - The reconciliation run identifier
   * @param {string|null} cursor - The _id to start after, or null for the first page
   * @param {number} [limit] - Max entries to return
   * @param {string} [category] - Optional category filter
   * @returns {Promise<{data: Object[], nextCursor: string|null, hasNextPage: boolean}>}
   */
  // eslint-disable-next-line default-param-last
  async findByCursor(runId, cursor, limit = REPORT_LIMIT_DEFAULT, category) {
    const filter = buildFilter(runId, category);

    if (cursor) {
      // Only accept valid ObjectId strings — prevents injection of arbitrary
      // query operators through the cursor parameter.
      if (!mongoose.Types.ObjectId.isValid(cursor)) {
        return { data: [], nextCursor: null, hasNextPage: false };
      }
      filter._id = { $gt: new mongoose.Types.ObjectId(cursor) };
    }

    const docs = await ReportEntry.find(filter)
      .sort({ _id: 1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasNextPage = docs.length > limit;
    const data = hasNextPage ? docs.slice(0, limit) : docs;
    const nextCursor = hasNextPage ? String(data[data.length - 1]._id) : null;

    return { data, nextCursor, hasNextPage };
  },

  /**
   * Count report entries for a run with optional category filter.
   * Powers the pagination.total field in API responses and the
   * summary counts on the report endpoint.
   *
   * @param {string} runId - The reconciliation run identifier
   * @param {string} [category] - Optional category filter
   * @returns {Promise<number>} Document count
   */
  async countByRun(runId, category) {
    const filter = buildFilter(runId, category);
    return ReportEntry.countDocuments(filter).exec();
  },

  /**
   * Fetch only unmatched entries (both UNMATCHED_USER and UNMATCHED_EXCHANGE).
   * Backs the GET /report/:runId/unmatched endpoint.
   * Uses offset pagination for consistency with the unmatched endpoint spec.
   *
   * @param {string} runId - The reconciliation run identifier
   * @param {Object} [params] - Pagination parameters
   * @param {number} [params.page] - 1-indexed page number
   * @param {number} [params.limit] - Max entries per page
   * @returns {Promise<Object[]>} Lean documents matching unmatched categories
   */
  async findUnmatched(runId, { page = REPORT_PAGE_DEFAULT, limit = REPORT_LIMIT_DEFAULT } = {}) {
    const skip = (page - 1) * limit;

    return ReportEntry.find({
      runId,
      category: { $in: ['UNMATCHED_USER', 'UNMATCHED_EXCHANGE'] },
    })
      .sort({ _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
  },

  /**
   * Delete all report entries for a run.
   * Used by the purge endpoint to clean up completed runs.
   * Returns the count of deleted documents for audit logging.
   *
   * @param {string} runId - The reconciliation run identifier
   * @returns {Promise<number>} Count of deleted documents
   */
  async deleteByRun(runId) {
    const result = await ReportEntry.deleteMany({ runId }).exec();
    return result.deletedCount;
  },
};
