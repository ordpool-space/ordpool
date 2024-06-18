import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { Transaction } from '../../interfaces/electrs.interface';
import { StateService } from '../state.service';

const apiUrl = 'https://blockstream.info';


/**
 * Service to interact with the Electrs APIs of blockstream.info
 */
@Injectable({
  providedIn: 'root'
})
export class BlockstreamApiService {

  private apiBasePath: string; // network path is /testnet, etc. or '' for mainnet

  httpClient = inject(HttpClient);
  stateService = inject(StateService);

  constructor() {

    this.apiBasePath = ''; // assume mainnet by default
    this.stateService.networkChanged$.subscribe((network) => {
      this.apiBasePath = network ? '/' + network : '';
    });
  }

  /**
   * Fetches a transaction from the Electrs API
   * @returns An Observable of the Transaction.
   */
  public getTransaction$(txid: string): Observable<Transaction> {
    return this.httpClient.get<Transaction>(`${apiUrl}${this.apiBasePath}/api/tx/${txid}`);
  }
}
