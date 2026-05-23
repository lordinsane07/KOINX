import { exactIdMatch } from '../../../src/domain/matchers/exactId.matcher.js';

describe('exactIdMatch - Pass 1 matching by exact ID or hash', () => {
  test('should match by txHash and exclude from remainder', () => {
    const userRecs = [{ txHash: 'hash1', asset: 'BTC', quantity: 0.5 }];
    const exchangeRecs = [
      { txHash: 'hash1', asset: 'BTC', quantity: 0.5 },
      { txHash: 'hash2', asset: 'ETH', quantity: 2.0 },
    ];

    const result = exactIdMatch(userRecs, exchangeRecs);

    expect(result.exactMatches.length).toBe(1);
    expect(result.exactMatches[0].user).toEqual(userRecs[0]);
    expect(result.exactMatches[0].exchange).toEqual(exchangeRecs[0]);
    expect(result.userRemainder.length).toBe(0);
    expect(result.exchangeRemainder.length).toBe(1);
    expect(result.exchangeRemainder[0]).toEqual(exchangeRecs[1]);
  });

  test('should match by exchangeId as a fallback if txHash is missing', () => {
    const userRecs = [{ exchangeId: 'EXC-100', asset: 'BTC', quantity: 0.5 }];
    const exchangeRecs = [
      { exchangeId: 'EXC-100', asset: 'BTC', quantity: 0.5 },
    ];

    const result = exactIdMatch(userRecs, exchangeRecs);

    expect(result.exactMatches.length).toBe(1);
    expect(result.userRemainder.length).toBe(0);
    expect(result.exchangeRemainder.length).toBe(0);
  });

  test('should strong-prefer matching by txHash over exchangeId when both are populated', () => {
    const userRecs = [
      {
        txHash: 'hash1', exchangeId: 'EXC-200', asset: 'BTC', quantity: 0.5,
      },
    ];
    const exchangeRecs = [
      {
        txHash: 'hash1', exchangeId: 'EXC-100', asset: 'BTC', quantity: 0.5,
      },
    ];

    const result = exactIdMatch(userRecs, exchangeRecs);

    expect(result.exactMatches.length).toBe(1);
    expect(result.exactMatches[0].exchange.exchangeId).toBe('EXC-100'); // matched on hash1
  });

  test('should correctly handle no-matches and preserve remainders', () => {
    const userRecs = [{ txHash: 'hash-user', asset: 'BTC', quantity: 0.5 }];
    const exchangeRecs = [{ txHash: 'hash-exchange', asset: 'BTC', quantity: 0.5 }];

    const result = exactIdMatch(userRecs, exchangeRecs);

    expect(result.exactMatches.length).toBe(0);
    expect(result.userRemainder.length).toBe(1);
    expect(result.exchangeRemainder.length).toBe(1);
  });
});
