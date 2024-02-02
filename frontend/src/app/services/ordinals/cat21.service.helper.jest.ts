import { describe, expect, it } from '@jest/globals';
import { getMinimumUtxoSize } from './cat21.service.helper';

describe('getMinimumUtxoSize', () => {

  it('correctly determines the minimum UTXO size for mainnet P2PKH addresses', () => {
    expect(getMinimumUtxoSize('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(546);
  });

  it('correctly determines the minimum UTXO size for testnet P2PKH addresses', () => {
    expect(getMinimumUtxoSize('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(546);
  });

  it('correctly determines the minimum UTXO size for mainnet P2WPKH addresses', () => {
    expect(getMinimumUtxoSize('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(294);
  });

  it('correctly determines the minimum UTXO size for testnet P2WPKH addresses', () => {
    expect(getMinimumUtxoSize('tb1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(294);
  });

  it('throws an error for unsupported address types', () => {
    expect(() => getMinimumUtxoSize('0xInvalidAddress')).toThrow('Unsupported address type');
  });
});
