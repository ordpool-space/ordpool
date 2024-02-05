import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { from, map, Observable, retry, switchMap } from 'rxjs';

import { ApiService } from '../api.service';
import {
  createTransaction,
  getDummyKeypair,
  signTransactionAndBroadcastXverse,
  signTransactionLeather,
} from './cat21.service.helper';
import { LeatherPSBTBroadcastResponse, SimulateTransactionResult, TxnOutput } from './cat21.service.types';
import { WalletService } from './wallet.service';
import { KnownOrdinalWalletType } from './wallet.service.types';


const mempoolMainnetApiUrl = 'https://mempool.space';
const mempoolTestnetApiUrl = 'https://mempool.space/testnet';



@Injectable({
  providedIn: 'root'
})
export class Cat21Service {

  walletService = inject(WalletService);
  http = inject(HttpClient);
  apiService = inject(ApiService);

  isMainnet = true;
  mempoolApiUrl = mempoolMainnetApiUrl;

  constructor() {
    this.walletService.isMainnet$.subscribe(isMainnet => {
      this.isMainnet = isMainnet;
      this.mempoolApiUrl = isMainnet ? mempoolMainnetApiUrl : mempoolTestnetApiUrl;
    });
  }

  /**
   * Get the list of unspent transaction outputs associated with the address/scripthash.
   * Available fields: txid, vout, value, and status (with the status of the funding tx).
   * @param address The Bitcoin address to query.
   * @returns An Observable of UTXO array.
   */
  public getUtxos(address: string): Observable<TxnOutput[]> {

    if (!address) {
      throw new Error('No wallet connected');
    }

    return this.http.get<TxnOutput[]>(`${this.mempoolApiUrl}/api/address/${address}/utxo`);
  }

  /**
   * Broadcast a transaction via the mempool API
   */
  private broadcastTransactionLeather(resp: LeatherPSBTBroadcastResponse): Observable<{ txId: string }> {

    // as seen in the Leather docs
    const hexRespFromLeather = resp.result.hex;
    const psbt: Uint8Array = hex.decode(hexRespFromLeather);
    const tx = btc.Transaction.fromPSBT(psbt);
    tx.finalize();

    return this.apiService.postTransaction$(tx.hex).pipe(
      map(txId => ({ txId })),
    );
  }

  /**
   * Constructs a fake CAT-21 mint transaction,
   * finalizes the txn and receives the vsize
   *
   * Throws an Error if paymentOutput has not enough funds!
   * - 'Insufficient funds for transaction' via the createTransaction
   * - 'Outputs spends more than inputs amount' when we finalize (second safety net)
   */
  simulateTransaction(
    walletType: KnownOrdinalWalletType,
    recipientAddress: string,

    paymentOutput: TxnOutput,
    paymentAddress: string,
    transactionFee: bigint
  ): SimulateTransactionResult {

    const { dummyPrivateKey, dummyPublicKeyHex } = getDummyKeypair();

    const result = createTransaction(
      walletType,
      recipientAddress,
      paymentOutput,
      dummyPublicKeyHex, // !
      paymentAddress,
      transactionFee,
      this.isMainnet
    );

    result.tx.signIdx(dummyPrivateKey, 0, [btc.SigHash.SINGLE_ANYONECANPAY]);
    result.tx.finalize();
    const vsize = result.tx.vsize; // 🎉

    return {
      ...result,
      vsize
    };
  }

  /**
   * Constructs a PSBT with a CAT-21 mint transaction,
   * prompts the user to sign it and broadcasts the transaction
   */
  createCat21Transaction(
    walletType: KnownOrdinalWalletType,
    recipientAddress: string,

    paymentOutput: TxnOutput,
    paymentAddress: string,
    paymentPublicKeyHex: string,
    transactionFee: bigint
  ): Observable<{ txId: string }> {

    // create the real transaction
    const { tx } = createTransaction(
      walletType,
      recipientAddress,

      paymentOutput,
      paymentPublicKeyHex,
      paymentAddress,
      transactionFee,
      this.isMainnet
    );

    // PSBT as Uint8Array
    const psbtBytes = tx.toPSBT(0);

    switch (walletType) {
      case KnownOrdinalWalletType.leather:
        return from(signTransactionLeather(psbtBytes, this.isMainnet)).pipe(
          switchMap(signedPsbt => this.broadcastTransactionLeather(signedPsbt).pipe(
            retry({ count: 3, delay: 500 })
          ))
        );

      case KnownOrdinalWalletType.xverse:
        return signTransactionAndBroadcastXverse(psbtBytes, paymentAddress, this.isMainnet);

      case KnownOrdinalWalletType.unisat:
        throw new Error('The Unisat wallet is right now not supported!');

      default:
        // this case should never happen, but otherwise the code is not type-safe
        throw new Error('Unknown wallet');
    }
  }
}
