import { secp256k1 } from '@noble/curves/secp256k1';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { Observable } from 'rxjs';
import { BitcoinNetworkType, signTransaction, SignTransactionResponse } from 'sats-connect';

import { CreateTransactionResult, DummyKeypairResult, LeatherPSBTBroadcastResponse, LeatherSignPsbtRequestParams, SimulateTransactionResult, TxnOutput } from './cat21.service.types';
import { KnownOrdinalWalletType } from './wallet.service.types';

/**
 * Determines the minimum UTXO size based on the Bitcoin address type.
 * Supports both mainnet and testnet address prefixes.

 * This function aims to provide the minimum UTXO size to avoid creating dust outputs.
 * Since P2SH addresses (starting with '3' on mainnet and '2' on testnet)
 * can represent various types of scripts, including Nested SegWit,
 * a conservative approach is taken by assigning the higher minimum UTXO size applicable
 * to P2SH addresses. P2SH-P2WPKH would allow 540, but 6 sats are small enough to ignore them.
 *
 * Supported address types and their conservative minimum UTXO sizes are as follows:
 * - P2PKH / Pay-to-Public-Key-Hash (mainnet '1', testnet 'm' or 'n'): 546 satoshis
 * - P2SH / Pay-to-Script-Hash including Nested SegWit (P2SH-P2WPKH and P2SH-P2WSH) (mainnet '3', testnet '2'): 546 satoshis !
 * - P2WPKH / Native SegWit (mainnet 'bc1q', testnet 'tb1q'): 294 satoshis
 * - P2TR / Taproot (mainnet 'bc1p', testnet 'tb1p'): 330 satoshis
 *
 * Not supported:
 * - P2PK (Pay-to-Public-Key)
 *
 * References for further reading:
 * - https://help.magiceden.io/en/articles/8665399-navigating-bitcoin-dust-understanding-limits-and-safeguarding-your-transactions-on-magic-eden
 * - https://en.bitcoin.it/wiki/List_of_address_prefixes
 * - https://unchained.com/blog/bitcoin-address-types-compared/
 *
 * @param address - The Bitcoin address to evaluate.
 * @returns The conservative minimum number of satoshis that must be held by a UTXO of the given address type to avoid dust outputs.
 * @throws Throws an error if the address type is unsupported, indicating the need for further handling or a missing case.
 */
