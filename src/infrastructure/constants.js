// ─── Report Categories ────────────────────────────────────────────────────────
/** @enum {string} Categorization outcomes for reconciled transaction pairs */
export const REPORT_CATEGORIES = Object.freeze({
  MATCHED: 'MATCHED',
  CONFLICTING: 'CONFLICTING',
  UNMATCHED_USER: 'UNMATCHED_USER',
  UNMATCHED_EXCHANGE: 'UNMATCHED_EXCHANGE',
});

// ─── Run Status ───────────────────────────────────────────────────────────────
/** @enum {string} Lifecycle states for a reconciliation run */
export const RUN_STATUS = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
});

// ─── Quality Flags ────────────────────────────────────────────────────────────
/** @enum {string} Data-quality issues detected during ingestion validation */
export const QUALITY_FLAGS = Object.freeze({
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  FUTURE_TIMESTAMP: 'FUTURE_TIMESTAMP',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  QUANTITY_OVERFLOW: 'QUANTITY_OVERFLOW',
  UNKNOWN_ASSET: 'UNKNOWN_ASSET',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  DUPLICATE_ID: 'DUPLICATE_ID',
});

/** @type {string[]} Mandatory columns in every CSV row */
export const REQUIRED_FIELDS = Object.freeze(['timestamp', 'asset', 'type', 'quantity']);

// ─── Matching Defaults ────────────────────────────────────────────────────────
/** @type {number} Max seconds apart two timestamps can be and still match */
export const DEFAULT_TIMESTAMP_TOLERANCE_SECS = 300;

/** @type {number} Fractional tolerance for quantity comparison (1% = 0.01) */
export const DEFAULT_QUANTITY_TOLERANCE_PCT = 0.01;

/** @type {number} Sliding-window cap to bound O(n²) candidate search */
export const DEFAULT_MAX_CANDIDATE_WINDOW = 1000;

/** @type {boolean} Whether type must match exactly or allow fuzzy aliasing */
export const DEFAULT_REQUIRE_EXACT_TYPE = false;

// ─── Validation Caps ─────────────────────────────────────────────────────────
/** @type {number} Reject quantities exceeding this as likely data corruption */
export const QUANTITY_SANITY_CAP = 1e15;

/** @type {number} Allow timestamps up to 1 hour into the future (clock drift) */
export const FUTURE_TIMESTAMP_BUFFER_MS = 3_600_000;

/** @type {number} Hard limit on CSV file size to prevent memory exhaustion */
export const MAX_CSV_FILE_BYTES = 100 * 1024 * 1024;

/** @type {number} Guard against absurdly long file paths (OS-level limits) */
export const MAX_FILE_PATH_LENGTH = 500;

// ─── Performance ──────────────────────────────────────────────────────────────
/** @type {number} Rows per MongoDB bulkWrite batch to balance throughput vs memory */
export const BULK_INSERT_CHUNK_SIZE = 500;

/** @type {number} Kill switch for runaway reconciliation jobs (5 minutes) */
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;

/** @type {number} BullMQ worker concurrency — kept low to avoid MongoDB contention */
export const DEFAULT_WORKER_CONCURRENCY = 3;

// ─── Pagination ───────────────────────────────────────────────────────────────
/** @type {number} Default page number when client omits pagination params */
export const REPORT_PAGE_DEFAULT = 1;

/** @type {number} Default results per page */
export const REPORT_LIMIT_DEFAULT = 100;

/** @type {number} Hard ceiling to prevent oversized payloads */
export const REPORT_LIMIT_MAX = 1000;

// ─── Rate Limiting ────────────────────────────────────────────────────────────
/** @type {number} Max reconcile requests per minute per client */
export const DEFAULT_RECONCILE_RATE_LIMIT = 10;

/** @type {number} Max report requests per minute per client */
export const DEFAULT_REPORT_RATE_LIMIT = 120;

// ─── Observability ────────────────────────────────────────────────────────────
/** @type {number} Warn when unmatched rate exceeds 20% — signals data quality issues */
export const UNMATCHED_RATE_WARN_THRESHOLD = 0.20;

// ─── Scoring Weights ──────────────────────────────────────────────────────────
// These four values MUST sum to 100 — they form the match-confidence score
/** @type {number} Max score contribution from timestamp proximity */
export const SCORE_TIMESTAMP_MAX = 40;

/** @type {number} Max score contribution from quantity proximity */
export const SCORE_QUANTITY_MAX = 40;

/** @type {number} Bonus awarded when transaction types match exactly */
export const SCORE_TYPE_EXACT_BONUS = 10;

/** @type {number} Bonus awarded when upstream tx-hashes match */
export const SCORE_HASH_MATCH_BONUS = 10;
