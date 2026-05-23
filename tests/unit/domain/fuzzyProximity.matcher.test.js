import Decimal from 'decimal.js';
import { fuzzyProximityMatch } from '../../../src/domain/matchers/fuzzyProximity.matcher.js';

describe('fuzzyProximityMatch', () => {
  const config = {
    timestampToleranceSecs: 300,
    quantityTolerancePct: 0.01, // 1%
    requireExactType: false,
  };

  test('should match rows within tolerances', () => {
    const userRecs = [
      {
        timestamp: new Date('2024-03-01T09:00:00Z'),
        asset: 'BTC',
        type: 'BUY',
        quantity: new Decimal('0.5'),
      },
    ];
    const exchangeRecs = [
      {
        timestamp: new Date('2024-03-01T09:02:00Z'), // 120s diff (within 300s)
        asset: 'BTC',
        type: 'BUY',
        quantity: new Decimal('0.499'), // 0.2% diff (within 1%)
        createdAt: new Date('2024-03-01T09:02:00Z'),
      },
    ];

    const result = fuzzyProximityMatch(userRecs, exchangeRecs, config);

    expect(result.fuzzyMatches.length).toBe(1);
    expect(result.fuzzyMatches[0].user).toEqual(userRecs[0]);
    expect(result.fuzzyMatches[0].exchange).toEqual(exchangeRecs[0]);
    expect(result.userRemainder.length).toBe(0);
    expect(result.exchangeRemainder.length).toBe(0);
  });

  test('should select the candidate with the highest matching score', () => {
    const userRecs = [
      {
        timestamp: new Date('2024-03-01T09:00:00Z'),
        asset: 'BTC',
        type: 'BUY',
        quantity: new Decimal('0.5'),
      },
    ];
    const exchangeRecs = [
      {
        timestamp: new Date('2024-03-01T09:04:00Z'), // worse timestamp match (240s)
        asset: 'BTC',
        type: 'BUY',
        quantity: new Decimal('0.5'), // exact quantity
        createdAt: new Date('2024-03-01T09:04:00Z'),
      },
      {
        timestamp: new Date('2024-03-01T09:00:05Z'), // better timestamp match (5s)
        asset: 'BTC',
        type: 'BUY',
        quantity: new Decimal('0.5'), // exact quantity
        createdAt: new Date('2024-03-01T09:00:05Z'),
      },
    ];

    const result = fuzzyProximityMatch(userRecs, exchangeRecs, config);

    expect(result.fuzzyMatches.length).toBe(1);
    expect(result.fuzzyMatches[0].exchange).toEqual(exchangeRecs[1]); // should match EXC 1 (5s diff)
  });

  test('should not double-match exchange records', () => {
    const userRecs = [
      {
        timestamp: new Date('2024-03-01T09:00:00Z'),
        asset: 'BTC',
        type: 'BUY',
        quantity: new Decimal('0.5'),
      },
      {
        timestamp: new Date('2024-03-01T09:00:05Z'),
        asset: 'BTC',
        type: 'BUY',
        quantity: new Decimal('0.5'),
      },
    ];
    const exchangeRecs = [
      {
        timestamp: new Date('2024-03-01T09:00:02Z'),
        asset: 'BTC',
        type: 'BUY',
        quantity: new Decimal('0.5'),
        createdAt: new Date('2024-03-01T09:00:02Z'),
      },
    ];

    const result = fuzzyProximityMatch(userRecs, exchangeRecs, config);

    expect(result.fuzzyMatches.length).toBe(1);
    expect(result.userRemainder.length).toBe(1); // second user rec remains unmatched
    expect(result.exchangeRemainder.length).toBe(0);
  });
});
