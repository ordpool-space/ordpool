import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, concatMap, from, map, Observable, switchMap, tap } from 'rxjs';
import { BitcoinNetworkType, InputToSign, signTransaction } from 'sats-connect';

import { KnownOrdinalWalletType, WalletService } from './wallet.service';
import { ApiService } from '../api.service';

import * as btc from '@scure/btc-signer';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { StorageService } from '../storage.service';


export const LAST_INSCRIPTION_ACCELERATIONS = 'LAST_INSCRIPTION_ACCELERATIONS';

export interface InscriptionAcceleration {
  txId: string,
  acceleratedTxId: string;
  acceleratedUtxos: string[],
  feeRate: number;
  createdAt: string // ISO formated string
}

/**
 * UTXO in the format txid:vout
 */
export type Utxo = string;


export interface CreatePsbtBody {

  /**
   * Array of transaction outputs to be accelerated in the following format
   * ["430901147831e41111aced3895ee4b9742cf72ac3cffa132624bd38c551ef379:0"]
   */
  utxos: Utxo[];

  /**
   * Target Fee rate that stuck transaction should be bumped to in sats/vB
   */
  feeRate: number;

  /**
   * Ordinals address where stuck inscription is destined for and will be sent to.
   */
  buyerOrdinalAddress: string;

  /**
   * Ordinals public key where stuck inscription is destined for and will be sent to.
   */
  buyerOrdinalPublicKey: string;

  /**
   * Bitcoin payment address where extra fees will be paid from.
   */
  buyerPaymentAddress: string;

  /**
   * Bitcoin payment public key where extra fees will be paid from.
   */
  buyerPaymentPublicKey: string;
}

export interface CreatePsbtErrorResponse {
  success: boolean;
  status: number;
  message: string;
  stack: any; // ???
}

export interface CreatePsbtSuccessResponse {
  /**
   * PSBT to be signed and published by user's wallet
   */
  psbt: string;

  /**
   * same PSBT in hex format (for leather wallet)
   */
  hex: string;

  /**
   * input indices user will need to sign to create the transaction
   */
  buyerInputIndices: number[];
}

// see https://github.com/leather-wallet/extension/blob/8dbfefe8fcf5de687c2a137bce5eb2ff7a94b794/src/shared/rpc/methods/sign-psbt.ts#L49
interface LeatherSignPsbtRequestParams {
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

const ordinalsbotMainnetApiUrl = 'https://api.ordinalsbot.com/cpfp';
const ordinalsbotTestnetApiUrl = 'https://testnet-api.ordinalsbot.com/cpfp';

@Injectable({
  providedIn: 'root'
})
export class InscriptionAcceleratorApiService {

  apiUrl = ordinalsbotMainnetApiUrl;
  http = inject(HttpClient);
  apiService = inject(ApiService);
  walletService = inject(WalletService);
  storageService = inject(StorageService);

  isMainnet = true;

  allAccelerations$ = new BehaviorSubject<InscriptionAcceleration[]>([]);

  constructor() {
    this.walletService.isMainnet$.subscribe(isMainnet => {

      this.isMainnet = isMainnet;
      this.apiUrl = isMainnet ? ordinalsbotMainnetApiUrl : ordinalsbotTestnetApiUrl;
    });

    const allAccelerations = this.getAllAccelerations();
    this.allAccelerations$.next(allAccelerations);
  }

  /**
   * Requests to sign the Psbt and to broadcast it
   */
  signPsbtAndBroadcast(
    walletType: KnownOrdinalWalletType,
    requestBody: CreatePsbtBody): Observable<{ txId: string }> {

    return this.createPsbt(requestBody).pipe(
      // tap(result => console.log('Generated PSBT:', result)),
      switchMap(preparedPsbt => {

        // // testing
        // return of({ txId: '1212' });

        if (walletType === KnownOrdinalWalletType.xverse) {
          // Xverse is broadcasting on its own
          return this.signTransactionAndBroadcastXverse({
            preparedPsbt,
            buyerOrdinalAddress: requestBody.buyerOrdinalAddress,
            buyerPaymentAddress: requestBody.buyerPaymentAddress
          });
        }

        if (walletType === KnownOrdinalWalletType.leather) {
          return from(this.signTransactionLeather({ preparedPsbt })).pipe(
            concatMap((signedPsbt) => this.broadcastTransactionLeather(signedPsbt))
          );
        }

        // Unisat!
        throw new Error('Your wallet is not supported!');
      }),
      tap(({ txId }) => {
        this.saveNewAcceleration(txId, requestBody);
      })
    );
  }

