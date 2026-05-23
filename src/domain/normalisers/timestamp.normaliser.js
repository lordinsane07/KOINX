// ---------------------------------------------------------------------------
// timestamp.normaliser.js — Parses a wide variety of timestamp formats into
// UTC Date objects. Uses date-fns exclusively — never `new Date(string)` —
// because constructor parsing is implementation-defined across engines.
// ---------------------------------------------------------------------------
import { parseISO, parse, isValid } from 'date-fns';
import {
  QUALITY_FLAGS,
  FUTURE_TIMESTAMP_BUFFER_MS,
} from '../../infrastructure/constants.js';

/**
 * All date format strings we attempt, in priority order.
 * Formats with time components are tried before date-only variants so that
 * precision is preserved when it exists in the source data.
 */
const FORMAT_STRINGS = [
  'dd/MM/yyyy HH:mm:ss',
  'dd/MM/yyyy',
  'MM-dd-yyyy HH:mm:ss',
  'MM-dd-yyyy',
];

/**
 * Unix-epoch seconds threshold: values below this are treated as seconds,
 * values at or above are treated as milliseconds. 1e12 ≈ Nov 2001 in ms,
 * which is well beyond any realistic seconds-based timestamp.
 */
const UNIX_MS_THRESHOLD = 1e12;

/**
 * Attempt to parse a raw timestamp value into a UTC Date.
 *
 * Supported formats (tried in order):
 *   1. Numeric — Unix seconds (< 1e12) or Unix milliseconds (≥ 1e12)
 *   2. ISO 8601 string (via `parseISO`)
 *   3. dd/MM/yyyy [HH:mm:ss]
 *   4. MM-dd-yyyy [HH:mm:ss]
 *
 * @param {string | number} rawTimestamp — The raw timestamp from a CSV row.
 * @param {number} [nowMs=Date.now()]    — Current time in ms; injectable for testing.
 * @returns {{ value: Date | null, flag: string | null }}
 *   `value` is a UTC Date on success, `null` on failure.
 *   `flag` is `null` on success, `INVALID_TIMESTAMP` if unparseable,
 *   or `FUTURE_TIMESTAMP` if the parsed date exceeds `now + buffer`.
 */
export function normaliseTimestamp(rawTimestamp, nowMs = Date.now()) {
  if (rawTimestamp == null || rawTimestamp === '') {
    return { value: null, flag: QUALITY_FLAGS.INVALID_TIMESTAMP };
  }

  let parsed = null;

  // ── Numeric path: Unix seconds or milliseconds ───────────────────────
  const numeric = typeof rawTimestamp === 'number' ? rawTimestamp : Number(rawTimestamp);

  if (!Number.isNaN(numeric) && Number.isFinite(numeric) && typeof rawTimestamp === 'number') {
    const ms = numeric < UNIX_MS_THRESHOLD ? numeric * 1000 : numeric;
    parsed = new Date(ms);
  }

  // ── String path ──────────────────────────────────────────────────────
  if (parsed === null && typeof rawTimestamp === 'string') {
    const trimmed = rawTimestamp.trim();

    if (trimmed === '') {
      return { value: null, flag: QUALITY_FLAGS.INVALID_TIMESTAMP };
    }

    // Try numeric strings (e.g. "1700000000")
    const numericStr = Number(trimmed);
    if (!Number.isNaN(numericStr) && Number.isFinite(numericStr) && /^\d+(\.\d+)?$/.test(trimmed)) {
      const ms = numericStr < UNIX_MS_THRESHOLD ? numericStr * 1000 : numericStr;
      parsed = new Date(ms);
    }

    // Try ISO 8601
    if (parsed === null) {
      const iso = parseISO(trimmed);
      if (isValid(iso)) {
        parsed = iso;
      }
    }

    // Try each regional format string
    if (parsed === null) {
      /** @type {Date} reference date — only used as a fallback by date-fns parse */
      const referenceDate = new Date(0);
      for (const fmt of FORMAT_STRINGS) {
        const attempt = parse(trimmed, fmt, referenceDate);
        if (isValid(attempt)) {
          parsed = attempt;
          break;
        }
      }
    }
  }

  // ── Unparseable ──────────────────────────────────────────────────────
  if (parsed === null || !isValid(parsed)) {
    return { value: null, flag: QUALITY_FLAGS.INVALID_TIMESTAMP };
  }

  // ── Future guard ─────────────────────────────────────────────────────
  if (parsed.getTime() > nowMs + FUTURE_TIMESTAMP_BUFFER_MS) {
    return { value: null, flag: QUALITY_FLAGS.FUTURE_TIMESTAMP };
  }

  return { value: parsed, flag: null };
}
