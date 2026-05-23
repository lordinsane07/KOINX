import client from 'prom-client';

// Collect Node.js default metrics (event loop lag, GC, memory, etc.)
client.collectDefaultMetrics();

// ─── Reconciliation Run Metrics ───────────────────────────────────────────────

/**
 * Total reconciliation runs partitioned by terminal status.
 * Lets ops answer: "How many runs succeeded vs failed today?"
 * @type {client.Counter}
 */
export const reconcileRunsTotal = new client.Counter({
  name: 'reconcile_runs_total',
  help: 'Total reconciliation runs by final status',
  labelNames: ['status'],
});

/**
 * Wall-clock duration of each reconciliation run in milliseconds.
 * Bucket boundaries chosen to capture the typical 100ms–5min range.
 * @type {client.Histogram}
 */
export const reconcileRunDurationMs = new client.Histogram({
  name: 'reconcile_run_duration_ms',
  help: 'Duration of reconciliation runs in milliseconds',
  buckets: [100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000, 300_000],
});

// ─── CSV Ingestion Metrics ────────────────────────────────────────────────────

/**
 * Rows processed during CSV ingestion, split by data source and validity.
 * High invalid-rate signals upstream data-quality issues.
 * @type {client.Counter}
 */
export const csvRowsProcessedTotal = new client.Counter({
  name: 'csv_rows_processed_total',
  help: 'Total CSV rows processed during ingestion',
  labelNames: ['source', 'valid'],
});

// ─── Matching Metrics ─────────────────────────────────────────────────────────

/**
 * Transactions bucketed by match category after reconciliation.
 * Used to track the UNMATCHED_RATE_WARN_THRESHOLD alert.
 * @type {client.Counter}
 */
export const matchCategoriesTotal = new client.Counter({
  name: 'match_categories_total',
  help: 'Transactions categorized during matching',
  labelNames: ['category'],
});

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * The prom-client global registry. Mount on `/metrics` endpoint
 * for Prometheus scraping.
 * @type {client.Registry}
 */
export const { register } = client;
