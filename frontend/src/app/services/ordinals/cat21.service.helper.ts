import { secp256k1, schnorr } from '@noble/curves/secp256k1';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { Observable } from 'rxjs';
import { BitcoinNetworkType, signTransaction, SignTransactionResponse } from 'sats-connect';

import {
  CreateTransactionResult,
  DummyKeypairResult,
  LeatherPSBTBroadcastResponse,
  LeatherSignPsbtRequestParams,
  TxnOutput,
} from './cat21.service.types';
import { KnownOrdinalWalletType } from './wallet.service.types';

/**
 * Determines the minimum UTXO size based on the Bitcoin address type.
 * Supports both mainnet and testnet address prefixes.

 * This function aims to provide the minimum UTXO size to avoid creating dust outputs.
 * Since P2SH* addresses (starting with '3' on mainnet and '2' on testnet)
 * can represent various types of scripts, including Nested SegWit,
 * a conservative approach is taken by assigning the higher minimum UTXO size applicable
 * to P2SH addresses. P2SH-P2WPKH would allow 540, but 6 sats are small enough to ignore them.
 *
 * Supported address types and their conservative minimum UTXO sizes are as follows:
 * - P2PKH / "Legacy" Pay-to-Public-Key-Hash (mainnet '1', testnet 'm' or 'n'): 546 satoshis
 * - P2SH / Pay-to-Script-Hash including
 *   ... P2SH-P2WPKH / "Nested SegWit" and
 *   ... P2SH-P2WSH / "Pay To Witness Script Hash Wrapped In P2SH" (mainnet '3', testnet '2'): 546 satoshis !
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
 * @throws Throws an error if the address type is unsupported.
 */
export function getMinimumUtxoSize(address: string): number {

  // Mainnet addresses
  if (address.startsWith('1')) return 546; // P2PKH
  if (address.startsWith('3')) return 546; // P2SH??? (including Nested SegWit, conservatively treated)
  if (address.startsWith('bc1q')) return 294; // P2WPKH
  if (address.startsWith('bc1p')) return 330; // P2TR

  // Testnet addresses
  if (address.startsWith('m') || address.startsWith('n')) return 546; // P2PKH testnet
  if (address.startsWith('2')) return 546; // P2SH??? (including Nested SegWit, conservatively treated) testnet
  if (address.startsWith('tb1q')) return 294; // P2WPKH testnet
  if (address.startsWith('tb1p')) return 330; // P2TR testnet

  throw new Error('Unsupported address type');
}

/**
 * Determines the Bitcoin address format based on its prefix.
 *
 * Due to the identical prefixes of P2SH addresses, this function cannot
 * distinguish between different types of P2SH formats (e.g., P2SH-P2WPKH, P2SH-P2WSH)
 * solely based on the address itself. It returns 'P2SH???' to indicate this uncertainty.
 * Additional context or user input is required to accurately identify
 * the specific P2SH format for transaction script creation.
 *
 * Supported address formats are:
 * - P2PKH: Legacy addresses starting with '1' (mainnet) or 'm'/'n' (testnet)
 * - P2SH???: P2SH addresses starting with '3' (mainnet) or '2' (testnet), where
 *            the specific P2SH format is unclear without further context
 * - P2WPKH: Native SegWit addresses starting with 'bc1q' (mainnet) or 'tb1q' (testnet).
 * - P2TR: Taproot addresses starting with 'bc1p' (mainnet) or 'tb1p' (testnet).
 *
 * Not supported:
 * - P2PK (Pay-to-Public-Key)
 *
 * Usage of this function should be accompanied by mechanisms to obtain
 * additional information on the intended script type for P2SH addresses!!
 *
 * @param address - The Bitcoin address to evaluate.
 * @returns The identified address format, or 'P2SH???' when the specific P2SH format cannot be determined.
 * @throws Throws an error if the address format is unsupported.
 */
export function getAddressFormat(address: string): 'P2WPKH' | 'P2SH???' | 'P2TR' | 'P2PKH' {

  // "Legacy" Pay-to-Public-Key-Hash
  if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
    return 'P2PKH';
  }

  // Uncertain P2SH format, maybe Nested Segwit
  if (address.startsWith('3') || address.startsWith('2')) {
    return 'P2SH???';
  }

  // Native Seqwit
  if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
    return 'P2WPKH';
  }

  // Taproot
  if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
    return 'P2TR';
  }

  throw new Error('Unsupported address format.');
}

/**
 * Creates an input script for the Xverse wallet
 * The payment address for Xverse is always a P2SH-P2WPKH / Nested SegWit (3...).
 *
 * see https://docs.xverse.app/sats-connect/methods/signmessage
 * > "ECDSA signatures over the secp256k1 curve when signing with the BTC payment (p2sh(p2wpkh)) address"
 */
