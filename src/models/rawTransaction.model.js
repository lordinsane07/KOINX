import mongoose from 'mongoose';

/**
 * Schema for raw CSV rows persisted immediately upon ingestion.
 * Every row is stored regardless of validity — the "zero silent drops"
 * policy means we never discard data; instead we flag it via isValid
 * and qualityFlags for downstream filtering.
 */
const rawTransactionSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },
    source: { type: String, required: true, enum: ['user', 'exchange'] },
    rawData: { type: mongoose.Schema.Types.Mixed, required: true },
    rowIndex: { type: Number, required: true },
    isValid: { type: Boolean, required: true, default: true },
    qualityFlags: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'raw_transactions' },
);

// Compound index speeds up the most common query pattern: fetching all rows
// for a specific source within a single reconciliation run.
rawTransactionSchema.index({ runId: 1, source: 1 });

export const RawTransaction = mongoose.model('RawTransaction', rawTransactionSchema);
