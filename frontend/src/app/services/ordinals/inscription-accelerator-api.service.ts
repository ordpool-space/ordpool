import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, switchMap } from 'rxjs';
import { BitcoinNetworkType, signTransaction } from 'sats-connect';

import { KnownOrdinalWalletType, WalletService } from './wallet.service';


/**
 * UTXO in the format txid:vout
 */
export type Utxo = string;


export interface CreatePsbtBody {
  utxos: Utxo[];
  feeRate: number;

  buyerOrdinalAddress: string;
  buyerOrdinalPublicKey: string;

  buyerPaymentAddress: string;
  buyerPaymentPublicKey: string;
}

export interface CreatePsbtErrorResponse {
  success: boolean;
  status: number;
  message: string;
  stack: any; // ???
}

export interface CreatePsbtSuccessResponse {
  psbt: string;
  buyerInputIndices: number[];
}

@Injectable({
  providedIn: 'root'
})
export class InscriptionAcceleratorApiService {

  apiUrl = 'https://api.ordinalsbot.com/cpfp';
  http = inject(HttpClient);
  walletService = inject(WalletService);


  /**
   * Requests to sign the Psbt and to broadcast it
   */
  signPsbtAndBroadcast(
    walletType: KnownOrdinalWalletType,
    requestBody: CreatePsbtBody): Observable<{ txId: string }> {

    return this.createPsbt(requestBody).pipe(
      // tap(result => console.log('Generated PSBT:', result)),
      switchMap(result => {

        // // testing
        // return of({ txId: '1212' });

        if (walletType === KnownOrdinalWalletType.xverse) {
          return this.signTransactionXverse({
            psbtBase64: result.psbt,
            buyerOrdinalAddress: requestBody.buyerOrdinalAddress,
            buyerPaymentAddress: requestBody.buyerPaymentAddress
          });
        }

        throw new Error('Wallet not supported (yet)!');
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
  private signTransactionXverse(d: {
    psbtBase64: string,
    buyerOrdinalAddress: string,
    buyerPaymentAddress: string
  }): Observable<{ txId: string }> {

    return new Observable<{ txId: string }>((observer) => {
      signTransaction({
        payload: {
          network: {
            type: BitcoinNetworkType.Mainnet,
            address: d.buyerOrdinalAddress
          },
          message: 'Sign Transaction (Inscription Accelerator)',
          psbtBase64: d.psbtBase64,
          broadcast: true,
          inputsToSign: [{
            address: d.buyerOrdinalAddress,
            signingIndexes: [0],
            sigHash: 131 // SIGHASH_SINGLE | ANYONECANPAY
          }, {
            address: d.buyerPaymentAddress,
            signingIndexes: [1]
          }]
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
   * Sends a request to the backend, that creates a PSBT
   * with a CPFP (Child-Pays-For-Parent) transaction to accelerate an inscription
   *
   * Example data:
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
  private async signPsbtUnisat(psbtHex: string) {

    const psbtResult = await (window as any).unisat.signPsbt(psbtHex);

  }
}
