/* eslint-disable max-classes-per-file */
/**
 * Base application error. All domain-specific errors extend this so the
 * global error handler can distinguish operational errors from programmer bugs.
 */
export class AppError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {number} [statusCode=500] - HTTP status code to return
   * @param {string} [code='INTERNAL_ERROR'] - Machine-readable error code for clients
   * @param {Object} [details={}] - Structured context (field names, limits, etc.)
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when request/input validation fails (bad CSV headers, missing fields, etc.).
 * Maps to HTTP 400 — the client can fix and retry.
 */
export class ValidationError extends AppError {
  /**
   * @param {string} msg - What failed validation
   * @param {Object} [d={}] - Structured details (e.g. which fields were invalid)
   */
  constructor(msg, d = {}) {
    super(msg, 400, 'VALIDATION_ERROR', d);
  }
}

/**
 * Thrown when a requested resource (run, report, file) does not exist.
 * Maps to HTTP 404.
 */
export class NotFoundError extends AppError {
  /**
   * @param {string} msg - Describes what was not found
   * @param {Object} [d={}] - Structured details (e.g. the ID that was looked up)
   */
  constructor(msg, d = {}) {
    super(msg, 404, 'NOT_FOUND', d);
  }
}

/**
 * Thrown when CSV parsing or row-level ingestion fails due to unprocessable data.
 * Maps to HTTP 422 — the data is syntactically valid but semantically wrong.
 */
export class IngestionError extends AppError {
  /**
   * @param {string} msg - Describes the ingestion failure
   * @param {Object} [d={}] - Structured details (e.g. row number, raw value)
   */
  constructor(msg, d = {}) {
    super(msg, 422, 'INGESTION_ERROR', d);
  }
}

/**
 * Thrown when the matching algorithm encounters an irrecoverable internal error.
 * Maps to HTTP 500 — not the caller's fault.
 */
export class MatchingError extends AppError {
  /**
   * @param {string} msg - Describes the matching failure
   * @param {Object} [d={}] - Structured details (e.g. candidate counts, stage)
   */
  constructor(msg, d = {}) {
    super(msg, 500, 'MATCHING_ERROR', d);
  }
}

/**
 * Thrown when report generation or retrieval fails.
 * Maps to HTTP 500.
 */
export class ReportError extends AppError {
  /**
   * @param {string} msg - Describes the report failure
   * @param {Object} [d={}] - Structured details (e.g. runId, output path)
   */
  constructor(msg, d = {}) {
    super(msg, 500, 'REPORT_ERROR', d);
  }
}

/**
 * Thrown when application configuration is invalid or missing.
 * Maps to HTTP 400 because it's typically a deployment/operator error.
 */
export class ConfigError extends AppError {
  /**
   * @param {string} msg - Describes the config issue
   * @param {Object} [d={}] - Structured details (e.g. env var name, expected type)
   */
  constructor(msg, d = {}) {
    super(msg, 400, 'CONFIG_ERROR', d);
  }
}
