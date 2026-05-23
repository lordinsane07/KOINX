// ---------------------------------------------------------------------------
// scoring.js — Composite match-score calculator (0–100).
// Combines four dimensions into a single confidence number that drives
// tie-breaking in the fuzzy matcher. Uses Decimal for percentage math
// to avoid IEEE 754 drift on tight tolerances (e.g. 0.009% vs 0.010%).
// ---------------------------------------------------------------------------
import Decimal from 'decimal.js';
import {
  SCORE_TIMESTAMP_MAX,
  SCORE_QUANTITY_MAX,
  SCORE_TYPE_EXACT_BONUS,
  SCORE_HASH_MATCH_BONUS,
} from '../../infrastructure/constants.js';

/**
 * Clamp a numeric value into the range [min, max].
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Compute a composite match score (0–100) for a candidate user↔exchange pair.
 *
 * Scoring breakdown:
 *   - **Timestamp proximity** (0–40): Linear decay from 40 → 0 as deltaSeconds
 *     approaches toleranceSecs. Hard zero if deltaSeconds > toleranceSecs.
 *   - **Quantity proximity** (0–40): Linear decay from 40 → 0 as deltaPct
 *     approaches tolerancePct. Hard zero if deltaPct > tolerancePct.
 *     Uses Decimal arithmetic to prevent float drift on tight tolerances.
 *   - **Type exact match** (0 or 10): Binary bonus when canonical types
 *     are identical (not just alias-equivalent).
 *   - **Hash match** (0 or 10): Binary bonus when txHash values are
 *     identical and non-null.
 *
 * If either the timestamp or quantity delta exceeds its tolerance, the entire
 * score is 0 — there is no partial match outside the tolerance window.
 *
 * @param {object} params
 * @param {number} params.deltaSeconds     — Absolute timestamp difference in seconds.
 * @param {number} params.toleranceSecs    — Maximum allowed timestamp delta.
 * @param {number|string} params.deltaPct  — Absolute quantity delta as a percentage (e.g. 0.005 = 0.5%).
 * @param {number|string} params.tolerancePct — Maximum allowed quantity delta percentage.
 * @param {boolean} params.typeExact       — Whether canonical types match exactly.
 * @param {boolean} params.hashMatch       — Whether txHash values match.
 * @returns {number} Integer score in [0, 100].
 *
 * @example
 * computeScore({ deltaSeconds: 30, toleranceSecs: 300, deltaPct: 0.003, tolerancePct: 0.01, typeExact: true, hashMatch: false })
 * // → 86  (timestamp: 36 + quantity: 28 + type: 10 + hash: 0 → round(74) ← example)
 */
export function computeScore({
  deltaSeconds,
  toleranceSecs,
  deltaPct,
  tolerancePct,
  typeExact,
  hashMatch,
}) {
  // Hard cutoffs — beyond tolerance means zero confidence
  if (deltaSeconds > toleranceSecs) return 0;
  if (new Decimal(deltaPct).greaterThan(new Decimal(tolerancePct))) return 0;

  // Timestamp component: linearly decays from max → 0 as delta grows
  const timestampScore = clamp(
    SCORE_TIMESTAMP_MAX * (1 - deltaSeconds / toleranceSecs),
    0,
    SCORE_TIMESTAMP_MAX,
  );

  // Quantity component: Decimal arithmetic avoids drift on tight tolerances
  const dPct = new Decimal(deltaPct);
  const tPct = new Decimal(tolerancePct);
  const quantityRatio = tPct.isZero()
    ? new Decimal(0)
    : new Decimal(1).minus(dPct.dividedBy(tPct));
  const quantityScore = clamp(
    new Decimal(SCORE_QUANTITY_MAX).times(quantityRatio).toNumber(),
    0,
    SCORE_QUANTITY_MAX,
  );

  // Binary bonuses
  const typeScore = typeExact ? SCORE_TYPE_EXACT_BONUS : 0;
  const hashScore = hashMatch ? SCORE_HASH_MATCH_BONUS : 0;

  return Math.round(timestampScore + quantityScore + typeScore + hashScore);
}
