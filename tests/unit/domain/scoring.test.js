import { computeScore } from '../../../src/domain/matchers/scoring.js';

describe('computeScore - Match Confidence Scorer', () => {
  // Test parameters matching defaults:
  // TIMESTAMP_TOLERANCE_SECS = 300
  // QUANTITY_TOLERANCE_PCT = 0.01

  test('should return 100 for a perfect match (0 difference, exact type, hash match)', () => {
    const score = computeScore({
      deltaSeconds: 0,
      toleranceSecs: 300,
      deltaPct: 0,
      tolerancePct: 0.01,
      typeExact: true,
      hashMatch: true,
    });
    expect(score).toBe(100);
  });

  test('should return 80 for perfect numeric match without type/hash bonuses', () => {
    const score = computeScore({
      deltaSeconds: 0,
      toleranceSecs: 300,
      deltaPct: 0,
      tolerancePct: 0.01,
      typeExact: false,
      hashMatch: false,
    });
    expect(score).toBe(80);
  });

  test('should decay score linearly as deltas approach tolerance limits', () => {
    // Halfway for timestamp: 150s of 300s -> 20 points out of 40
    // Halfway for quantity: 0.005 of 0.01 -> 20 points out of 40
    // No type exact, no hash match
    const score = computeScore({
      deltaSeconds: 150,
      toleranceSecs: 300,
      deltaPct: 0.005,
      tolerancePct: 0.01,
      typeExact: false,
      hashMatch: false,
    });
    expect(score).toBe(40);
  });

  test('should return 0 if timestamp delta exceeds tolerance', () => {
    const score = computeScore({
      deltaSeconds: 301,
      toleranceSecs: 300,
      deltaPct: 0,
      tolerancePct: 0.01,
      typeExact: true,
      hashMatch: true,
    });
    expect(score).toBe(0);
  });

  test('should return 0 if quantity delta exceeds tolerance', () => {
    const score = computeScore({
      deltaSeconds: 0,
      toleranceSecs: 300,
      deltaPct: 0.0101,
      tolerancePct: 0.01,
      typeExact: true,
      hashMatch: true,
    });
    expect(score).toBe(0);
  });

  test('should correctly apply exact type bonus (+10)', () => {
    const score = computeScore({
      deltaSeconds: 0,
      toleranceSecs: 300,
      deltaPct: 0,
      tolerancePct: 0.01,
      typeExact: true,
      hashMatch: false,
    });
    expect(score).toBe(90);
  });

  test('should correctly apply hash match bonus (+10)', () => {
    const score = computeScore({
      deltaSeconds: 0,
      toleranceSecs: 300,
      deltaPct: 0,
      tolerancePct: 0.01,
      typeExact: false,
      hashMatch: true,
    });
    expect(score).toBe(90);
  });
});
