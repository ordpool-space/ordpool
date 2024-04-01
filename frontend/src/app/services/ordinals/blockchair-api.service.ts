import { Injectable, inject } from "@angular/core";
import { WalletService } from "./wallet.service";
import { HttpClient } from "@angular/common/http";
import { Observable, catchError, expand, map, of, takeWhile } from "rxjs";

/**
 * Bitcoin Transaction in the format of the Blockchair API
 */
export interface TransactionBlockchair {
  block_id: number;
  id: number;
  hash: string;
  date: string;
  time: string;
  size: number;
  weight: number;
  version: number;
  lock_time: number;
  is_coinbase: boolean;
  has_witness: boolean;
  input_count: number;
  output_count: number;
  input_total: number;
  input_total_usd: number;
  output_total: number;
  output_total_usd: number;
  fee: number;
  fee_usd: number;
  fee_per_kb: number;
  fee_per_kb_usd: number;
  fee_per_kwu: number;
  fee_per_kwu_usd: number;
  cdd_total: number;
}

export interface ContextBlockchair {
  code: number;
  source: string;
  limit: number;
  offset: number;
  rows: number;
  total_rows: number;
  state: number;
  market_price_usd: number;
}

export interface ApiResponseBlockchair {
  data: TransactionBlockchair[];
  context: ContextBlockchair;
}


const BASE_URL = 'https://api.blockchair.com/bitcoin';

/**
 * Service to interact with the Blockchair API for fetching Bitcoin transactions.
 * Debugging hint: block 826877 has 3 cats, block 826587 has 2 cats
 */
@Injectable({
  providedIn: 'root'
})
export class BlockchairApiService {

  private baseUrl = BASE_URL;
  private walletService = inject(WalletService);
  private http = inject(HttpClient);

  constructor() {
    this.walletService.isMainnet$.subscribe(isMainnet => {
      this.baseUrl = isMainnet ? BASE_URL : BASE_URL + '/testnet';
    });
  }



  /**
   * Fetches a limited number of CAT-21 transactions starting from a specific offset.
   *
   * @param blockHeight The block height that should be queried.
   * @param limit The number of transactions to fetch in one call.
   * @param offset The offset from where to start fetching transactions.
   * @param network Empty for Bitcoin Mainnet, 'testnet' for Testnet.
   * @returns An Observable containing the transactions.
   */
  fetchCat21Transactions(blockHeight: number, limit: number, offset: number): Observable<TransactionBlockchair[]> {
    const params = {
      'q': `lock_time(21),time(2023-01-01..),block_id(${ blockHeight })`,
      limit,
      offset,
    };

    return this.http.get<ApiResponseBlockchair>(`${this.baseUrl}/transactions`, { params }).pipe(
      map(response => response.data)
    );
  }

  /**
   * Fetches all transactions by repeatedly calling the Blockchair API.
   * Stops fetching when no more results are returned.
   *
   * @returns An Observable that emits an array of all fetched transactions once completed.
   */
  fetchAllCat21Transactions(blockHeight: number): Observable<TransactionBlockchair[]> {

    const pageSize = 100;
    let offset = 0;

    return this.fetchCat21Transactions(blockHeight, pageSize, offset).pipe(
      expand(transactions => {
        if (transactions && transactions.length === pageSize) {
          offset += pageSize;
          return this.fetchCat21Transactions(blockHeight, pageSize, offset);
        } else {
          return of(null);  // End condition
        }
      }),
      takeWhile(transactions => transactions !== null),
      catchError(() => of([])),
      map(x => x || [])
    );
  }
}
