import { RawTransaction } from '../models/rawTransaction.model.js';
import { BULK_INSERT_CHUNK_SIZE } from '../infrastructure/constants.js';

/**
 * Splits an array into fixed-size chunks for batch processing.
 * Keeps memory pressure predictable during large insertMany calls.
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
 * Repository for raw transaction persistence.
 * Encapsulates all MongoDB access for the raw_transactions collection —
 * services must use this instead of touching the model directly.
 */
export const rawTransactionRepo = {
  /**
   * Insert a single raw transaction document.
   *
   * @param {Object} data - Document fields matching the RawTransaction schema
   * @param {Object} [options] - Mongoose options
   * @param {import('mongoose').ClientSession} [options.session] - MongoDB session for transactions
   * @returns {Promise<import('mongoose').Document>} The created document
   */
  async create(data, options = {}) {
    const doc = new RawTransaction(data);
    return doc.save({ session: options.session ?? null });
  },

  /**
   * Bulk-insert raw transaction documents in chunked batches.
   * Uses ordered:false so a single bad document doesn't abort the entire batch —
   * critical for the "zero silent drops" policy where we want to persist as many
   * rows as possible even if some fail schema validation.
   *
   * @param {Object[]} docs - Array of document objects
   * @param {Object} [options] - Mongoose options
   * @param {import('mongoose').ClientSession} [options.session] - MongoDB session for transactions
   * @returns {Promise<import('mongoose').Document[]>} All inserted documents across all chunks
   */
  async bulkCreate(docs, options = {}) {
    if (!docs.length) return [];

    const batches = chunk(docs, BULK_INSERT_CHUNK_SIZE);
    const results = [];

    for (const batch of batches) {
      const inserted = await RawTransaction.insertMany(batch, {
        ordered: false,
        session: options.session ?? null,
      });
      results.push(...inserted);
    }

    return results;
  },

  /**
   * Fetch all raw transactions for a given run and source.
   * Used during normalisation to iterate over ingested rows.
   *
   * @param {string} runId - The reconciliation run identifier
   * @param {string} source - Either 'user' or 'exchange'
   * @returns {Promise<Object[]>} Lean documents (plain JS objects, no Mongoose overhead)
   */
  async findByRunAndSource(runId, source) {
    return RawTransaction.find({ runId, source }).lean().exec();
  },

  /**
   * Update the validity flag and quality flags on a single raw transaction.
   * Called when post-ingestion validation discovers issues with a row that
   * was initially stored as valid.
   *
   * @param {import('mongoose').Types.ObjectId|string} id - Document _id
   * @param {boolean} isValid - New validity state
   * @param {string[]} qualityFlags - Updated array of flag codes
   * @param {Object} [options] - Mongoose options
   * @param {import('mongoose').ClientSession} [options.session] - MongoDB session for transactions
   * @returns {Promise<Object|null>} Updated document or null if not found
   */
  async updateFlags(id, isValid, qualityFlags, options = {}) {
    return RawTransaction.findByIdAndUpdate(
      id,
      { $set: { isValid, qualityFlags } },
      { new: true, session: options.session ?? null },
    ).exec();
  },

  /**
   * Count raw transactions for a run and source.
   * Powers the qualitySummary.total counts in the run summary.
   *
   * @param {string} runId - The reconciliation run identifier
   * @param {string} source - Either 'user' or 'exchange'
   * @returns {Promise<number>} Document count
   */
  async countByRunAndSource(runId, source) {
    return RawTransaction.countDocuments({ runId, source }).exec();
  },

  /**
   * Find all invalid raw transactions within a run.
   * These rows were ingested but failed validation — they appear
   * in the report as UNMATCHED with their flag codes as reasons.
   *
   * @param {string} runId - The reconciliation run identifier
   * @returns {Promise<Object[]>} Lean documents where isValid is false
   */
  async findInvalidByRun(runId) {
    return RawTransaction.find({ runId, isValid: false }).lean().exec();
  },
};
