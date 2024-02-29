import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, of, retry } from 'rxjs';

import { environment } from '../../../environments/environment';
import { WalletService } from './wallet.service';

interface BlockData {
  hash: string;
  target: string;
  best_height: number;
  height: number;
  inscriptions: string[];
}


/**
 * Service to interact with the Ordinals Explorer REST API.
 * Ord Server must run with --enable-json-api
 */
@Injectable({
  providedIn: 'root'
})
export class OrdApiService {

  private baseUrl: string = environment.ordBaseUrl;
  private walletService = inject(WalletService);
  private http = inject(HttpClient);

  constructor() {
    this.walletService.isMainnet$.subscribe(isMainnet => {
      this.baseUrl = isMainnet ? environment.ordBaseUrl : environment.ordBaseUrlTestnet;
    });
  }

  /**
   * Retrieves inscription data for a specific Bitcoin block.
   *
   * @param blockNumber The height of the Bitcoin block to retrieve data for.
   * @returns Observable of BlockData containing the block details.
   */
  getBlockData(blockNumber: number): Observable<BlockData | { inscriptions: string[] }> {
    const headers = new HttpHeaders().set('Accept', 'application/json');
    return this.http.get<BlockData>(`${this.baseUrl}/block/${blockNumber}`, { headers }).pipe(
      retry({
        count: 3,
        delay: 2500
      }),
      catchError(() => of({ inscriptions: [] })),
    );
  }
}
