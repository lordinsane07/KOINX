import mongoose from 'mongoose';

/**
 * Schema for reconciliation run metadata.
 * Each POST /reconcile creates exactly one run document that tracks
 * lifecycle (PENDING → RUNNING → COMPLETE/PARTIAL), configuration used,
 * aggregate summary stats, and any run-level errors.
 *
 * The fingerprint field enables idempotency checks — callers can detect
 * duplicate submissions by hashing (userFileChecksum + exchangeFileChecksum + config).
 */
const reconciliationRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, unique: true },
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'RUNNING', 'COMPLETE', 'PARTIAL'],
      default: 'PENDING',
    },
    fingerprint: { type: String, index: true },
    config: {
      timestampToleranceSecs: { type: Number, required: true },
      quantityTolerancePct: { type: Number, required: true },
      requireExactType: { type: Boolean, required: true },
    },
    summary: {
      matched: { type: Number, default: 0 },
      conflicting: { type: Number, default: 0 },
      unmatchedUser: { type: Number, default: 0 },
      unmatchedExchange: { type: Number, default: 0 },
      totalUserRows: { type: Number, default: 0 },
      totalExchangeRows: { type: Number, default: 0 },
      qualitySummary: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    userFileChecksum: { type: String },
    exchangeFileChecksum: { type: String },
    triggeredAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    errorLog: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'reconciliation_runs' },
);

export const ReconciliationRun = mongoose.model('ReconciliationRun', reconciliationRunSchema);