export function createInputScriptForXverse(paymentPublicKey: Uint8Array, network: typeof btc.NETWORK) {
  const p2wpkhForP2sh = btc.p2wpkh(paymentPublicKey, network);
  const p2sh = btc.p2sh(p2wpkhForP2sh, network);
  return {
    script: p2sh.script,
    redeemScript: p2sh.redeemScript,
  };
}

/**
 * Creates an input script for the Leather wallet
 * The payment address for Leather is always a P2WPKH / Native SegWit (bc1q...)
 *
 * see https://leather.gitbook.io/developers/bitcoin/sign-transactions/partially-signed-bitcoin-transactions-psbts
 */
export function createInputScriptForLeather(paymentPublicKey: Uint8Array, network: typeof btc.NETWORK) {
  const p2wpkh = btc.p2wpkh(paymentPublicKey, network);
  return {
    script: p2wpkh.script,
    redeemScript: undefined // Not needed for P2WPKH
  };
}

/**
 * Creates an input script for the Unisat wallet, detecting and handling various address types.
 *
 * The assumption is that we ONLY have these address formats:
 * - Legacy (P2PKH)
 * - Nested Segwit (P2SH-P2WPKH) --> identified as P2SH???
 * - Native Seqwit (P2WPKH)
 * - Taproot (P2TR)
 *
 * @param paymentAddress - The payment address of the Unisat wallet.
 * @param paymentPublicKey - The public key associated with the payment address.
 * @param network - The Bitcoin network (mainnet or testnet).
 * @returns An object containing the necessary script and redeemScript for the transaction input.
 */
export function createInputScriptForUnisat(paymentAddress: string, paymentPublicKey: Uint8Array, network: typeof btc.NETWORK) {
  const addressFormat = getAddressFormat(paymentAddress);

  switch (addressFormat) {
      // "Legacy" Pay-to-Public-Key-Hash
      case 'P2PKH': {
      const p2pkh = btc.p2pkh(paymentPublicKey, network);
      return {
        script: p2pkh.script,
        redeemScript: undefined // Not needed for P2PKH
      };
    }
    // Nested Segwit
    case 'P2SH???': {
      const p2wpkhForP2sh = btc.p2wpkh(paymentPublicKey, network);
      const p2sh = btc.p2sh(p2wpkhForP2sh, network);
      return {
        script: p2sh.script,
        redeemScript: p2sh.redeemScript
      };
    }
    // Native Seqwit
    case 'P2WPKH': {
      const p2wpkh = btc.p2wpkh(paymentPublicKey, network);
      return {
        script: p2wpkh.script,
        redeemScript: undefined // Not needed for P2WPKH
      };
    }
    // Taproot
    case 'P2TR': {
      const p2tr = btc.p2tr(paymentPublicKey, undefined, network);
      return {
        script: p2tr.script,
        redeemScript: undefined // Taproot uses witness program directly
      };
    }
    default:
      throw new Error('Unexpected address format encountered.');
  }
}

/**
 * Creates the funding input for the supported wallets
 */
export function createInput(walletType: KnownOrdinalWalletType,
  paymentOutput: TxnOutput,
  paymentPublicKey: Uint8Array,
  paymentAddress: string,
  network: typeof btc.NETWORK) {

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
      scriptInfo = createInputScriptForUnisat(paymentAddress, paymentPublicKey, network);
      break;

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
    sequence: 0xfffffffd, // enables RBF
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

  const input = createInput(walletType, paymentOutput, paymentPublicKey, paymentAddress, network);
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
 * The generated 'dummyPublicKey' key does not work for taproot!
 * Use the 'schnorrDummyPublicKey' for taproot!
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

    // see https://stackoverflow.com/a/72411600
    const schnorrPublicKey: Uint8Array = schnorr.getPublicKey(dummyPrivateKey);
    const schnorrPublicKeyHex: string = hex.encode(schnorrPublicKey);

    getDummyKeypairResult = {
      dummyPrivateKey,
      dummyPublicKey,
      dummyPublicKeyHex,
      addressP2PKH,
      addressP2WPKH,
      addressP2TR,
      schnorrPublicKey,
      schnorrPublicKeyHex
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

// as seen here: https://github.com/unisat-wallet/unisat-web3-demo/blob/1109c79b07517ef4abe069c0c80b2d2118915e19/src/App.tsx#L208
// and here https://github.com/unisat-wallet/unisat-web3-demo/blob/1109c79b07517ef4abe069c0c80b2d2118915e19/src/App.tsx#L313C13
export async function signTransactionUnisatAndBroadcast(psbtBytes: Uint8Array): Promise<{ txId: string }> {

  const psbtHex: string = hex.encode(psbtBytes);
  const psbtResult = await (window as any).unisat.signPsbt(psbtHex);
  const txId = await (window as any).unisat.pushPsbt(psbtResult);
  return { txId };
}
