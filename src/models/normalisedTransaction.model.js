import mongoose from 'mongoose';

/**
 * Schema for normalised transactions derived from valid raw rows.
 * Asset names are resolved to canonical tickers, types are alias-mapped,
 * timestamps converted to UTC, and quantities stored as Decimal128 to
 * eliminate floating-point drift during comparison.
 */
const normalisedTransactionSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },
    rawTransactionId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'RawTransaction' },
    source: { type: String, required: true, enum: ['user', 'exchange'] },
    timestamp: { type: Date, required: true },
    asset: { type: String, required: true },
    type: { type: String, required: true },
    quantity: { type: mongoose.Schema.Types.Decimal128, required: true },
    txHash: { type: String, default: null },
    exchangeId: { type: String, default: null },
  },
  { timestamps: true, collection: 'normalised_transactions' },
);

// Primary query path during fuzzy matching: fetch all records for a run+source,
// ordered by timestamp for time-bucketed candidate selection.
normalisedTransactionSchema.index({ runId: 1, source: 1, timestamp: 1 });

// Sparse indexes — only index documents where these fields are non-null.
// Pass 1 (exact ID match) queries these directly; sparse avoids bloating
// the index with the majority of rows that lack these optional identifiers.
normalisedTransactionSchema.index({ runId: 1, txHash: 1 }, { sparse: true });
normalisedTransactionSchema.index({ runId: 1, exchangeId: 1 }, { sparse: true });

export const NormalisedTransaction = mongoose.model('NormalisedTransaction', normalisedTransactionSchema);
