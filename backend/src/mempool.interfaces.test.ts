import { TransactionFlags } from './mempool.interfaces';

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
