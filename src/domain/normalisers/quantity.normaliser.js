// ---------------------------------------------------------------------------
// quantity.normaliser.js — Parses raw quantity values into Decimal instances.
// Uses decimal.js to avoid IEEE 754 floating-point drift that would create
// false conflicts during reconciliation (e.g. 0.1 + 0.2 ≠ 0.3).
// ---------------------------------------------------------------------------
import Decimal from 'decimal.js';
import {
  QUALITY_FLAGS,
  QUANTITY_SANITY_CAP,
} from '../../infrastructure/constants.js';

/**
 * Normalise a raw quantity value into a Decimal.
 *
 * Rejects:
 *   - Non-parseable values (NaN, empty strings, objects) → INVALID_QUANTITY
 *   - Infinity → INVALID_QUANTITY
 *   - Zero or negative values → INVALID_QUANTITY
 *   - Values exceeding the sanity cap (1e15) → QUANTITY_OVERFLOW
 *
 * @param {string | number} rawQuantity — The raw quantity from a CSV row.
 * @returns {{ value: Decimal | null, flag: string | null }}
 *   `value` is a Decimal on success, `null` on failure.
 *   `flag` is `null` on success, or the relevant quality flag code.
 *
 * @example
 * normaliseQuantity('1.2345')    // { value: Decimal(1.2345), flag: null }
 * normaliseQuantity(0)           // { value: null, flag: 'INVALID_QUANTITY' }
 * normaliseQuantity('2e16')      // { value: null, flag: 'QUANTITY_OVERFLOW' }
 */
export function normaliseQuantity(rawQuantity) {
  if (rawQuantity == null || rawQuantity === '') {
    return { value: null, flag: QUALITY_FLAGS.INVALID_QUANTITY };
  }

  let decimal;
  try {
    decimal = new Decimal(rawQuantity);
  } catch {
    // Decimal constructor throws on unparseable input (NaN strings, objects, etc.)
    return { value: null, flag: QUALITY_FLAGS.INVALID_QUANTITY };
  }

  // Reject non-finite values (Infinity, -Infinity, NaN)
  if (!decimal.isFinite()) {
    return { value: null, flag: QUALITY_FLAGS.INVALID_QUANTITY };
  }

  // Reject zero — a zero-quantity transaction is nonsensical
  if (decimal.isZero()) {
    return { value: null, flag: QUALITY_FLAGS.INVALID_QUANTITY };
  }

  // Reject negative — quantities represent absolute amounts
  if (decimal.isNegative()) {
    return { value: null, flag: QUALITY_FLAGS.INVALID_QUANTITY };
  }

  // Sanity cap — catches data corruption (e.g. missing decimal point)
  if (decimal.greaterThan(new Decimal(QUANTITY_SANITY_CAP))) {
    return { value: null, flag: QUALITY_FLAGS.QUANTITY_OVERFLOW };
  }

  return { value: decimal, flag: null };
}
