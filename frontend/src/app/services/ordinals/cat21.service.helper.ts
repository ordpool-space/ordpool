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
  TxnOutput
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
 * Determines whether a given Bitcoin address is a Segregated Witness (SegWit) address.
 *
 * The determination of P2SH addresses as SegWit is based on the assumption that P2SH addresses
 * are being used for SegWit purposes, which may not always be the case.
 */
export function isSegWit(address: string) {
  const addressFormat = getAddressFormat(address);
  return addressFormat !== 'P2PKH';
}

/**
 * Converts a full public key (including the y-coordinate parity byte) into an x-only public key.
 *
 * In the context of Schnorr signatures and Taproot transactions in Bitcoin, public keys are represented
 * as x-only coordinates. This is because Schnorr signatures utilize x-only public keys, which are 32 bytes long
 * and consist only of the x-coordinate of the elliptic curve point. This format contributes to privacy
 * and efficiency in Taproot transactions by not revealing unnecessary information about the public key
 * and reducing the size of transactions.
 *
 * The first byte of a compressed ECDSA public key (0x02 or 0x03) indicates the y-coordinate's parity
 * and is unnecessary for Schnorr signatures. Removing this byte aligns the public key format with the
 * Schnorr and Taproot standards.
 *
 * as seen here: https://github.com/paulmillr/scure-btc-signer/discussions/77
 *
 * @param pubkey - The full public key, including the y-coordinate parity byte at the beginning.
 * @returns The x-only public key, with the y-coordinate parity byte removed.
 */
export function toXOnly(pubkey: Uint8Array) {
  return pubkey.subarray(1, 33);
}

const getDummyKeypairResult: { [key: string]: DummyKeypairResult } = {};

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
 * The results are cached.
 */
export function getDummyKeypair(network: typeof btc.NETWORK): DummyKeypairResult {

  if (!getDummyKeypairResult[network.bech32]) {

    const dummyPrivateKey: Uint8Array = hex.decode('0101010101010101010101010101010101010101010101010101010101010101');
    const dummyPublicKey: Uint8Array = secp256k1.getPublicKey(dummyPrivateKey, true);

    // see https://stackoverflow.com/a/72411600
    const xOnlyDummyPublicKey: Uint8Array = schnorr.getPublicKey(dummyPrivateKey);

    // Legacy address (P2PKH)
    // 1C6Rc3w25VHud3dLDamutaqfKWqhrLRTaD for mainnet
    const addressP2PKH = btc.getAddress('pkh', dummyPrivateKey, network);

    // Nested Segwit (P2SH-P2WPKH)
    // 35LM1A29K95ADiQ8rJ9uEfVZCKffZE4D9i for mainnet
    const p2ret = btc.p2sh(btc.p2wpkh(dummyPublicKey, network), network);
    const addressP2SH_P2WPKH = p2ret.address;

    // Native Seqwit (P2WPKH)
    // bc1q0xcqpzrky6eff2g52qdye53xkk9jxkvrh6yhyw for mainnet
    const addressP2WPKH = btc.getAddress('wpkh', dummyPrivateKey, network);

    // TapRoot KeyPathSpend
    // bc1p33wm0auhr9kkahzd6l0kqj85af4cswn276hsxg6zpz85xe2r0y8syx4e5t for mainnet
    const addressP2TR = btc.getAddress('tr', dummyPrivateKey, network);


    getDummyKeypairResult[network.bech32] = {
      dummyPrivateKey,
      dummyPublicKey,
      xOnlyDummyPublicKey,
      addressP2PKH,
      addressP2SH_P2WPKH,
      addressP2WPKH,
      addressP2TR,
    };
  }

  return getDummyKeypairResult[network.bech32];
}

/**
 * Generates a dummy legacy (P2PKH) transaction for simulation.
 * The transaction includes a number of outputs equal to the `vout` value of the provided `TxnOutput`,
 * with each output having the same value as in the provided `TxnOutput`.
 *
 * @param txnOutput A transaction output object to base the dummy transaction on.
 * @returns The dummy transaction.
 */
