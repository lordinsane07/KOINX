// ---------------------------------------------------------------------------
// asset.normaliser.js — Resolves free-text asset names to canonical tickers.
// The alias map is injected as a parameter so this function stays pure.
// ---------------------------------------------------------------------------
import { QUALITY_FLAGS } from '../../infrastructure/constants.js';

/**
 * Normalise a raw asset string into its canonical uppercase ticker.
 *
 * @param {string} rawAsset  — The raw asset value from a CSV row (e.g. "Bitcoin", "xbt").
 * @param {Record<string, string>} aliasMap — Lowercase-keyed map of aliases → canonical tickers
 *                                            (sourced from config/default.json at runtime).
 * @returns {{ value: string | null, flag: string | null }}
 *   `value` is the canonical ticker (e.g. "BTC") on success, `null` on failure.
 *   `flag` is `null` on success, `UNKNOWN_ASSET` when the alias cannot be resolved.
 *
 * @example
 * normaliseAsset('Bitcoin', { bitcoin: 'BTC' })  // { value: 'BTC', flag: null }
 * normaliseAsset('SHIB', { bitcoin: 'BTC' })     // { value: null, flag: 'UNKNOWN_ASSET' }
 */
export function normaliseAsset(rawAsset, aliasMap) {
  if (rawAsset == null || typeof rawAsset !== 'string' || rawAsset.trim() === '') {
    return { value: null, flag: QUALITY_FLAGS.UNKNOWN_ASSET };
  }

  const key = rawAsset.trim().toLowerCase();
  const canonical = aliasMap[key];

  if (canonical) {
    return { value: canonical, flag: null };
  }

  return { value: null, flag: QUALITY_FLAGS.UNKNOWN_ASSET };
}
