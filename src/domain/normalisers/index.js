// ---------------------------------------------------------------------------
// index.js — Orchestrates all four normalisers for a single CSV row.
// Aggregates quality flags from each normaliser into a single flags array,
// enabling downstream code to make one call per row.
// ---------------------------------------------------------------------------
import { normaliseAsset } from './asset.normaliser.js';
import { normaliseType } from './type.normaliser.js';
import { normaliseTimestamp } from './timestamp.normaliser.js';
import { normaliseQuantity } from './quantity.normaliser.js';

/**
 * Field-name aliases for txHash — CSV headers vary across exchanges.
 * Order matters: first match wins.
 * @type {string[]}
 */
const TX_HASH_FIELDS = ['txHash', 'tx_hash', 'hash'];

/**
 * Field-name aliases for exchangeId — CSV headers vary across platforms.
 * @type {string[]}
 */
const EXCHANGE_ID_FIELDS = ['exchangeId', 'exchange_id', 'transaction_id'];

/**
 * Extract the first non-null/non-undefined value from a row for any of the
 * given candidate field names. Handles the reality that different CSV sources
 * use different column names for the same concept.
 *
 * @param {Record<string, *>} row       — The raw CSV row object.
 * @param {string[]} candidates         — Ordered list of possible field names.
 * @returns {string | null}             — The first truthy value found, or null.
 */
function extractField(row, candidates) {
  for (const field of candidates) {
    const value = row[field];
    if (value != null && value !== '') {
      return String(value);
    }
  }
  return null;
}

/**
 * Normalise an entire CSV row by running all four normalisers and extracting
 * optional identifier fields.
 *
 * Each normaliser returns `{ value, flag }`. When a flag is non-null it means
 * the field had a quality issue — the flag is accumulated into the `flags`
 * array. Downstream matchers use `flags.length === 0` to decide whether the
 * row participates in matching.
 *
 * @param {Record<string, *>} row                   — A single parsed CSV row (key-value pairs).
 * @param {Record<string, string>} aliasMap          — Asset alias map from config/default.json.
 * @param {Record<string, string>} typeAliasMap      — Type alias map from config/default.json.
 * @param {number} [nowMs=Date.now()]                — Current time in ms; injectable for testing.
 * @returns {{
 *   normalisedData: {
 *     timestamp: Date | null,
 *     asset: string | null,
 *     type: string | null,
 *     quantity: import('decimal.js').Decimal | null,
 *     txHash: string | null,
 *     exchangeId: string | null
 *   },
 *   flags: string[]
 * }}
 *
 * @example
 * const result = normaliseRow(
 *   { timestamp: '2024-01-15T10:00:00Z', asset: 'bitcoin', type: 'deposit', quantity: '0.5', tx_hash: 'abc123' },
 *   { bitcoin: 'BTC' },
 *   { deposit: 'BUY' }
 * );
 * // result.normalisedData.asset === 'BTC'
 * // result.normalisedData.type === 'BUY'
 * // result.flags === []
 */
export function normaliseRow(row, aliasMap, typeAliasMap, nowMs = Date.now()) {
  const flags = [];

  const timestampResult = normaliseTimestamp(row.timestamp, nowMs);
  if (timestampResult.flag) flags.push(timestampResult.flag);

  const assetResult = normaliseAsset(row.asset, aliasMap);
  if (assetResult.flag) flags.push(assetResult.flag);

  const typeResult = normaliseType(row.type, typeAliasMap);
  if (typeResult.flag) flags.push(typeResult.flag);

  const quantityResult = normaliseQuantity(row.quantity);
  if (quantityResult.flag) flags.push(quantityResult.flag);

  const txHash = extractField(row, TX_HASH_FIELDS);
  const exchangeId = extractField(row, EXCHANGE_ID_FIELDS);

  return {
    normalisedData: {
      timestamp: timestampResult.value,
      asset: assetResult.value,
      type: typeResult.value,
      quantity: quantityResult.value,
      txHash,
      exchangeId,
    },
    flags,
  };
}
