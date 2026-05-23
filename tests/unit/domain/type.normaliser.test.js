import { normaliseType } from '../../../src/domain/normalisers/type.normaliser.js';
import { QUALITY_FLAGS } from '../../../src/infrastructure/constants.js';

describe('normaliseType', () => {
  const typeAliasMap = {
    buy: 'BUY',
    purchase: 'BUY',
    sell: 'SELL',
    withdrawal: 'SELL',
    deposit: 'BUY',
    credit: 'BUY',
    debit: 'SELL',
    transfer: 'TRANSFER',
    transfer_in: 'TRANSFER',
    transfer_out: 'TRANSFER',
    fee: 'FEE',
    reward: 'REWARD',
  };

  test('should resolve canonical type for exact match', () => {
    expect(normaliseType('BUY', typeAliasMap)).toEqual({ value: 'BUY', flag: null });
    expect(normaliseType('sell', typeAliasMap)).toEqual({ value: 'SELL', flag: null });
  });

  test('should resolve canonical type and collapse TRANSFER_IN / TRANSFER_OUT to TRANSFER', () => {
    expect(normaliseType('transfer_in', typeAliasMap)).toEqual({ value: 'TRANSFER', flag: null });
    expect(normaliseType('TRANSFER_OUT', typeAliasMap)).toEqual({ value: 'TRANSFER', flag: null });
  });

  test('should return UNKNOWN_TYPE flag when type cannot be resolved', () => {
    expect(normaliseType('SWAP', typeAliasMap)).toEqual({ value: null, flag: QUALITY_FLAGS.UNKNOWN_TYPE });
    expect(normaliseType(null, typeAliasMap)).toEqual({ value: null, flag: QUALITY_FLAGS.UNKNOWN_TYPE });
  });
});
