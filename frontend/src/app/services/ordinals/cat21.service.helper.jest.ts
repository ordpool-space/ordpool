import { describe, expect, it } from '@jest/globals';

import { createInputScriptForUnisat, createTransaction, getAddressFormat, getDummyKeypair, getMinimumUtxoSize, getDummyLegacyTransaction } from './cat21.service.helper';
import { KnownOrdinalWalletType } from './wallet.service.types';
import { sha256 } from '@noble/hashes/sha256';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { TxnOutput } from './cat21.service.types';



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

describe('getAddressFormat', () => {
  it('identifies P2WPKH format correctly', () => {
    expect(getAddressFormat('bc1q...')).toEqual('P2WPKH');
    expect(getAddressFormat('tb1q...')).toEqual('P2WPKH');
  });

  it('identifies uncertain P2SH format correctly', () => {
    expect(getAddressFormat('3...')).toEqual('P2SH???');
    expect(getAddressFormat('2...')).toEqual('P2SH???');
  });

  it('identifies P2TR format correctly', () => {
    expect(getAddressFormat('bc1p...')).toEqual('P2TR');
    expect(getAddressFormat('tb1p...')).toEqual('P2TR');
  });

  it('identifies P2PKH format correctly', () => {
    expect(getAddressFormat('1...')).toEqual('P2PKH');
    expect(getAddressFormat('m...')).toEqual('P2PKH');
    expect(getAddressFormat('n...')).toEqual('P2PKH');
  });

  it('throws error for unsupported address formats', () => {
    expect(() => getAddressFormat('x...')).toThrow('Unsupported address format.');
  });
});

describe('createInputScriptForUnisat', () => {
  const { dummyPublicKey, schnorrPublicKey } = getDummyKeypair(btc.NETWORK);

  // "Legacy" Pay-to-Public-Key-Hash
  it('creates script for P2PKH addresses', () => {
    const result = createInputScriptForUnisat('1...', dummyPublicKey, btc.NETWORK);
    expect(result).toHaveProperty('script');
    expect(result.redeemScript).toBeUndefined();
  });

  // Nested Segwit
  it('creates script for P2SH addresses', () => {
    const result = createInputScriptForUnisat('3...', dummyPublicKey, btc.NETWORK);
    expect(result).toHaveProperty('script');
    expect(result).toHaveProperty('redeemScript');
  });

  // Native Seqwit
  it('creates script for P2WPKH addresses', () => {
    const result = createInputScriptForUnisat('bc1q...', dummyPublicKey, btc.NETWORK);
    expect(result).toHaveProperty('script');
    expect(result.redeemScript).toBeUndefined();
  });

  // Taproot
  it('creates script for P2TR addresses', () => {
    const result = createInputScriptForUnisat('bc1p...', schnorrPublicKey, btc.NETWORK);
    expect(result).toHaveProperty('script');
    expect(result.redeemScript).toBeUndefined();
  });

});

describe('getDummyLegacyTransaction', () => {
  it('creates a dummy transaction with the specified number of outputs for mainnet', () => {

    const txnOutput: TxnOutput = {
      txid: '', // not used
      vout: 2, // Expecting 3 outputs, including the one specified and two placeholders
      status: {} as any, // not used
      value: 1000
    };

    const transaction = getDummyLegacyTransaction(txnOutput, btc.NETWORK);
    expect(transaction.outputsLength).toBe(3);
    expect(transaction.hex).toBeTruthy();
  });

  it('creates a dummy transaction with the specified number of outputs for testnet', () => {

    const txnOutput: TxnOutput = {
      txid: '', // not used
      vout: 2, // Expecting 3 outputs, including the one specified and two placeholders
      status: {} as any, // not used
      value: 1000
    };

    const transaction = getDummyLegacyTransaction(txnOutput, btc.TEST_NETWORK);
    expect(transaction.outputsLength).toBe(3);
    expect(transaction.hex).toBeTruthy();
  });
});


// prices: 1BTC == 42855 USD
describe('createTransaction', () => {
  const paymentUtxo = {
    txid: hex.encode(sha256('text-txid')),
    vout: 0,
    value: 10000, // 10000 sats ($4.28)
    status: { } as any,
  };

  const { dummyPublicKeyHex, addressP2PKH, addressP2TR } = getDummyKeypair(btc.NETWORK);

  it('creates only one output if change would be below dust limit, miner gets some more fees', () => {

    const { tx } = createTransaction(
      KnownOrdinalWalletType.xverse,
      addressP2TR,
      paymentUtxo,
      dummyPublicKeyHex,
      addressP2PKH,
      BigInt(9000), // High fee to ensure change of 454 sats ($0.19) is below dust limit of 546 sats ($0.23)
      false,
      true
    );

    if (!tx) {
      throw Error('Transaction expected');
    }

    expect(tx.outputsLength).toBe(1);
    expect(tx.getOutput(0).amount).toBe(BigInt(546));
  });

  it('creates two outputs if change is above dust limit', () => {

    const { tx } = createTransaction(
      KnownOrdinalWalletType.xverse,
      addressP2TR,
      paymentUtxo,
      dummyPublicKeyHex,
      addressP2PKH,
      BigInt(5000), // Lower fee to ensure change of 4.454 sats ($1.91) is above dust limit of 546 sats ($0.23)
      false,
      true
    );

    if (!tx) {
      throw Error('Transaction expected');
    }

    expect(tx.outputsLength).toBe(2);
    expect(tx.getOutput(0).amount).toBe(BigInt(546));
    expect(tx.getOutput(1).amount).toBe(BigInt(4454));
  });

  it('fails with an exeption if funds are too low', () => {

    expect(() => createTransaction(
      KnownOrdinalWalletType.xverse,
      addressP2TR,
      paymentUtxo,
      dummyPublicKeyHex,
      addressP2PKH,
      BigInt(9000 + 1000), // now we are out of money, change would be negative
      false,
      true
    )).toThrowError(new Error('Insufficient funds for transaction'));
  });
});
