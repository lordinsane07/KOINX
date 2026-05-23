import mongoose from 'mongoose';

/**
 * Schema for individual reconciliation report entries.
 * Each entry represents one categorised outcome from the matching engine:
 * a matched pair, a conflicting pair, or an unmatched record from either side.
 *
 * conflictDetails is only populated for CONFLICTING entries and captures
 * per-field deltas so the consumer can see exactly what diverged.
 */
const reportEntrySchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },
    category: {
      type: String,
      required: true,
      enum: ['MATCHED', 'CONFLICTING', 'UNMATCHED_USER', 'UNMATCHED_EXCHANGE'],
    },
    userRecord: { type: mongoose.Schema.Types.Mixed, default: null },
    exchangeRecord: { type: mongoose.Schema.Types.Mixed, default: null },
    matchScore: { type: Number, default: null },
    reason: { type: String, required: true },
    conflictDetails: [{
      field: String,
      userValue: String,
      exchangeValue: String,
      delta: String,
    }],
  },
  { timestamps: true, collection: 'report_entries' },
);

// Compound index supports the primary query pattern: filtering report entries
// by run and optionally by category (e.g. showing only CONFLICTING entries).
reportEntrySchema.index({ runId: 1, category: 1 });

export const ReportEntry = mongoose.model('ReportEntry', reportEntrySchema);
