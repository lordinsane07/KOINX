import { normaliseAsset } from '../../../src/domain/normalisers/asset.normaliser.js';
import { QUALITY_FLAGS } from '../../../src/infrastructure/constants.js';

describe('normaliseAsset', () => {
  const aliasMap = {
    bitcoin: 'BTC',
    btc: 'BTC',
    xbt: 'BTC',
    ether: 'ETH',
    ethereum: 'ETH',
    eth: 'ETH',
  };

  test('should resolve canonical tickers for direct match', () => {
    expect(normaliseAsset('BTC', aliasMap)).toEqual({ value: 'BTC', flag: null });
    expect(normaliseAsset('btc', aliasMap)).toEqual({ value: 'BTC', flag: null });
  });

  test('should resolve canonical tickers for common aliases', () => {
    expect(normaliseAsset('Bitcoin', aliasMap)).toEqual({ value: 'BTC', flag: null });
    expect(normaliseAsset('Ethereum', aliasMap)).toEqual({ value: 'ETH', flag: null });
    expect(normaliseAsset('xbt', aliasMap)).toEqual({ value: 'BTC', flag: null });
  });

  test('should return UNKNOWN_ASSET flag when alias cannot be resolved', () => {
    expect(normaliseAsset('DOGE', aliasMap)).toEqual({ value: null, flag: QUALITY_FLAGS.UNKNOWN_ASSET });
    expect(normaliseAsset('', aliasMap)).toEqual({ value: null, flag: QUALITY_FLAGS.UNKNOWN_ASSET });
    expect(normaliseAsset(null, aliasMap)).toEqual({ value: null, flag: QUALITY_FLAGS.UNKNOWN_ASSET });
  });
});
