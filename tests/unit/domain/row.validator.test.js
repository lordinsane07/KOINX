import { validateRow } from '../../../src/domain/validators/row.validator.js';
import { QUALITY_FLAGS } from '../../../src/infrastructure/constants.js';

describe('validateRow', () => {
  test('should pass for a fully populated row', () => {
    const row = {
      timestamp: '2024-03-01T09:00:32Z',
      asset: 'BTC',
      type: 'BUY',
      quantity: '0.5',
    };
    expect(validateRow(row)).toEqual({ isValid: true, qualityFlags: [] });
  });

  test('should return MISSING_FIELD flag for missing required fields', () => {
    const row = {
      timestamp: '2024-03-01T09:00:32Z',
      asset: '', // empty is treated as missing
      type: 'BUY',
      quantity: undefined, // missing
    };

    const result = validateRow(row);
    expect(result.isValid).toBe(false);
    expect(result.qualityFlags).toContain(QUALITY_FLAGS.MISSING_FIELD);
    expect(result.qualityFlags.length).toBe(2);
  });
});
