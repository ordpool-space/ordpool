import { describe, expect, it } from '@jest/globals';

import { createInputScriptForUnisat, createTransaction, getAddressFormat, getDummyKeypair, getMinimumUtxoSize, getDummyLegacyTransaction, toXOnly } from './cat21.service.helper';
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

describe('toXOnly', () => {
  it('should remove the first byte of the public key', () => {

    const pubkey = new Uint8Array([
      0x02, // First byte indicating the parity
      0x86, 0xdd, 0xd2, 0x1d, 0x86, 0xed, 0x3f, 0x55, 0x1f, 0xbf, 0x47, 0x09, 0x17, 0xaf, 0xbd, 0x17,
      0x27, 0x1e, 0xeb, 0x21, 0x76, 0xf9, 0x0b, 0xfc, 0x0b, 0x48, 0x68, 0x85, 0x51, 0x5f, 0xef, 0x7f,
    ]);

    const result = toXOnly(pubkey);

    const expected = new Uint8Array([
      0x86, 0xdd, 0xd2, 0x1d, 0x86, 0xed, 0x3f, 0x55, 0x1f, 0xbf, 0x47, 0x09, 0x17, 0xaf, 0xbd, 0x17,
      0x27, 0x1e, 0xeb, 0x21, 0x76, 0xf9, 0x0b, 0xfc, 0x0b, 0x48, 0x68, 0x85, 0x51, 0x5f, 0xef, 0x7f,
    ]);

    expect(result).toEqual(expected);
  });
});

describe('getDummyKeypair', () => {

  it('should always return the same private and public key', () => {
    const result = getDummyKeypair(btc.NETWORK);

    const dummyPrivateKeyHex = hex.encode(result.dummyPrivateKey);
    const dummyPublicKeyHex = hex.encode(result.dummyPublicKey);
    const xOnlyDummyPublicKeyHex = hex.encode(result.xOnlyDummyPublicKey);

    expect(dummyPrivateKeyHex).toEqual('0101010101010101010101010101010101010101010101010101010101010101');
    expect(dummyPublicKeyHex).toEqual('031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f');

    const expectedDummyPublicKeyHex = hex.encode(toXOnly(result.dummyPublicKey));
    expect(xOnlyDummyPublicKeyHex).toEqual(expectedDummyPublicKeyHex);
  });

  it('should always return the same addresses for mainnet', () => {
    const result = getDummyKeypair(btc.NETWORK);

    expect(result.addressP2PKH).toEqual('1C6Rc3w25VHud3dLDamutaqfKWqhrLRTaD');
    expect(result.addressP2SH_P2WPKH).toEqual('35LM1A29K95ADiQ8rJ9uEfVZCKffZE4D9i');
    expect(result.addressP2WPKH).toEqual('bc1q0xcqpzrky6eff2g52qdye53xkk9jxkvrh6yhyw');
    expect(result.addressP2TR).toEqual('bc1p33wm0auhr9kkahzd6l0kqj85af4cswn276hsxg6zpz85xe2r0y8syx4e5t');
  });

  it('should always return the same addresses for testnet', () => {
    const result = getDummyKeypair(btc.TEST_NETWORK);

    expect(result.addressP2PKH).toEqual('mrcNu71ztWjAQA6ww9kHiW3zBWSQidHXTQ');
    expect(result.addressP2SH_P2WPKH).toEqual('2MvtZ4txAvbaWRW2gXRmmrcUpQfsqNgpfUm');
    expect(result.addressP2WPKH).toEqual('tb1q0xcqpzrky6eff2g52qdye53xkk9jxkvraulyla');
    expect(result.addressP2TR).toEqual('tb1p33wm0auhr9kkahzd6l0kqj85af4cswn276hsxg6zpz85xe2r0y8snwrkwy');
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

describe('createInputScriptForUnisat', () => {
  const { dummyPublicKey, xOnlyDummyPublicKey } = getDummyKeypair(btc.NETWORK);

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
    const result = createInputScriptForUnisat('bc1p...', xOnlyDummyPublicKey, btc.NETWORK);
    expect(result).toHaveProperty('script');
    expect(result.redeemScript).toBeUndefined();
  });

});

describe('proof that we can create+sign a taproot input + output with dummy data', () => {

  // will first throw an exception (Invalid checksum!), but the second try should pass
  it('should execute flawlessly', () => {

    const { dummyPrivateKey, xOnlyDummyPublicKey } = getDummyKeypair(btc.TEST_NETWORK);
    const tx = new btc.Transaction();
    const scriptP2tr: btc.P2TROut = btc.p2tr(xOnlyDummyPublicKey, undefined, btc.TEST_NETWORK, true);

    // Add the Taproot input
    tx.addInput({
      txid: '0000000000000000000000000000000000000000000000000000000000000000',
      index: 0,
      witnessUtxo: {
        script: scriptP2tr.script,
        amount: BigInt(1000),
      },
      ...scriptP2tr // P2TROut has some extra properties that we all just merge into the intput
    });
    tx.addOutputAddress('tb1pz8ylmfpyl78mmqrvjnlwewec2apmvd3hydtnwxykr497qv89etrqksf3qc', BigInt(1000), btc.TEST_NETWORK);

    // Sign the input with the dummy private key
    tx.signIdx(dummyPrivateKey, 0);
    tx.finalize();
  });
});

// prices: 1BTC == 42855 USD
describe('createTransaction for Xverse', () => {
  const paymentUtxo = {
    txid: hex.encode(sha256('text-txid')),
    vout: 0,
    value: 10000, // 10000 sats ($4.28)
    status: {} as any,
  };

  const { dummyPublicKey, addressP2SH_P2WPKH, addressP2TR } = getDummyKeypair(btc.NETWORK);

  it('creates only one output if change would be below dust limit, miner gets some more fees', () => {

    const { tx } = createTransaction(
      KnownOrdinalWalletType.xverse,
      addressP2TR,
      paymentUtxo,
      hex.encode(dummyPublicKey),
      addressP2SH_P2WPKH,
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
      hex.encode(dummyPublicKey),
      addressP2SH_P2WPKH,
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
      hex.encode(dummyPublicKey),
      addressP2SH_P2WPKH,
      BigInt(9000 + 1000), // now we are out of money, change would be negative
      false,
      true
    )).toThrowError(new Error('Insufficient funds for transaction'));
  });
});