  /**
   * Sign and broadcast the PSBT with Xverse
   *
   * If the transaction is broadcasted, you will receive a TXID in the response.
   *
   * see also: https://docs.xverse.app/sats-connect/sign-transaction
   */
  private signTransactionAndBroadcastXverse({ preparedPsbt, buyerOrdinalAddress, buyerPaymentAddress }: {
    preparedPsbt: CreatePsbtSuccessResponse,
    buyerOrdinalAddress: string,
    buyerPaymentAddress: string
  }): Observable<{ txId: string }> {

    const inputsToSign: InputToSign[] = preparedPsbt.buyerInputIndices
      .filter(index => index !== 0)
      .map(index => ({
        address: buyerPaymentAddress,
        signingIndexes: [index]
      }));

    inputsToSign.push({
      address: buyerOrdinalAddress,
      signingIndexes: [0],
      sigHash: 131 // SIGHASH_SINGLE | ANYONECANPAY
    });

    return new Observable<{ txId: string }>((observer) => {
      signTransaction({
        payload: {
          network: {
            type: this.isMainnet ? BitcoinNetworkType.Mainnet : BitcoinNetworkType.Testnet,
            address: buyerOrdinalAddress
          },
          message: 'Sign Transaction (Inscription Accelerator)',
          psbtBase64: preparedPsbt.psbt,
          broadcast: true,
          inputsToSign
        },
        onFinish: (response) => {

          const txId = response.txId;

          observer.next({ txId });
          observer.complete();
        },
        onCancel: () => {
          observer.error(new Error('Request was cancelled'));
        }
      });
    });
  }

  /**
   * Example result:
   *
   * {
   *  "jsonrpc": "2.0",
   *  "id": "df423e60-b173-4cf3-9e51-71c93f9c7e5e",
   *  "result": {
   *    "hex": "xxxx"
   *  }
   * }
   */
  private async signTransactionLeather({ preparedPsbt }: { preparedPsbt: CreatePsbtSuccessResponse }): Promise<LeatherPSBTBroadcastResponse> {

    const requestParams: LeatherSignPsbtRequestParams = {
      hex: preparedPsbt.hex,
      // allowedSighash?: SignatureHash[];
      signAtIndex: preparedPsbt.buyerInputIndices,
      network: this.isMainnet ? 'mainnet' : 'testnet',
      broadcast: false // default is false - finalize/broadcast tx
    };

    const result: LeatherPSBTBroadcastResponse = await (window as any).btc.request('signPsbt', requestParams);
    return result ;
  }

  /**
   * We broadcast via the mempool API to receive the txId
   *
   * Hint: executing this twice ends in the following error:
   * sendrawtransaction RPC error: {"code":-26,"message":"bad-txns-spends-conflicting-tx, xxxx spends conflicting transaction yyy "}
   *
   * TODO: flag txn as replaceable
   */
  private broadcastTransactionLeather(resp: LeatherPSBTBroadcastResponse): Observable<{ txId: string }> {

    // as seen in the Leather docs
    const hexRespFromLeather = resp.result.hex;
    const tx = btc.Transaction.fromPSBT(hexToBytes(hexRespFromLeather));
    tx.finalize();

    return this.apiService.postTransaction$(tx.hex).pipe(
      map(txId => ({ txId }))
    );
  }

