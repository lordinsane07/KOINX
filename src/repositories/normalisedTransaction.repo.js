import { NormalisedTransaction } from '../models/normalisedTransaction.model.js';
import { BULK_INSERT_CHUNK_SIZE } from '../infrastructure/constants.js';

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
 * Repository for normalised transaction persistence.
 * Encapsulates all MongoDB access for the normalised_transactions collection.
 * All read methods use .lean() to return plain JS objects — we never need
 * Mongoose document methods on query results, and lean() cuts memory
 * allocation roughly in half.
 */
export const normalisedTransactionRepo = {
  /**
   * Insert a single normalised transaction document.
   *
   * @param {Object} data - Document fields matching the NormalisedTransaction schema
   * @param {Object} [options] - Mongoose options
   * @param {import('mongoose').ClientSession} [options.session] - MongoDB session for transactions
   * @returns {Promise<import('mongoose').Document>} The created document
   */
  async create(data, options = {}) {
    const doc = new NormalisedTransaction(data);
    return doc.save({ session: options.session ?? null });
  },

  /**
   * Bulk-insert normalised transaction documents in chunked batches.
   * Normalised records are derived from valid raw records; the batch
   * size matches the raw transaction repo for consistent memory behavior.
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
      const inserted = await NormalisedTransaction.insertMany(batch, {
        ordered: false,
        session: options.session ?? null,
      });
      results.push(...inserted);
    }

    return results;
  },

  /**
   * Fetch all normalised transactions for a given run and source.
   * Results are sorted by timestamp to support the time-bucketed
   * candidate selection in the fuzzy matching pass.
   *
   * @param {string} runId - The reconciliation run identifier
   * @param {string} source - Either 'user' or 'exchange'
   * @returns {Promise<Object[]>} Lean documents sorted by timestamp ascending
   */
  async findByRunAndSource(runId, source) {
    return NormalisedTransaction.find({ runId, source })
      .sort({ timestamp: 1 })
      .lean()
      .exec();
  },

  /**
   * Find normalised transactions by run and transaction hash.
   * Backs Pass 1 (exact ID match) — leverages the sparse index on
   * (runId, txHash) so only documents with non-null txHash are scanned.
   *
   * @param {string} runId - The reconciliation run identifier
   * @param {string} txHash - The transaction hash to look up
   * @returns {Promise<Object[]>} Lean documents matching the hash
   */
  async findByRunAndTxHash(runId, txHash) {
    return NormalisedTransaction.find({ runId, txHash }).lean().exec();
  },

  /**
   * Find normalised transactions by run and exchange-side ID.
   * Backs Pass 1 (exact ID match) — leverages the sparse index on
   * (runId, exchangeId) for efficient lookups.
   *
   * @param {string} runId - The reconciliation run identifier
   * @param {string} exchangeId - The exchange-assigned transaction identifier
   * @returns {Promise<Object[]>} Lean documents matching the exchange ID
   */
  async findByRunAndExchangeId(runId, exchangeId) {
    return NormalisedTransaction.find({ runId, exchangeId }).lean().exec();
  },
};
