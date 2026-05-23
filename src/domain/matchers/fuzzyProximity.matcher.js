// ---------------------------------------------------------------------------
// fuzzyProximity.matcher.js — Pass 2 of the matching engine.
// Finds the best match for each user record among unmatched exchange records
// using timestamp proximity + quantity similarity + type & hash bonuses.
//
// Performance: exchange records are pre-sorted by timestamp and binary search
// narrows the candidate window to O(log n + w) per user record, where w is
// the number of candidates within the timestamp tolerance.
// ---------------------------------------------------------------------------
import Decimal from 'decimal.js';
import { computeScore } from './scoring.js';
import { binarySearchLower, binarySearchUpper } from '../utils/binarySearch.js';

/**
 * Calculate the absolute percentage delta between two Decimal quantities,
 * relative to the exchange value (the "truth" side).
 *
 * @param {Decimal} userQty     — User-reported quantity.
 * @param {Decimal} exchangeQty — Exchange-reported quantity.
 * @returns {Decimal} Absolute percentage delta (e.g. 0.005 means 0.5%).
 */
function quantityDeltaPct(userQty, exchangeQty) {
  if (exchangeQty.isZero()) {
    // Avoid division by zero — treat as infinite delta
    return new Decimal(Infinity);
  }
  return userQty.minus(exchangeQty).abs().dividedBy(exchangeQty);
}

/**
 * Perform fuzzy proximity matching (Pass 2) between user and exchange records.
 *
 * Algorithm:
 *   1. Pre-sort exchange records by timestamp (ascending).
 *   2. Extract a sorted timestamp array for binary search.
 *   3. For each user record, binary search to find exchange candidates within
 *      ±timestampToleranceSecs of the user timestamp.
 *   4. Filter candidates: same asset, type match (if requireExactType), and
 *      quantity within tolerancePct.
 *   5. Score all surviving candidates via `computeScore()`.
 *   6. Pick the best score. Tie-break: record with the earlier `createdAt`.
 *   7. Mark the winning exchange record as consumed (no double-matching).
 *
 * @param {object[]} userRecords       — Normalised user-side records (remainder from Pass 1).
 * @param {object[]} exchangeRecords   — Normalised exchange-side records (remainder from Pass 1).
 * @param {object} config
 * @param {number} config.timestampToleranceSecs — Max allowed timestamp delta in seconds.
 * @param {number} config.quantityTolerancePct   — Max allowed quantity delta as a fraction (e.g. 0.01 = 1%).
 * @param {boolean} config.requireExactType      — If true, only match records with identical canonical types.
 * @returns {{
 *   fuzzyMatches: Array<{ user: object, exchange: object, score: number }>,
 *   userRemainder: object[],
 *   exchangeRemainder: object[]
 * }}
 *
 * @example
 * const result = fuzzyProximityMatch(userRecs, exchangeRecs, {
 *   timestampToleranceSecs: 300,
 *   quantityTolerancePct: 0.01,
 *   requireExactType: false,
 * });
 */
export function fuzzyProximityMatch(userRecords, exchangeRecords, config) {
  const { timestampToleranceSecs, quantityTolerancePct, requireExactType } = config;
  const tolerancePctDecimal = new Decimal(quantityTolerancePct);
  const toleranceMs = timestampToleranceSecs * 1000;

  // ── Pre-sort exchange records by timestamp (ascending) ───────────────
  const sortedExchange = [...exchangeRecords].sort((a, b) => {
    const tA = a.timestamp instanceof Date ? a.timestamp.getTime() : 0;
    const tB = b.timestamp instanceof Date ? b.timestamp.getTime() : 0;
    return tA - tB;
  });

  // Extract sorted timestamp array for binary search
  const exchangeTimestamps = sortedExchange.map((rec) => (rec.timestamp instanceof Date ? rec.timestamp.getTime() : 0));

  /** Track consumed exchange records to prevent double-matching */
  const usedExchange = new Set();
  const fuzzyMatches = [];
  const userRemainder = [];

  for (const userRec of userRecords) {
    // Skip user records that lack the essential fields for fuzzy matching
    if (
      userRec.timestamp == null
      || userRec.asset == null
      || userRec.quantity == null
    ) {
      userRemainder.push(userRec);
      continue;
    }

    const userMs = userRec.timestamp instanceof Date
      ? userRec.timestamp.getTime()
      : 0;
    const lowerBound = userMs - toleranceMs;
    const upperBound = userMs + toleranceMs;

    // Binary search for the candidate window
    const loIdx = binarySearchLower(exchangeTimestamps, lowerBound);
    const hiIdx = binarySearchUpper(exchangeTimestamps, upperBound);

    let bestCandidate = null;
    let bestScore = -1;

    for (let i = loIdx; i <= hiIdx; i++) {
      const candidate = sortedExchange[i];

      // Skip already-consumed records
      if (usedExchange.has(candidate)) continue;

      // Asset must match (already canonical uppercase)
      if (candidate.asset !== userRec.asset) continue;

      // Type filter — when strict mode is on, canonical types must be identical
      if (requireExactType && candidate.type !== userRec.type) continue;

      // Skip candidates missing quantity
      if (candidate.quantity == null) continue;

      // Quantity tolerance check (Decimal arithmetic)
      const deltaPct = quantityDeltaPct(userRec.quantity, candidate.quantity);
      if (deltaPct.greaterThan(tolerancePctDecimal)) continue;

      // Compute full score
      const candidateMs = candidate.timestamp instanceof Date
        ? candidate.timestamp.getTime()
        : 0;
      const deltaSeconds = Math.abs(userMs - candidateMs) / 1000;
      const typeExact = userRec.type === candidate.type;
      const hashMatch = userRec.txHash != null
        && userRec.txHash !== ''
        && userRec.txHash === candidate.txHash;

      const score = computeScore({
        deltaSeconds,
        toleranceSecs: timestampToleranceSecs,
        deltaPct: deltaPct.toNumber(),
        tolerancePct: quantityTolerancePct,
        typeExact,
        hashMatch,
      });

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      } else if (score === bestScore && bestCandidate != null) {
        // Tie-break: prefer the exchange record with earlier createdAt
        const candidateCreatedAt = candidate.createdAt instanceof Date
          ? candidate.createdAt.getTime()
          : 0;
        const bestCreatedAt = bestCandidate.createdAt instanceof Date
          ? bestCandidate.createdAt.getTime()
          : 0;
        if (candidateCreatedAt < bestCreatedAt) {
          bestCandidate = candidate;
        }
      }
    }

    if (bestCandidate != null && bestScore > 0) {
      fuzzyMatches.push({ user: userRec, exchange: bestCandidate, score: bestScore });
      usedExchange.add(bestCandidate);
    } else {
      userRemainder.push(userRec);
    }
  }

  // Any exchange record not consumed becomes remainder
  const exchangeRemainder = sortedExchange.filter((rec) => !usedExchange.has(rec));

  return { fuzzyMatches, userRemainder, exchangeRemainder };
}