export function getDummyLegacyTransaction(txnOutput: TxnOutput, network: typeof btc.NETWORK): btc.Transaction {

    const { dummyPrivateKey, dummyPublicKey, addressP2PKH } = getDummyKeypair(network);
    const tx = new btc.Transaction();

    // P2WPKH requires no damn nonWitnessUtxo which gives us a signable transaction
    const input: btc.TransactionInputUpdate = {
      txid: '0000000000000000000000000000000000000000000000000000000000000000',
      index: 0,
      witnessUtxo: {
        script: btc.p2wpkh(dummyPublicKey, network).script,
        amount: BigInt(txnOutput.value * (txnOutput.vout+1))
      }
    };
    tx.addInput(input);

    // Add outputs based on txnOutput.vout, each output having the same value
    for (let i = 0; i <= txnOutput.vout; i++) {
      tx.addOutputAddress(addressP2PKH, BigInt(txnOutput.value), network);
    }

    // Sign the input with the dummy private key
    tx.signIdx(dummyPrivateKey, 0);
    tx.finalize();

    return tx;
}

/**
 * Creates an input script for the Xverse wallet
 * The payment address for Xverse is always a P2SH-P2WPKH / Nested SegWit (3...).
 *
 * see https://docs.xverse.app/sats-connect/methods/signmessage
 * > "ECDSA signatures over the secp256k1 curve when signing with the BTC payment (p2sh(p2wpkh)) address"
 */
export function createInputScriptForXverse(paymentPublicKey: Uint8Array, network: typeof btc.NETWORK): btc.P2Ret {
  const p2wpkhForP2sh = btc.p2wpkh(paymentPublicKey, network);
  return btc.p2sh(p2wpkhForP2sh, network);
}

/**
 * Creates an input script for the Leather wallet
 * The payment address for Leather is always a P2WPKH / Native SegWit (bc1q...)
 *
 * see https://leather.gitbook.io/developers/bitcoin/sign-transactions/partially-signed-bitcoin-transactions-psbts
 */
export function createInputScriptForLeather(paymentPublicKey: Uint8Array, network: typeof btc.NETWORK): btc.P2Ret {
  return btc.p2wpkh(paymentPublicKey, network);
}

/**
 * Creates an input script for the Unisat wallet, detecting and handling various address types.
 *
 * The assumption is that we _ONLY_ have these address formats:
 * - Legacy (P2PKH)
 * - Nested Segwit (P2SH-P2WPKH) --> identified as P2SH???
 * - Native Seqwit (P2WPKH)
 * - Taproot (P2TR)
 *
 * see https://docs.unisat.io/unisat-wallet/address-type
 * > UniSat Wallet supports 4 Bitcoin address formats and allows switching between them in the settings.
 *
 * @param paymentAddress - The payment address of the Unisat wallet.
 * @param paymentPublicKey - The public key associated with the payment address.
 * @param network - The Bitcoin network (mainnet or testnet).
 * @returns An object containing the necessary script and redeemScript for the transaction input.
 */
