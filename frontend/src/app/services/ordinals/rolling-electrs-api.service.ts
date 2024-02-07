import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { Transaction } from '../../interfaces/electrs.interface';
import { StateService } from '../state.service';

// looks like they blocked us 😞

const apiUrlsMainnet = [
  // the well-known electrs instance from blockstream
  // 'https://blockstream.info',

  // and the one and only mempool.space API
  // 'https://mempool.space',           // @wiz  ❌ CORS!

  // self-hosted mempool.space instances
  //'https://mempool.ninja',         // @wiz and/or @softsimon ? ❌ CORS!
  //'https://mempool.emzy.de',       // @emzy
  //'https://mempool.bisq.services', // @devinbileck ❌ CORS!
  'https://mempool.bitaroo.net',     // @BitarooExchange ✅ (but fewer txns)
  'https://mempool.nixbitcoin.org',  // @nixbitcoinorg ✅ (but fewer txns)

   // enterprise mempool.space instances
   //'https://mutiny.mempool.space',  // @MutinyWallet ❌ CORS!
   //'https://diba.mempool.space'     // @trydiba ❌ CORS!
];

const apiUrlsTestnet = [
  'https://mempool.space'
];


/**
 * Service to interact with Electrs APIs in a rolling fashion to distribute load.
 *
 * Note: there are sometimes '404 Not Found' for unconfirmed txns,
 * because Mempool Space has slightly different data from the rest of the instances
 */
@Injectable({
  providedIn: 'root'
})
export class RollingElectrsApiService {
  private apiUrls = apiUrlsMainnet;

  private currentApiIndex = 0;
  private requestCount = 0; // Counter to track the number of requests made
  private apiBasePath: string; // network path is /testnet, etc. or '' for mainnet

  /**
   * Constructs the RollingElectrsApiService.
   *
   * @param httpClient The HttpClient used for making API requests.
   */
  constructor(private httpClient: HttpClient,
    private stateService: StateService) {

    this.apiBasePath = ''; // assume mainnet by default

    this.stateService.networkChanged$.subscribe((network) => {
      this.apiBasePath = network ? '/' + network : '';
      this.apiUrls = network ? apiUrlsTestnet : apiUrlsMainnet;
    });
  }

  /**
   * Gets the next API URL from the list and updates the current index.
   * @returns The next API URL to use.
   */
  private getNextApiUrl(): string {
    // Every second request goes to blockstream.info
    if (this.requestCount % 2 === 0) {
      return 'https://blockstream.info';
    } else {
      // Cycle through other servers
      const url = this.apiUrls[this.currentApiIndex];
      this.currentApiIndex = (this.currentApiIndex + 1) % this.apiUrls.length;
      return url;
    }
  }

  /**
   * Fetches a transaction from the Electrs API, rotating through available servers on each call.
   * In case of an error, it retries with the next server.
   * @param txid The transaction ID to fetch.
   * @param retryCount The current retry attempt count.
   * @returns An Observable of the Transaction.
   */
  public getTransaction$(txid: string, retryCount: number = 0): Observable<Transaction> {
    const apiUrl = this.getNextApiUrl();
    this.requestCount++; // Increment the request counter

    return this.httpClient.get<Transaction>(`${apiUrl}${this.apiBasePath}/api/tx/${txid}`).pipe(
      catchError((error) => {
        if (retryCount < this.apiUrls.length - 1) {
          return this.getTransaction$(txid, retryCount + 1);
        } else {
          return throwError(() => new Error(`Failed to fetch transaction ${txid} after multiple attempts`));
        }
      })
    );
  }
}
