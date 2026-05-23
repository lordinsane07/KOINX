// ---------------------------------------------------------------------------
// type.normaliser.js — Resolves raw transaction types to canonical types.
// TRANSFER_IN and TRANSFER_OUT both collapse to 'TRANSFER' — one transaction,
// two perspectives. The alias map is injected to keep the function pure.
// ---------------------------------------------------------------------------
import { QUALITY_FLAGS } from '../../infrastructure/constants.js';

/**
 * Normalise a raw transaction type string into its canonical form.
 *
 * Canonical types: BUY, SELL, TRANSFER, FEE, REWARD.
 *
 * Key behaviour: TRANSFER_IN and TRANSFER_OUT both map to 'TRANSFER'
 * because they represent the same on-chain movement viewed from different
 * accounts — the "perspective flip" described in the PRD.
 *
 * @param {string} rawType       — The raw type value from a CSV row (e.g. "deposit", "TRANSFER_IN").
 * @param {Record<string, string>} typeAliasMap — Lowercase-keyed map of type aliases → canonical types
 *                                                (sourced from config/default.json at runtime).
 * @returns {{ value: string | null, flag: string | null }}
 *   `value` is the canonical type on success, `null` on failure.
 *   `flag` is `null` on success, `UNKNOWN_TYPE` when the alias cannot be resolved.
 *
 * @example
 * normaliseType('DEPOSIT', { deposit: 'BUY' })        // { value: 'BUY', flag: null }
 * normaliseType('transfer_in', { transfer_in: 'TRANSFER' })  // { value: 'TRANSFER', flag: null }
 * normaliseType('SWAP', {})                            // { value: null, flag: 'UNKNOWN_TYPE' }
 */
export function normaliseType(rawType, typeAliasMap) {
  if (rawType == null || typeof rawType !== 'string' || rawType.trim() === '') {
    return { value: null, flag: QUALITY_FLAGS.UNKNOWN_TYPE };
  }

  const key = rawType.trim().toLowerCase();
  const canonical = typeAliasMap[key];

  if (canonical) {
    return { value: canonical, flag: null };
  }

  return { value: null, flag: QUALITY_FLAGS.UNKNOWN_TYPE };
}
