import { describe, expect, it } from '@jest/globals';
import { TransactionFlags, isFlagSet } from './filters.utils';


describe('TransactionFlags conversion tests', () => {
  // if the BigInt is to large, it can't be represented by a number anymore
  it('should convert all flags to Number and back to BigInt without error', () => {
    for (const flagName in TransactionFlags) {
      if (Object.prototype.hasOwnProperty.call(TransactionFlags, flagName)) {
        const flagValue = TransactionFlags[flagName];
        const flagNumber = Number(flagValue);
        const flagBigInt = BigInt(flagNumber);
        expect(flagBigInt).toBe(flagValue);
      }
    }
  });
});

describe('isFlagSet', () => {

  it('should return true if ordpool_inscription flag is set', () => {
    const exampleTransaction = { flags: Number(0b00000100_00000000_00000000_00000000_00000000_00000000_00000000n) };
    expect(isFlagSet(exampleTransaction, TransactionFlags.ordpool_inscription)).toBe(true);
  });

  it('should return false if ordpool_inscription flag is not set', () => {
    const exampleTransaction = { flags: Number(0b00000000_00000000_00000000_00000000_00000000_00000000_00000000n) };
    expect(isFlagSet(exampleTransaction, TransactionFlags.ordpool_inscription)).toBe(false);
  });

  it('should return true if multiple flags including ordpool_inscription are set', () => {
    const exampleTransaction = { flags:  Number(0b00000100_00000000_00000000_00000000_00000000_00000000_00000001n) };
    expect(isFlagSet(exampleTransaction, TransactionFlags.ordpool_inscription)).toBe(true);
    expect(isFlagSet(exampleTransaction, TransactionFlags.rbf)).toBe(true);
  });

  it('should return false if other flags are set but not ordpool_inscription', () => {
    const exampleTransaction = { flags:  Number(0b00000000_00000000_00000000_00000000_00000000_00000000_00000001n) };
    expect(isFlagSet(exampleTransaction, TransactionFlags.ordpool_inscription)).toBe(false);
    expect(isFlagSet(exampleTransaction, TransactionFlags.rbf)).toBe(true);
  });
});