  /**
   * Sends a request to the backend, that creates a PSBT
   * with a CPFP (Child-Pays-For-Parent) transaction to accelerate an inscription
   *
   * Example data:
   *
   * POST
   *  {
   *    "utxos": [
   *      "430901147831e41111aced3895ee4b9742cf72ac3cffa132624bd38c551ef379:0"
   *    ],
   *    "buyerPaymentAddress": "3Ec1WB9ihWTxAfZSpGmQpNq4pr4goi3KgP",
   *    "buyerOrdinalAddress": "bc1p64fa7mjsvlfcutnfapwhxyuvchxgk22l4at7xsh4z02tuuqwaj5syt6x2e",
   *    "buyerPaymentPublicKey": "0278875d226dd610b06c41d698c9fe0ea4915c797ddc31a3310299d9acd07ff37b",
   *    "buyerOrdinalPublicKey": "5df12ac222a1cd78dd4681c7c7a56f3e273884a086b2b6100957d20c73be3c37",
   *    "feeRate": 50
   *  }
   *
   * CreatePsbtSuccessResponse:
   * {
   *   "psbt": "cHNidP8BAKcCAAAAAnnzHlWM00tiMqH/PKxyz0KXS+6VOO2sERHkMXgUAQlDAAAAAAD//////XhWSWi0h7+oVict55iS8NDCaqY+XHJFVStRhNb4d0oKAAAAAP////8CIgIAAAAAAAAiUSDE4igAqO/bFWqbYInboc0428uv5y8xWkAgucaQqjqfUxqWAQAAAAAAF6kUcEnus0Anf54TWc06YkiA6tqu63eHAAAAAAABASsiAgAAAAAAACJRINVT325QZ9OOLmnoXXMTjMXMiylfr1fjQvUT1L5wDuypAQMEgwAAAAEXICPMmoHvarM+O7gHkY7Ye/Qhp5geRcl4xqeCmy0LPtJTAAEBICasAQAAAAAAF6kUcEnus0Anf54TWc06YkiA6tqu63eHAQQWABTwyVwBTWHy2SpaH+F7GdCHfeG0AAAAAA==",
   *   "buyerInputIndices": [0, 1]
   * }
   *
   * CreatePsbtErrorResponse:
   * {
   *   "success": false,
   *   "status": 500,
   *   "message": "Not enough cardinal spendable funds.\nAddress has:  109606 sats\nNeeded:       129990 sats",
   *   "stack": {}
   * }
   *
   * Known errors (known by Johannes):
   * - Output X:0 already confirmed
   * - Not enough cardinal spendable funds. Address has: X sats Needed: X sats
   * - buyerPaymentPublicKey is required.
   * - buyerOrdinalPublicKey is required.
   *
   * @param requestBody - The request body containing transaction details.
   * @returns The response from the server.
   */
  private createPsbt(requestBody: CreatePsbtBody): Observable<CreatePsbtSuccessResponse> {
    return this.http.post<CreatePsbtSuccessResponse>(this.apiUrl, requestBody);
  }

  // as seen here: https://github.com/unisat-wallet/unisat-web3-demo/blob/1109c79b07517ef4abe069c0c80b2d2118915e19/src/App.tsx#L208C70-L208C77
  /*
  private async signPsbtUnisat(psbtHex: string) {

    const psbtResult = await (window as any).unisat.signPsbt(psbtHex);
  }*/


  /**
   * Get all from local storage
   */
  getAllAccelerations(): InscriptionAcceleration[] {

    let lastAccelerations: InscriptionAcceleration[] = [];
    const stringified = this.storageService.getValue(LAST_INSCRIPTION_ACCELERATIONS);
    if (stringified) {
      lastAccelerations = JSON.parse(stringified);
    }

    return lastAccelerations;
  }

  /**
   * Save to local storage
   */
  saveNewAcceleration(txId: string, { utxos, feeRate }: CreatePsbtBody): void {

    const allAccelerations = this.getAllAccelerations();
    const acceleratedTxId = utxos[0].split(':')[0];

    allAccelerations.push({
      txId,
      acceleratedTxId,
      acceleratedUtxos: utxos,
      feeRate,
      createdAt: (new Date()).toISOString()
    });

    this.storageService.setValue(LAST_INSCRIPTION_ACCELERATIONS, JSON.stringify(allAccelerations));
    this.allAccelerations$.next(allAccelerations);
  }
}
