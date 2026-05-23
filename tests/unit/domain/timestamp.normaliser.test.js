import { normaliseTimestamp } from '../../../src/domain/normalisers/timestamp.normaliser.js';
import { QUALITY_FLAGS } from '../../../src/infrastructure/constants.js';

describe('normaliseTimestamp', () => {
  const referenceNow = 1709283600000; // 2024-03-01T09:00:00Z in ms

  test('should parse ISO 8601 strings', () => {
    const result = normaliseTimestamp('2024-03-01T09:00:00Z', referenceNow);
    expect(result.flag).toBeNull();
    expect(result.value.getTime()).toBe(referenceNow);
  });

  test('should parse Unix numeric timestamps (seconds and milliseconds)', () => {
    // Unix seconds: 1709283600
    const secResult = normaliseTimestamp(1709283600, referenceNow);
    expect(secResult.flag).toBeNull();
    expect(secResult.value.getTime()).toBe(referenceNow);

    // Unix milliseconds: 1709283600000
    const msResult = normaliseTimestamp(1709283600000, referenceNow);
    expect(msResult.flag).toBeNull();
    expect(msResult.value.getTime()).toBe(referenceNow);
  });

  test('should parse regional formats: dd/MM/yyyy HH:mm:ss and MM-dd-yyyy', () => {
    const result1 = normaliseTimestamp('01/03/2024 09:00:00', referenceNow);
    expect(result1.flag).toBeNull();
    expect(result1.value.getHours()).toBe(9);

    const result2 = normaliseTimestamp('03-01-2024', referenceNow);
    expect(result2.flag).toBeNull();
    expect(result2.value.getFullYear()).toBe(2024);
  });

  test('should reject invalid and unparseable dates', () => {
    expect(normaliseTimestamp('', referenceNow)).toEqual({ value: null, flag: QUALITY_FLAGS.INVALID_TIMESTAMP });
    expect(normaliseTimestamp('not-a-date', referenceNow)).toEqual({ value: null, flag: QUALITY_FLAGS.INVALID_TIMESTAMP });
    expect(normaliseTimestamp(null, referenceNow)).toEqual({ value: null, flag: QUALITY_FLAGS.INVALID_TIMESTAMP });
  });

  test('should reject future timestamps beyond buffer limit', () => {
    // 2 hours in future is beyond buffer (1 hour)
    const futureTime = referenceNow + 7200 * 1000;
    const result = normaliseTimestamp(futureTime, referenceNow);
    expect(result.value).toBeNull();
    expect(result.flag).toBe(QUALITY_FLAGS.FUTURE_TIMESTAMP);
  });
});
