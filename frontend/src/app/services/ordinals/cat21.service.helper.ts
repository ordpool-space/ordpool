import { secp256k1 } from '@noble/curves/secp256k1';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { Observable } from 'rxjs';
import { BitcoinNetworkType, signTransaction, SignTransactionResponse } from 'sats-connect';

import { LeatherPSBTBroadcastResponse, LeatherSignPsbtRequestParams, TxnOutput } from './cat21.service.types';
import { KnownOrdinalWalletType } from './wallet.service.types';

/**
 * Determines the minimum UTXO size based on the Bitcoin address type.
 * Supports both mainnet and testnet address prefixes.

 * Supported address types and their minimum UTXO sizes are as follows:
 * - P2PKH (mainnet '1', testnet 'm' or 'n'): 546 satoshis
 * - P2SH-P2WPKH (mainnet '3', testnet '2'): 540 satoshis
 * - P2WPKH (mainnet 'bc1q', testnet 'tb1q'): 294 satoshis
 * - P2TR (mainnet 'bc1p', testnet 'tb1p'): 330 satoshis
 *
 * see: https://help.magiceden.io/en/articles/8665399-navigating-bitcoin-dust-understanding-limits-and-safeguarding-your-transactions-on-magic-eden
 * see: https://en.bitcoin.it/wiki/List_of_address_prefixes
 *
 * @param address - The Bitcoin address to evaluate.
 * @returns The minimum number of satoshis that must be held by a UTXO of the given address type.
 * @throws Throws an error if the address type is unsupported.
 */
export function getMinimumUtxoSize(address: string): number {
  // Mainnet addresses
  if (address.startsWith('1')) return 546; // P2PKH
  if (address.startsWith('3')) return 540; // P2SH-P2WPKH
  if (address.startsWith('bc1q')) return 294; // P2WPKH
  if (address.startsWith('bc1p')) return 330; // P2TR

  // Testnet addresses
  if (address.startsWith('m') || address.startsWith('n')) return 546; // P2PKH testnet
  if (address.startsWith('2')) return 540; // P2SH-P2WPKH testnet
  if (address.startsWith('tb1q')) return 294; // P2WPKH testnet
  if (address.startsWith('tb1p')) return 330; // P2TR testnet

  throw new Error('Unsupported address type');
}

/**
 * Creates an input script for the Xverse wallet
 * (the payment address for Xverse is always a P2SH-P2WPKH)
 */
export function createInputScriptForXverse(paymentPublicKey: Uint8Array, network: typeof btc.NETWORK) {
  const p2wpkh = btc.p2wpkh(paymentPublicKey, network);
  const p2sh = btc.p2sh(p2wpkh, network);
  return {
    script: p2sh.script,
    redeemScript: p2sh.redeemScript,
  };
}

/**
 * Creates an input script for the Leather wallet
 * (the payment address for Leather is always a P2SH-P2WPKH)
 */
export function createInputScriptForLeather(paymentPublicKey: Uint8Array, network: typeof btc.NETWORK) {
  const p2wpkh = btc.p2wpkh(paymentPublicKey, network);
  return {
    script: p2wpkh.script,
    redeemScript: undefined,
  };
}

/**
 * Constructs a CAT-21 mint transaction
 */
