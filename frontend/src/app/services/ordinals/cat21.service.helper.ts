import * as ecc from '@bitcoinerlab/secp256k1';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import ECPairFactory, { ECPairInterface, networks } from 'ecpair';
import { bytesToHex } from 'ordpool-parser';
import { Observable } from 'rxjs';
import { BitcoinNetworkType, signTransaction, SignTransactionResponse } from 'sats-connect';


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
 * Creates a random SECP256k1 keypair via the ECC library
 */
export function createRandomPrivateKey(isMainnet: boolean): ECPairInterface {
  const network = isMainnet ? networks.bitcoin : networks.testnet;
  const ecPair = ECPairFactory(ecc);
  return ecPair.makeRandom({ network });
}

/**
 * Returns a hardcoded keypair
 * This keypair should ne NEVER user for real transactions
 */
export function getHardcodedPrivateKey(isMainnet: boolean) {
  const network = isMainnet ? networks.bitcoin : networks.testnet;
  const mainnetDummyWIF = 'KwFAoPZk4c11vu8xyuBCpCrvHDATU4UofiTY9rARdkoXtZaDcb5k';
  const testnetDummyWIF = 'cVqWgJgeWP4Bbeso3UtEcocbJ2RcqayQ1RQ9nf2QtQx43kLyz7ac';

  const ecPair = ECPairFactory(ecc);
  return ecPair.fromWIF(isMainnet ? mainnetDummyWIF : testnetDummyWIF, network);
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

// see https://github.com/leather-wallet/extension/blob/8dbfefe8fcf5de687c2a137bce5eb2ff7a94b794/src/shared/rpc/methods/sign-psbt.ts#L49
export interface LeatherSignPsbtRequestParams {
  hex: string;
  allowedSighash?: any[];
  signAtIndex?: number | number[];
  network?: 'mainnet' | 'testnet' | 'signet' | 'sbtcDevenv' | 'devnet'; // default is user's current network
  account?: number; // default is user's current account
  broadcast?: boolean; // default is false - finalize/broadcast tx
}

export interface LeatherPSBTBroadcastResponse {
  jsonrpc: string;
  id: string;
  result: {
    hex: string;
  };
}

export async function signTransactionLeather(psbtBytes: Uint8Array, isMainnet: boolean): Promise<LeatherPSBTBroadcastResponse> {

  const network = isMainnet ? 'mainnet' : 'testnet';
  const psbtHex = bytesToHex(psbtBytes);

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