export function getMinimumUtxoSize(address: string): number {

  // Mainnet addresses
  if (address.startsWith('1')) return 546; // P2PKH
  if (address.startsWith('3')) return 546; // P2SH (including Nested SegWit, conservatively treated)
  if (address.startsWith('bc1q')) return 294; // P2WPKH
  if (address.startsWith('bc1p')) return 330; // P2TR

  // Testnet addresses
  if (address.startsWith('m') || address.startsWith('n')) return 546; // P2PKH testnet
  if (address.startsWith('2')) return 546; // P2SH (including Nested SegWit, conservatively treated) testnet
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
 * Creates the funding input for the supported wallets
 */
export function createInput(walletType: KnownOrdinalWalletType,
  paymentOutput: TxnOutput,
  paymentPublicKey: Uint8Array, network: typeof btc.NETWORK) {

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

  const input = {
    txid: paymentOutput.txid,
    index: paymentOutput.vout,
    witnessUtxo: {
      script: script,
      amount: BigInt(paymentOutput.value),
    },
    redeemScript: redeemScript,
    sighashType: btc.SigHash.SINGLE_ANYONECANPAY // 131
  };

  return input;
}


/**
 * Constructs a CAT-21 mint transaction.
 *
 * This function creates a transaction with the necessary inputs and outputs based on the provided parameters.
 * If the calculated change amount is below the Bitcoin network's dust limit, the change is not returned to the sender
 * but instead added to the transaction fee. If the change amount is above the dust limit, two outputs are created:
 * one for the recipient and one for the change.
 *
 * @param walletType - The type of wallet used for the transaction.
 * @param recipientAddress - The address of the recipient.
 * @param paymentOutput - The UTXO to be used for the transaction.
 * @param paymentPublicKeyHex - The public key of the sender, in hexadecimal.
 * @param paymentAddress - The sender's address, to which change will be returned.
 * @param transactionFee - The miner fee in satoshis.
 * @param isMainnet - Flag indicating whether the transaction is for mainnet or testnet
 * @returns The constructed transaction.
 */
export function createTransaction(
  walletType: KnownOrdinalWalletType,
  recipientAddress: string,

  paymentOutput: TxnOutput,
  paymentPublicKeyHex: string,
  paymentAddress: string,
  transactionFee: bigint,
  isMainnet: boolean
): CreateTransactionResult {

  const network: typeof btc.NETWORK = isMainnet ? btc.NETWORK : btc.TEST_NETWORK;
  const paymentPublicKey: Uint8Array = hex.decode(paymentPublicKeyHex);


  const lockTime = 21; // THIS is the most important part 😺
  const tx = new btc.Transaction({ lockTime });

  const input = createInput(walletType, paymentOutput, paymentPublicKey, network);
  tx.addInput(input);

  // 546 is the best amount, it makes later transfers between different
  // address formats easier (no padding will be required)
  const amountToRecipient = BigInt(546);

  // Calculate change
  const singleInputAmount = BigInt(paymentOutput.value);
  let changeAmount = singleInputAmount - amountToRecipient - transactionFee;

  const dustLimit = BigInt(getMinimumUtxoSize(paymentAddress));

  // this UTXO is definitely too small
  if (changeAmount < 0) {
    throw new Error('Insufficient funds for transaction');
  }

  // Check if changeAmount is above the dust limit
  if (changeAmount >= dustLimit) {
    // Add recipient and change outputs
    tx.addOutputAddress(recipientAddress, amountToRecipient, network);
    tx.addOutputAddress(paymentAddress, changeAmount, network);

  } else {
    // Absorb change into the transactionFee if below dust limit and only add recipient output
    transactionFee = transactionFee + changeAmount;
    changeAmount = BigInt(0);
    tx.addOutputAddress(recipientAddress, singleInputAmount - transactionFee);
  }

  // all remaining sats that the miner will get
  const minerAmount = singleInputAmount - changeAmount - amountToRecipient;
  if (transactionFee !== minerAmount) {
    throw new Error('My logic is broken?!'); // we should never see this error!
  }

  return {
    tx,
    amountToRecipient, // always 546
    singleInputAmount,
    changeAmount,
    finalTransactionFee: transactionFee
  };
}


let getDummyKeypairResult: DummyKeypairResult | undefined = undefined;

/**
 * Generates a dummy keypair for simulation or testing purposes.
 *
 * This function creates a deterministic dummy keypair based on a fixed private key.
 * It is intended for use in scenarios where a predictable output is necessary,
 * such as testing transaction signing or simulation processes. The generated public
 * key is derived from the hardcoded private key using the SECP256k1 elliptic curve.
 *
 * Note: This function should never be used with real transactions,
 * as the private key is publicly known and provides no security!!
 *
 * The results is cached.
 */
export function getDummyKeypair(): DummyKeypairResult {

  if (!getDummyKeypairResult) {

    const dummyPrivateKey: Uint8Array = hex.decode('0101010101010101010101010101010101010101010101010101010101010101');
    const dummyPublicKey: Uint8Array = secp256k1.getPublicKey(dummyPrivateKey, true);
    const dummyPublicKeyHex: string = hex.encode(dummyPublicKey);

    const addressP2PKH = btc.getAddress('pkh', dummyPrivateKey);   // 1C6Rc3w25VHud3dLDamutaqfKWqhrLRTaD // P2PKH (legacy address)
    const addressP2WPKH = btc.getAddress('wpkh', dummyPrivateKey); // bc1q0xcqpzrky6eff2g52qdye53xkk9jxkvrh6yhyw // SegWit V0 address
    const addressP2TR = btc.getAddress('tr', dummyPrivateKey);     // bc1p33wm0auhr9kkahzd6l0kqj85af4cswn276hsxg6zpz85xe2r0y8syx4e5t // TapRoot KeyPathSpend

    getDummyKeypairResult = {
      dummyPrivateKey,
      dummyPublicKey,
      dummyPublicKeyHex,
      addressP2PKH,
      addressP2WPKH,
      addressP2TR
    };
  }

  return getDummyKeypairResult;
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