export function createInputScriptForUnisat(paymentAddress: string, paymentPublicKey: Uint8Array, network: typeof btc.NETWORK): btc.P2Ret {
  const addressFormat = getAddressFormat(paymentAddress);

  switch (addressFormat) {
    // "Legacy" Pay-to-Public-Key-Hash
    case 'P2PKH': {
      // Legacy addresses do not use witness data
      return btc.p2pkh(paymentPublicKey, network);
    }
    // P2SH could be anything, but for Unisat we know that it is Nested Segwit
    case 'P2SH???': {
      const p2wpkhForP2sh = btc.p2wpkh(paymentPublicKey, network);
      return btc.p2sh(p2wpkhForP2sh, network);
    }
    // Native Seqwit
    case 'P2WPKH': {
      return btc.p2wpkh(paymentPublicKey, network);
    }
    // Taproot
    case 'P2TR': {
      // Key-spend -- which is the simpler setup!
      // for script-spend see here: https://github.com/paulmillr/scure-btc-signer/issues/51
      // scriptData = btc.p2tr(undefined, btc.p2tr_pk(paymentPublicKey), network, true); // script-spend
      return btc.p2tr(paymentPublicKey, undefined, network, true);
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
  isSimulation: boolean,
  network: typeof btc.NETWORK): btc.TransactionInputUpdate {

  let scriptData: btc.P2Ret | btc.P2TROut;
  let paymentPublicKeyToUse = paymentPublicKey;

  // in a simulation we use our well-known dummy key instead, so that we can do the fake signing
  if (isSimulation) {
    paymentPublicKeyToUse = getDummyKeypair(network).dummyPublicKey;
  }

  switch (walletType) {
    case KnownOrdinalWalletType.leather: {
      scriptData = createInputScriptForLeather(paymentPublicKeyToUse, network);
      break;
    }
    case KnownOrdinalWalletType.xverse: {
      scriptData = createInputScriptForXverse(paymentPublicKeyToUse, network);
      break;
    }
    case KnownOrdinalWalletType.unisat: {

      // special case for taproot --> x-only public key
      if (getAddressFormat(paymentAddress) === 'P2TR') {

        if (isSimulation) {
          paymentPublicKeyToUse = getDummyKeypair(network).xOnlyDummyPublicKey;
        } else {
          paymentPublicKeyToUse = toXOnly(paymentPublicKey);
        }
      }

      scriptData = createInputScriptForUnisat(paymentAddress, paymentPublicKeyToUse, network);
      break;
    }
    default:
      // this case should never happen, but otherwise the code is not type-safe
      throw new Error('Unknown wallet');
  }

  const { script, redeemScript } = scriptData;

  let input: btc.TransactionInputUpdate = {
    txid: paymentOutput.txid,
    index: paymentOutput.vout,
    redeemScript,
    // sequence: 0xfffffffd, // DISABLES RBF!! (the cat killer 🙀)
    sighashType: btc.SigHash.ALL
  };

  if (isSegWit(paymentAddress)) {
    input.witnessUtxo = {
      script,
      amount: BigInt(paymentOutput.value),
    };

    // taproot uses P2TROut, which has some extra properties that we all just merge into the intput
    // Required tx input fields to make it spendable: `tapInternalKey`, `tapMerkleRoot`, `tapLeafScript`
    if (getAddressFormat(paymentAddress) === 'P2TR') {
      input = { ...input, ...scriptData };
    }
  } else {
    // For non-SegWit (legacy P2PKH), we have to use nonWitnessUtxo instead --> with the full transaction provided
    // see https://github.com/paulmillr/scure-btc-signer/blob/2d5388ac6c4b94364d65330cdc84a653a6a5281f/README.md?plain=1#L831
    if (paymentOutput.transactionHex) {

      if (isSimulation) {
        const dummyTx = getDummyLegacyTransaction(paymentOutput, network);
        input.txid = dummyTx.id;
        input.nonWitnessUtxo = hex.decode(dummyTx.hex);
      } else {
        input.nonWitnessUtxo = hex.decode(paymentOutput.transactionHex);
      }

    } else {
      throw new Error('Missing transaction hex for legacy UTXO input');
    }
  }

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
 * @param paymentPublicKey - The public key of the sender, in hexadecimal.
 * @param paymentAddress - The sender's address, to which change will be returned.
 * @param transactionFee - The miner fee in satoshis.
 * @param isSimulation - Flag indicating whether the transaction should be prepared for a simulation
 * @param isMainnet - Flag indicating whether the transaction is for mainnet or testnet
 * @returns The constructed transaction.
 */
export function createTransaction(
  walletType: KnownOrdinalWalletType,
  recipientAddress: string,

  paymentOutput: TxnOutput,
  paymentPublicKey: Uint8Array,
  paymentAddress: string,
  transactionFee: bigint,
  isSimulation: boolean,
  isMainnet: boolean,
): CreateTransactionResult {

  const network: typeof btc.NETWORK = isMainnet ? btc.NETWORK : btc.TEST_NETWORK;

  const lockTime = 21;
  const tx = new btc.Transaction({
    lockTime,
    allowLegacyWitnessUtxo: true, // for Unisat Legacy address
    disableScriptCheck: true
  });

  const input = createInput(walletType, paymentOutput, paymentPublicKey, paymentAddress, isSimulation, network);
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
    tx.addOutputAddress(recipientAddress, singleInputAmount - transactionFee, network);
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

export async function signTransactionLeather(psbtBytes: Uint8Array, isMainnet: boolean): Promise<LeatherPSBTBroadcastResponse> {

  const network = isMainnet ? 'mainnet' : 'testnet';
  const psbtHex: string = hex.encode(psbtBytes);

  const signRequestParams: LeatherSignPsbtRequestParams = {
    hex: psbtHex,
    allowedSighash: [btc.SigHash.ALL],
    signAtIndex: 0,
    network,
    broadcast: false // we will broadcast it via the Mempool API
  };

  // Sign the PSBT (and broadcast)
  return await (window as any).btc.request('signPsbt', signRequestParams);
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
            sigHash: btc.SigHash.ALL
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
