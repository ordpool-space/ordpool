import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { BehaviorSubject, concatMap, from, map, mergeMap, Observable, of, switchMap, tap, timer, toArray } from 'rxjs';

import { ApiService } from '../api.service';
import { StorageService } from '../storage.service';
import {
  createTransaction,
  getDummyKeypair,
  isSegWit,
  signTransactionAndBroadcastXverse,
  signTransactionLeather,
  signTransactionUnisatAndBroadcast,
} from './cat21.service.helper';
import { Cat21Mint, LeatherPSBTBroadcastResponse, SimulateTransactionResult, TxnOutput } from './cat21.service.types';
import { WalletService } from './wallet.service';
import { KnownOrdinalWalletType } from './wallet.service.types';
import { environment } from '../../../environments/environment';


export const LAST_CAT21_MINTS = 'LAST_CAT21_MINTS';


@Injectable({
  providedIn: 'root'
})
export class Cat21Service {

  mempoolApiUrl = environment.apiBaseUrl;
  http = inject(HttpClient);
  apiService = inject(ApiService);
  walletService = inject(WalletService);
  storageService = inject(StorageService);

  isMainnet = true;
  private txHexCache: { [transactionId: string]: string } = {}; // Cache object

  allMints$ = new BehaviorSubject<Cat21Mint[]>([]);

  constructor() {
    this.walletService.isMainnet$.subscribe(isMainnet => {
      this.isMainnet = isMainnet;
      this.mempoolApiUrl = isMainnet ? environment.apiBaseUrl : environment.apiBaseUrl + '/testnet';
    });

    const allMint = this.getAllMints();
    this.allMints$.next(allMint);
  }

  /**
   * Get the list of unspent transaction outputs associated with the address/scripthash.
   * Available fields: txid, vout, value, and status (with the status of the funding tx).
   *
   * If the address is non-segwit, then we als fetch the transaction hex to be able
   * to construct the input later on
   *
   * @param address The Bitcoin address to query.
   * @returns An Observable of UTXO array.
   */
  public getUtxos(address: string): Observable<TxnOutput[]> {

    if (!address) {
      throw new Error('No wallet connected');
    }

    const $utxos = this.http.get<TxnOutput[]>(`${this.mempoolApiUrl}/api/address/${address}/utxo`);

    if (isSegWit(address)) {
      return $utxos;
    }

    return $utxos.pipe(
      mergeMap(utxos => utxos), // Flatten the array to individual UTXOs
      concatMap(utxo =>
        timer(200).pipe( // Wait for 200ms to avaid
          mergeMap(() => this.getTransactionHex(utxo.txid)),
          map(transactionHex => ({
            ...utxo,
            transactionHex
          }))
        )
      ),
      toArray() // Re-collect the processed UTXOs into an array
    );
  }

  /**
   * Returns a transaction serialized as hex (cached).
   * @param transactionId The Bitcoin transaction ID.
   * @returns An Observable of the transaction serialized as a hex string.
   */
  public getTransactionHex(transactionId: string): Observable<string> {

    const cachedHex = this.txHexCache[transactionId];
    if (cachedHex) {
      return of(cachedHex);
    }

    return this.http.get(`${this.mempoolApiUrl}/api/tx/${transactionId}/hex`, {
      responseType: 'text'
    }).pipe(
      tap((hex) => {
        this.txHexCache[transactionId] = hex;
      })
    );
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
    paymentPublicKey: Uint8Array,
    transactionFee: bigint
  ): SimulateTransactionResult {

    const { dummyPrivateKey } = getDummyKeypair(this.isMainnet ? btc.NETWORK : btc.TEST_NETWORK);

    const result = createTransaction(
      walletType,
      recipientAddress,
      paymentOutput,
      paymentPublicKey,
      paymentAddress,
      transactionFee,
      true, // simulation
      this.isMainnet
    );

    result.tx.signIdx(dummyPrivateKey, 0, [btc.SigHash.ALL]);
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
    paymentPublicKey: Uint8Array,
    transactionFee: bigint
  ): Observable<{ txId: string }> {

    // create the real transaction
    const { tx } = createTransaction(
      walletType,
      recipientAddress,

      paymentOutput,
      paymentPublicKey,
      paymentAddress,
      transactionFee,
      false, // no simulation
      this.isMainnet
    );

    // PSBT as Uint8Array
    const psbtBytes = tx.toPSBT(0);

    let result: Observable<{ txId: string }>;

    switch (walletType) {
      case KnownOrdinalWalletType.leather: {
        result = from(signTransactionLeather(psbtBytes, this.isMainnet)).pipe(
          switchMap(signedPsbt => this.broadcastTransactionLeather(signedPsbt).pipe(
            // retry({ count: 3, delay: 500 }) // Ordpool has a global interceptor for this, otherwise add this line
          ))
        );
        break;
      }
      case KnownOrdinalWalletType.xverse: {
        result = signTransactionAndBroadcastXverse(psbtBytes, paymentAddress, this.isMainnet);
        break;
      }
      case KnownOrdinalWalletType.unisat: {
        result = from(signTransactionUnisatAndBroadcast(psbtBytes));
        break;
      }
      default:
        // this case should never happen, but otherwise the code is not type-safe
        throw new Error('Unknown wallet');
    }

    return result.pipe(
      tap(({ txId }) => {
        this.saveNewMint(txId, paymentAddress,  recipientAddress);
      })
    );
  }

  /**
   * Get all mints from local storage
   */
  getAllMints(): Cat21Mint[] {

    let lastMints: Cat21Mint[] = [];
    const stringified = this.storageService.getValue(LAST_CAT21_MINTS);
    if (stringified) {
      lastMints = JSON.parse(stringified);
    }

    return lastMints;
  }

  /**
   * Save to local storage
   */
  saveNewMint(txId: string, paymentAddress: string, recipientAddress: string): void {

    const allMints = this.getAllMints();

    allMints.push({
      txId,
      paymentAddress,
      recipientAddress,
      createdAt: (new Date()).toISOString()
    });

    this.storageService.setValue(LAST_CAT21_MINTS, JSON.stringify(allMints));
    this.allMints$.next(allMints);
  }
}
