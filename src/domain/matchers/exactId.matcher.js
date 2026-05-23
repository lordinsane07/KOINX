// ---------------------------------------------------------------------------
// exactId.matcher.js — Pass 1 of the matching engine.
// Matches user records to exchange records by exact txHash or exchangeId
// string equality. Greedy first-match-wins strategy ensures each record
// participates in at most one match — preventing double-counting.
// ---------------------------------------------------------------------------

/**
 * Build a lookup Map keyed by a given field, grouping records that share
 * the same non-null field value. When multiple records share an ID, only
 * the first unconsumed one will match (greedy).
 *
 * @param {object[]} records   — Array of normalised transaction records.
 * @param {string}   fieldName — The field to index on ('txHash' or 'exchangeId').
 * @returns {Map<string, object[]>} — Map from field value to array of records.
 */
function buildIndex(records, fieldName) {
  const index = new Map();

  for (const record of records) {
    const key = record[fieldName];
    if (key == null || key === '') continue;

    const keyStr = String(key);
    if (!index.has(keyStr)) {
      index.set(keyStr, []);
    }
    index.get(keyStr).push(record);
  }

  return index;
}

/**
 * Perform exact-ID matching (Pass 1) between user and exchange records.
 *
 * Strategy:
 *   1. Build two Maps over exchange records — one keyed by txHash, one by exchangeId.
 *   2. For each user record that has a non-null txHash or exchangeId, look up
 *      a matching exchange record.
 *   3. txHash takes priority over exchangeId (more globally unique).
 *   4. Each exchange record can match at most once — consumed records are
 *      tracked in a Set to prevent double-matching.
 *   5. Each user record can match at most once — first match wins.
 *
 * @param {object[]} userRecords     — Normalised user-side transaction records.
 * @param {object[]} exchangeRecords — Normalised exchange-side transaction records.
 * @returns {{
 *   exactMatches: Array<{ user: object, exchange: object }>,
 *   userRemainder: object[],
 *   exchangeRemainder: object[]
 * }}
 *
 * @example
 * const result = exactIdMatch(
 *   [{ txHash: 'abc', asset: 'BTC', quantity: 1 }],
 *   [{ txHash: 'abc', asset: 'BTC', quantity: 1 }, { txHash: 'def', asset: 'ETH', quantity: 2 }]
 * );
 * // result.exactMatches.length === 1
 * // result.exchangeRemainder.length === 1
 */
export function exactIdMatch(userRecords, exchangeRecords) {
  const hashIndex = buildIndex(exchangeRecords, 'txHash');
  const idIndex = buildIndex(exchangeRecords, 'exchangeId');

  /** Track consumed exchange records by reference to prevent double-matching */
  const usedExchange = new Set();
  const exactMatches = [];
  const userRemainder = [];

  for (const userRec of userRecords) {
    let matched = false;

    // Try txHash first — it's the stronger identifier
    if (!matched && userRec.txHash != null && userRec.txHash !== '') {
      const candidates = hashIndex.get(String(userRec.txHash));
      if (candidates) {
        for (const candidate of candidates) {
          if (!usedExchange.has(candidate)) {
            exactMatches.push({ user: userRec, exchange: candidate });
            usedExchange.add(candidate);
            matched = true;
            break;
          }
        }
      }
    }

    // Fall back to exchangeId
    if (!matched && userRec.exchangeId != null && userRec.exchangeId !== '') {
      const candidates = idIndex.get(String(userRec.exchangeId));
      if (candidates) {
        for (const candidate of candidates) {
          if (!usedExchange.has(candidate)) {
            exactMatches.push({ user: userRec, exchange: candidate });
            usedExchange.add(candidate);
            matched = true;
            break;
          }
        }
      }
    }

    if (!matched) {
      userRemainder.push(userRec);
    }
  }

  // Any exchange record not consumed becomes remainder
  const exchangeRemainder = exchangeRecords.filter((rec) => !usedExchange.has(rec));

  return { exactMatches, userRemainder, exchangeRemainder };
}
