import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Joi from 'joi';
import dotenv from 'dotenv';

import { ConfigError } from './errors.js';
import {
  DEFAULT_TIMESTAMP_TOLERANCE_SECS,
  DEFAULT_QUANTITY_TOLERANCE_PCT,
  DEFAULT_REQUIRE_EXACT_TYPE,
  DEFAULT_MAX_CANDIDATE_WINDOW,
  MAX_CSV_FILE_BYTES,
  DEFAULT_RECONCILE_RATE_LIMIT,
  DEFAULT_REPORT_RATE_LIMIT,
  BULK_INSERT_CHUNK_SIZE,
  RUN_TIMEOUT_MS,
  DEFAULT_WORKER_CONCURRENCY,
  UNMATCHED_RATE_WARN_THRESHOLD,
} from './constants.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────
// Load .env before anything else reads process.env
dotenv.config();

// eslint-disable-next-line no-underscore-dangle
const __filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line no-underscore-dangle
const __dirname = dirname(__filename);

// ─── Load static alias maps (asset & type) ───────────────────────────────────
// These live in version control, not env vars, because they change with the
// product, not the deployment environment.
const defaultConfigPath = resolve(__dirname, '../../config/default.json');
let aliasConfig;
try {
  aliasConfig = JSON.parse(readFileSync(defaultConfigPath, 'utf-8'));
} catch (err) {
  throw new ConfigError('Failed to load config/default.json', {
    path: defaultConfigPath,
    originalError: err.message,
  });
}

// ─── Joi Schema ───────────────────────────────────────────────────────────────
// Every env var the application owns is declared here with types, defaults,
// and constraints. `.unknown(true)` lets system env vars (PATH, etc.) pass
// through without tripping validation.
const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().port().default(3000),

  // ── Database
  MONGODB_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .default('mongodb://localhost:27017/koinx_reconciliation'),

  // ── Redis / BullMQ
  REDIS_HOST: Joi.string().hostname().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  WORKER_CONCURRENCY: Joi.number()
    .integer()
    .min(1)
    .max(20)
    .default(DEFAULT_WORKER_CONCURRENCY),

  // ── Matching tolerances (runtime defaults, overridable per-run)
  TIMESTAMP_TOLERANCE_SECONDS: Joi.number()
    .min(0)
    .default(DEFAULT_TIMESTAMP_TOLERANCE_SECS),
  QUANTITY_TOLERANCE_PCT: Joi.number()
    .min(0)
    .max(1)
    .default(DEFAULT_QUANTITY_TOLERANCE_PCT),
  REQUIRE_EXACT_TYPE: Joi.boolean().default(DEFAULT_REQUIRE_EXACT_TYPE),
  MAX_CANDIDATE_WINDOW: Joi.number()
    .integer()
    .min(1)
    .default(DEFAULT_MAX_CANDIDATE_WINDOW),

  // ── Security
  ALLOWED_FILE_BASE_DIR: Joi.string().default('./data'),
  MAX_CSV_FILE_BYTES: Joi.number()
    .integer()
    .min(1)
    .default(MAX_CSV_FILE_BYTES),
  RECONCILE_RATE_LIMIT: Joi.number()
    .integer()
    .min(1)
    .default(DEFAULT_RECONCILE_RATE_LIMIT),
  REPORT_RATE_LIMIT: Joi.number()
    .integer()
    .min(1)
    .default(DEFAULT_REPORT_RATE_LIMIT),

  // ── Performance
  BULK_INSERT_CHUNK_SIZE: Joi.number()
    .integer()
    .min(1)
    .default(BULK_INSERT_CHUNK_SIZE),
  RUN_TIMEOUT_MS: Joi.number().integer().min(1000).default(RUN_TIMEOUT_MS),

  // ── Output
  REPORT_OUTPUT_DIR: Joi.string().default('./reports'),

  // ── Observability
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .default('info'),
  LOG_DIR: Joi.string().default('./logs'),
  UNMATCHED_RATE_WARN_THRESHOLD: Joi.number()
    .min(0)
    .max(1)
    .default(UNMATCHED_RATE_WARN_THRESHOLD),
}).unknown(true); // allow system env vars to pass through

// ─── Validate ─────────────────────────────────────────────────────────────────
const { error, value: env } = envSchema.validate(process.env);

if (error) {
  // Hard exit — running with invalid config would cause cascading failures
  // that are much harder to debug than a clear startup error.
  const detail = error.details.map((d) => d.message).join('; ');
  /* eslint-disable no-console */
  console.error(`FATAL: Invalid environment configuration → ${detail}`);
  /* eslint-enable no-console */
  process.exit(1);
}

// ─── Frozen Config Object ─────────────────────────────────────────────────────
// camelCase property names per project convention. This is the ONLY place
// process.env is read; every other module imports `config` from here.

/**
 * Application-wide configuration. Frozen to prevent accidental mutation.
 * All values are validated via Joi on startup.
 *
 * @type {Readonly<{
 *   nodeEnv: string,
 *   port: number,
 *   mongodbUri: string,
 *   redisHost: string,
 *   redisPort: number,
 *   workerConcurrency: number,
 *   timestampToleranceSecs: number,
 *   quantityTolerancePct: number,
 *   requireExactType: boolean,
 *   maxCandidateWindow: number,
 *   allowedFileBaseDir: string,
 *   maxCsvFileBytes: number,
 *   reconcileRateLimit: number,
 *   reportRateLimit: number,
 *   bulkInsertChunkSize: number,
 *   runTimeoutMs: number,
 *   reportOutputDir: string,
 *   logLevel: string,
 *   logDir: string,
 *   unmatchedRateWarnThreshold: number,
 *   assetAliases: Record<string, string>,
 *   typeAliases: Record<string, string>,
 * }>}
 */
export const config = Object.freeze({
  nodeEnv: env.NODE_ENV,
  port: Number(env.PORT),

  mongodbUri: env.MONGODB_URI,

  redisHost: env.REDIS_HOST,
  redisPort: Number(env.REDIS_PORT),
  workerConcurrency: Number(env.WORKER_CONCURRENCY),

  timestampToleranceSecs: Number(env.TIMESTAMP_TOLERANCE_SECONDS),
  quantityTolerancePct: Number(env.QUANTITY_TOLERANCE_PCT),
  requireExactType: env.REQUIRE_EXACT_TYPE,
  maxCandidateWindow: Number(env.MAX_CANDIDATE_WINDOW),

  allowedFileBaseDir: resolve(env.ALLOWED_FILE_BASE_DIR),
  maxCsvFileBytes: Number(env.MAX_CSV_FILE_BYTES),
  reconcileRateLimit: Number(env.RECONCILE_RATE_LIMIT),
  reportRateLimit: Number(env.REPORT_RATE_LIMIT),

  bulkInsertChunkSize: Number(env.BULK_INSERT_CHUNK_SIZE),
  runTimeoutMs: Number(env.RUN_TIMEOUT_MS),

  reportOutputDir: resolve(env.REPORT_OUTPUT_DIR),

  logLevel: env.LOG_LEVEL,
  logDir: resolve(env.LOG_DIR),
  unmatchedRateWarnThreshold: Number(env.UNMATCHED_RATE_WARN_THRESHOLD),

  // Static alias maps loaded from config/default.json
  assetAliases: Object.freeze({ ...aliasConfig.assetAliases }),
  typeAliases: Object.freeze({ ...aliasConfig.typeAliases }),
});
