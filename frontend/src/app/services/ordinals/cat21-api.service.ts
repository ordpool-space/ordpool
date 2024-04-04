import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { WalletService } from './wallet.service';

export interface StatusResult {
  network: string;
  indexedCats: number;
  lastSuccessfulExecution: string;
  uptime: number;
}

export interface Cat21 {
  transactionId: string;
  blockId: string;
  number: number;
  feeRate: number;
  blockHeight: number;
  blockTime: number;
  fee: number;
  size: number;
  weight: number;
  value: number;
  sat: number;
  firstOwner: string;
}

export interface Cat21PaginatedResult {
  cats: Cat21[];
  totalResults: number;
  itemsPerPage: number;
  currentPage: number;
}

export interface Cat21SingleResult {
  cat: Cat21;
  previousTransactionId: string | null;
  nextTransactionId: string | null;
}

export interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string;
  stack?: string;
}

export interface WhitelistStatusResult {
  walletAddress: string;
  level: string;
  mintingAllowed: boolean;
  mintingAllowedAt: string;
}


@Injectable({
  providedIn: 'root'
})
export class Cat21ApiService {

  private baseUrl = environment.cat21BaseUrl;
  private walletService = inject(WalletService);
  private http = inject(HttpClient);

  constructor() {
    this.walletService.isMainnet$.subscribe(isMainnet => {
      this.baseUrl = isMainnet ? environment.cat21BaseUrl : environment.cat21BaseUrl + '/testnet';
    });
  }

  getStatus(): Observable<StatusResult> {
    return this.http.get<StatusResult>(`${this.baseUrl}/api/status`);
  }

  getCats(itemsPerPage: number, currentPage: number): Observable<Cat21PaginatedResult> {
    return this.http.get<Cat21PaginatedResult>(`${this.baseUrl}/api/cats/${itemsPerPage}/${currentPage}`);
  }

  getCat(transactionId: string): Observable<Cat21SingleResult> {
    return this.http.get<Cat21SingleResult>(`${this.baseUrl}/api/cat/${transactionId}`);
  }

  getCatsByBlockId(blockId: string): Observable<Cat21[]> {
    return this.http.get<Cat21[]>(`${this.baseUrl}/api/cats/by-block-id/${blockId}`);
  }

  getCatsBySatRanges(body: any): Observable<Cat21[]> {
    return this.http.post<Cat21[]>(`${this.baseUrl}/api/cats/by-sat-ranges`, body);
  }

  getCatsByUtxos(body: any): Observable<Cat21[]> {
    return this.http.post<Cat21[]>(`${this.baseUrl}/api/cats/by-utxos`, body);
  }

  getWhitelistStatus(walletAddress: string): Observable<WhitelistStatusResult> {
    return this.http.get<WhitelistStatusResult>(`${this.baseUrl}/whitelist/status/${walletAddress}`);
  }
}
