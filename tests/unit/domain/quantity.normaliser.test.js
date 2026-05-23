import Decimal from 'decimal.js';
import { normaliseQuantity } from '../../../src/domain/normalisers/quantity.normaliser.js';
import { QUALITY_FLAGS } from '../../../src/infrastructure/constants.js';

describe('normaliseQuantity', () => {
  test('should parse valid quantities into Decimal instances', () => {
    const result = normaliseQuantity('0.5');
    expect(result.flag).toBeNull();
    expect(result.value).toBeInstanceOf(Decimal);
    expect(result.value.toString()).toBe('0.5');

    const result2 = normaliseQuantity(123.456);
    expect(result2.flag).toBeNull();
    expect(result2.value.toString()).toBe('123.456');
  });

  test('should reject zero or negative quantities', () => {
    expect(normaliseQuantity('0')).toEqual({ value: null, flag: QUALITY_FLAGS.INVALID_QUANTITY });
    expect(normaliseQuantity('-0.5')).toEqual({ value: null, flag: QUALITY_FLAGS.INVALID_QUANTITY });
  });

  test('should reject invalid, unparseable quantities and non-finite values', () => {
    expect(normaliseQuantity('')).toEqual({ value: null, flag: QUALITY_FLAGS.INVALID_QUANTITY });
    expect(normaliseQuantity('not-a-number')).toEqual({ value: null, flag: QUALITY_FLAGS.INVALID_QUANTITY });
    expect(normaliseQuantity(Infinity)).toEqual({ value: null, flag: QUALITY_FLAGS.INVALID_QUANTITY });
  });

  test('should reject quantities exceeding the sanity cap (1e15)', () => {
    expect(normaliseQuantity('1000000000000001')).toEqual({ value: null, flag: QUALITY_FLAGS.QUANTITY_OVERFLOW });
  });
});
