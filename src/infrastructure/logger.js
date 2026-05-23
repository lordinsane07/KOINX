import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

import { config } from './config.js';

// ─── Custom format: attach full stack trace for Error instances ───────────────
const enumerateErrorFormat = winston.format((info) => {
  if (info instanceof Error) {
    Object.assign(info, { message: info.message, stack: info.stack });
  }
  return info;
});

// ─── Transports ───────────────────────────────────────────────────────────────

/**
 * Console transport — silenced in test to keep `jest` output clean.
 * JSON format matches the file transports so log aggregators (Loki, ELK)
 * can ingest from either source without format gymnastics.
 */
const consoleTransport = new winston.transports.Console({
  silent: config.nodeEnv === 'test',
});

/**
 * All-level application log, rotated daily.
 * 30-day retention balances storage cost against debugging needs.
 * 50 MB cap per file prevents a single noisy day from filling disk.
 */
const appRotateTransport = new DailyRotateFile({
  dirname: config.logDir,
  filename: 'app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '50m',
  maxFiles: '30d',
  zippedArchive: true,
});

/**
 * Error-only log with 90-day retention.
 * Longer retention because error investigations often span weeks.
 */
const errorRotateTransport = new DailyRotateFile({
  dirname: config.logDir,
  filename: 'error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: '50m',
  maxFiles: '90d',
  zippedArchive: true,
});

// ─── Logger Instance ──────────────────────────────────────────────────────────

/**
 * Application-wide Winston logger singleton.
 *
 * Conventions:
 * - `logger.info()` for happy-path milestones (run started, ingestion complete)
 * - `logger.warn()` for recoverable anomalies (unmatched rate above threshold)
 * - `logger.error()` for failures that need operator attention
 * - Always pass structured metadata as the second argument, e.g.
 *   `logger.info('Run started', { runId })`
 *
 * @type {winston.Logger}
 */
const logger = winston.createLogger({
  level: config.logLevel,
  defaultMeta: { service: 'reconciliation-engine' },
  format: winston.format.combine(
    enumerateErrorFormat(),
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [consoleTransport, appRotateTransport, errorRotateTransport],
});

export { logger };
export default logger;