export function createTransaction(
  walletType: KnownOrdinalWalletType,
  recipientAddress: string,

  paymentOutput: TxnOutput,
  paymentPublicKeyHex: string,
  paymentAddress: string,
  minerFeeInSats: number,
  isMainnet: boolean
): btc.Transaction {

  const network: typeof btc.NETWORK = isMainnet ? btc.NETWORK : btc.TEST_NETWORK;
  const paymentPublicKey: Uint8Array = hex.decode(paymentPublicKeyHex);

  let scriptInfo: {
    script: Uint8Array;
    redeemScript: Uint8Array | undefined
  };

  switch (walletType) {
    case KnownOrdinalWalletType.leather:
      scriptInfo = createInputScriptForLeather(paymentPublicKey, network);
      break;

    case KnownOrdinalWalletType.xverse:
      scriptInfo = createInputScriptForXverse(paymentPublicKey, network);
      break;

    case KnownOrdinalWalletType.unisat:
      throw new Error('The Unisat wallet is right now not supported!');

    default:
      // this case should never happen, but otherwise the code is not type-safe
      throw new Error('Unknown wallet');
  }

  const { script, redeemScript } = scriptInfo;

  const lockTime = 21; // THIS is the most important part 😺
  const tx = new btc.Transaction({
    allowUnknownOutputs: true, // Allow output scripts to be unknown scripts (probably unspendable) -- TODO: check if really required!
    lockTime
  });

  tx.addInput({
    txid: paymentOutput.txid,
    index: paymentOutput.vout,
    witnessUtxo: {
      script: script,
      amount: BigInt(paymentOutput.value),
    },
    redeemScript: redeemScript,
    sighashType: btc.SigHash.SINGLE_ANYONECANPAY // 131
  });

  // Smallest possible amount
  const amountToRecipient = BigInt(getMinimumUtxoSize(paymentAddress));

  // Calculate change
  const totalAmount = BigInt(paymentOutput.value);
  const changeAmount = totalAmount - amountToRecipient - BigInt(minerFeeInSats);

  if (changeAmount < 0) {
    throw new Error('Insufficient funds for transaction');
  }

  // Add outputs
  tx.addOutputAddress(recipientAddress, amountToRecipient, network);
  tx.addOutputAddress(paymentAddress, changeAmount, network);

  return tx;
}

/**
 * Constructs a fake CAT-21 mint transaction,
 * finalizes the txn and receives the vsize
 */
export function simulateTransaction(
  walletType: KnownOrdinalWalletType,
  recipientAddress: string,

  paymentOutput: TxnOutput,
  paymentAddress: string,
  isMainnet: boolean
): number {

  const dummyPrivKey: Uint8Array = hex.decode('0101010101010101010101010101010101010101010101010101010101010101');
  const dummyPubKey: Uint8Array = secp256k1.getPublicKey(dummyPrivKey, true);
  const dummyPubKeyHex: string = hex.encode(dummyPubKey);

  const minerFee = 10000; // this is a realistic number

  const tx = createTransaction(
    walletType,
    recipientAddress,
    paymentOutput,
    dummyPubKeyHex, // !
    paymentAddress,
    minerFee,
    isMainnet);

  tx.signIdx(dummyPrivKey, 0, [btc.SigHash.SINGLE_ANYONECANPAY]);
  tx.finalize();
  const vsize = tx.vsize; // 🎉

  return vsize;
}

export async function signTransactionLeather(psbtBytes: Uint8Array, isMainnet: boolean): Promise<LeatherPSBTBroadcastResponse> {

  const network = isMainnet ? 'mainnet' : 'testnet';
  const psbtHex: string = hex.encode(psbtBytes);

  const signRequestParams: LeatherSignPsbtRequestParams = {
    hex: psbtHex,
    allowedSighash: [btc.SigHash.SINGLE_ANYONECANPAY],
    signAtIndex: 0,
    network,
    broadcast: false // we will broadcast it via the Mempool API
  };

  // Sign the PSBT (and broadcast)
  const result: LeatherPSBTBroadcastResponse = await (window as any).btc.request('signPsbt', signRequestParams);
  return result;
}

export function signTransactionAndBroadcastXverse(psbtBytes: Uint8Array, paymentAddress: string, isMainnet: boolean): Observable<{ txId: string }> {

  const networkType = isMainnet ? BitcoinNetworkType.Mainnet : BitcoinNetworkType.Testnet;
  const psbtBase64 = base64.encode(psbtBytes);

  return new Observable<{ txId: string }>((observer) => {

    signTransaction({
      payload: {
        network: {
          type: networkType
        },
        message: 'Sign Transaction (CAT-21 Mint)',
        psbtBase64,
        broadcast: true,
        inputsToSign: [
          {
            address: paymentAddress,
            signingIndexes: [0],
            sigHash: btc.SigHash.SINGLE_ANYONECANPAY // 131
          },
        ],
      },
      onFinish: (response: SignTransactionResponse) => {

        const txId = response.txId || '';

        observer.next({ txId });
        observer.complete();
      },
      onCancel: () => {
        observer.error(new Error('Request was cancelled'));
      }
    });
  });
}
