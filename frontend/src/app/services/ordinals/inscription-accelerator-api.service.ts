import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { WalletService } from './wallet.service';


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

export function isCreatePsbtErrorResponse(obj: any): obj is CreatePsbtErrorResponse {
  return obj && typeof obj === 'object' && 'success' in obj && obj.success === false;
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
  requestSignPsbtAndBroadcast(requestBody: CreatePsbtBody) {

    return this.createPsbt(requestBody).pipe(

    )
  }


  /**
   * Sends a request to the backend, that creates a PSBT
   * with a CPFP (Child-Pays-For-Parent) transaction to accelerate an inscription
   *
   * Known errors (known by Johannes):
   * - Output X:0 already confirmed
   * - Not enough cardinal spendable funds. Address has: X sats Needed: X sats
   *
   * @param requestBody - The request body containing transaction details.
   * @returns The response from the server.
   */
  private createPsbt(requestBody: CreatePsbtBody): Observable<CreatePsbtSuccessResponse> {
    return this.http.post<CreatePsbtSuccessResponse | CreatePsbtErrorResponse>(this.apiUrl, requestBody).pipe(
      map(response => {

        if (isCreatePsbtErrorResponse(response)) {
          throw new Error(response.message);
        }

        return response;
      })
    );
  }
}
