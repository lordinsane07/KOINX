// ---------------------------------------------------------------------------
// row.validator.js — Validates that a raw CSV row contains all required fields
// before normalisation is attempted. This is the first line of defence against
// incomplete data — it runs BEFORE normalisers touch the row.
// ---------------------------------------------------------------------------
import { QUALITY_FLAGS, REQUIRED_FIELDS } from '../../infrastructure/constants.js';

/**
 * Check whether a value is "present" — i.e. non-null, non-undefined,
 * and (if a string) non-empty after trimming.
 *
 * @param {*} value — The field value to check.
 * @returns {boolean}
 */
function isPresent(value) {
  if (value == null) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

/**
 * Validate that a raw CSV row object contains all required fields
 * with non-empty values.
 *
 * Required fields: timestamp, asset, type, quantity.
 * Each missing or empty field adds a `MISSING_FIELD` flag to the result.
 *
 * @param {Record<string, *>} row — A single parsed CSV row (key-value pairs).
 * @returns {{ isValid: boolean, qualityFlags: string[] }}
 *   `isValid` is `true` only when `qualityFlags` is empty (all fields present).
 *   `qualityFlags` contains one `MISSING_FIELD` entry per absent field.
 *
 * @example
 * validateRow({ timestamp: '2024-01-15', asset: 'BTC', type: 'BUY', quantity: '1.0' })
 * // { isValid: true, qualityFlags: [] }
 *
 * validateRow({ timestamp: '2024-01-15', asset: '', type: 'BUY', quantity: '1.0' })
 * // { isValid: false, qualityFlags: ['MISSING_FIELD'] }
 *
 * validateRow({})
 * // { isValid: false, qualityFlags: ['MISSING_FIELD', 'MISSING_FIELD', 'MISSING_FIELD', 'MISSING_FIELD'] }
 */
export function validateRow(row) {
  const qualityFlags = [];

  for (const field of REQUIRED_FIELDS) {
    if (!isPresent(row[field])) {
      qualityFlags.push(QUALITY_FLAGS.MISSING_FIELD);
    }
  }

  return {
    isValid: qualityFlags.length === 0,
    qualityFlags,
  };
}
