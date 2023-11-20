import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';


/**
 * UTXO in the format txid:vout
 */
export type Utxo = string;


export interface CpfpRequestBody {
  utxos: Utxo[];
  feeRate: number;

  buyerOrdinalAddress: string;
  buyerOrdinalPublicKey: string;

  buyerPaymentAddress: string;
  buyerPaymentPublicKey: string;
}

export interface CpfpErrorResponse {
  success: boolean;
  status: number;
  message: string;
  stack: any; // ???
}

export interface CpfpSuccessResponse {
  psbt: string;
  buyerInputIndices: number[];
}

@Injectable({
  providedIn: 'root'
})
export class CpfpApiService {

  private apiUrl = 'https://api.ordinalsbot.com/cpfp';

  constructor(private http: HttpClient) { }

  /**
   * Sends a CPFP (Child-Pays-For-Parent) request to accelerate a transaction.
   *
   * @param requestBody - The request body containing transaction details.
   * @returns The response from the server.
   */
  public sendCpfpRequest(requestBody: CpfpRequestBody): Observable<CpfpSuccessResponse | CpfpErrorResponse> {
    return this.http.post<CpfpSuccessResponse | CpfpErrorResponse>(this.apiUrl, requestBody);
  }
}
