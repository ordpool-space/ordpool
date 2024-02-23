import { Status } from '../../interfaces/electrs.interface';
import * as btc from '@scure/btc-signer';

export interface TxnOutput {
  txid: string;
  vout: number;
  status: Status;
  value: number;

  // add the hex for legacy inputs only!
  transactionHex?: string;
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

export interface DummyKeypairResult {
  dummyPrivateKey: Uint8Array
  dummyPublicKey: Uint8Array,

  // for taproot transactions which are using schnorr signatures
  xOnlyDummyPublicKey: Uint8Array

  /**
   * "Legacy" Pay-to-Public-Key-Hash (P2PKH)
   */
  addressP2PKH: string,

  /**
   * Nested Segwit (P2SH-P2WPKH)
   */
  addressP2SH_P2WPKH: string,

  /**
   * Native Seqwit (P2WPKH)
   */
  addressP2WPKH: string,

  /**
   * TapRoot (P2TR)
   */
  addressP2TR: string
}

export interface CreateTransactionResult {
  tx: btc.Transaction | null,
  amountToRecipient: bigint, // always 546
  singleInputAmount: bigint,
  changeAmount: bigint,
  finalTransactionFee: bigint
}

export interface SimulateTransactionResult extends CreateTransactionResult {
  vsize: number
}

