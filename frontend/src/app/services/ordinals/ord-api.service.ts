import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, of, shareReplay, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { WalletService } from './wallet.service';

export interface BlockData {
  hash: string;
  target: string;
  best_height: number;
  height: number;
  inscriptions: string[];
}

export interface RuneEntryTerms {
  amount: bigint; // u128
  cap: bigint;    // u128
  height: [number | null, number | null]; // runestone-lib uses bigint here?!
  offset: [number | null, number | null]; // runestone-lib uses bigint here?!
}

export interface RuneEntry {
  block: number; // runestone-lib uses bigint here?!
  burned: bigint; // u182
  divisibility: number; // u8
  etching: string;
  mints: number;
  number: number;  // ???
  premine: bigint; // u182
  spaced_rune: string;
  symbol: string;
  terms: RuneEntryTerms;
  timestamp: number;
  turbo: boolean;
}

export interface OrdApiRune {
  entry: RuneEntry;
  id: string;
  mintable: boolean;
  parent: string | null;
}

export interface CachedOrdApiRune {
  timestamp: number;
  rune: OrdApiRune;
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
   * NOT USED ATM
   * Retrieves inscription data for a specific Bitcoin block.
   *
   * @param blockHeight The height of the Bitcoin block to retrieve data for.
   * @returns Observable of BlockData containing the block details.
   */
  getBlockData(blockHeight: number): Observable<BlockData | { inscriptions: string[] }> {
    const headers = new HttpHeaders().set('Accept', 'application/json');
    return this.http.get<BlockData>(`${this.baseUrl}/block/${blockHeight}`, { headers });
  }


  private runeCache: Map<string, CachedOrdApiRune> = new Map();
  private runeCacheDuration = 2 * 60 * 1000; // Cache duration in milliseconds (2 minutes)

  /**
   * Retrieves information about a rune and caches the result.
   *
   * If the same blockHeight and transactionNumber are requested within 2 minutes, 
   * the cached result is returned. Otherwise, a new request is made to the API.
   *
   * @param blockHeight The height of the Bitcoin block.
   * @param transactionNumber The number of the transaction within that block.
   * @returns Observable of OrdApiRune containing the rune details.
   */
  getRuneById(blockHeight: number, transactionNumber: number): Observable<OrdApiRune> {
    const cacheKey = `${blockHeight}:${transactionNumber}`;
    const now = Date.now();

    // Check if the cache contains a valid entry
    if (this.runeCache.has(cacheKey)) {
      const cachedEntry = this.runeCache.get(cacheKey)!;
      if (now - cachedEntry.timestamp < this.runeCacheDuration) {
        return of(cachedEntry.rune);
      } else {
        // Remove expired cache entry
        this.runeCache.delete(cacheKey);
      }
    }

    // Fetch data from the API and cache it
    const headers = new HttpHeaders().set('Accept', 'application/json');
    return this.http.get<OrdApiRune>(`${this.baseUrl}/rune/${blockHeight}:${transactionNumber}`, { headers }).pipe(
      tap(rune => {
        this.runeCache.set(cacheKey, { timestamp: now, rune });
      })
    );
  }

  private runeDetailsMap: Map<string, Observable<OrdApiRune>> = new Map();

  /**
   * Retrieves rune details by block height and transaction number.
   * Caches the result and shares the observable among multiple subscribers.
   * 
   * The observable is cached and shared among subscribers using shareReplay,
   * ensuring that multiple requests for the same rune do not result in multiple API calls.
   *
   * @param block The height of the Bitcoin block.
   * @param tx The number of the transaction within that block.
   * @returns An observable containing the rune details.
   */
  getRuneDetails(block: number | bigint, tx: number): Observable<OrdApiRune> {
    const key = `${block}:${tx}`;
    
    if (this.runeDetailsMap.has(key)) {
      return this.runeDetailsMap.get(key);
    } else {
      const runeDetails$ = this.getRuneById(Number(block), tx).pipe(
        shareReplay({
          refCount: true,
          bufferSize: 1
        })
      );
      this.runeDetailsMap.set(key, runeDetails$);
      return runeDetails$;
    }
  }

  static splitRuneId(id : { block: number | bigint, tx: number} | string) : { 
    block: number | bigint;
    tx: number;
  } {

    let block : number | bigint;
    let tx : number;

    if (typeof(id) === 'string') {
      const splitted = id.split(':');
      block = parseInt(splitted[0] , 10);
      tx = parseInt(splitted[1] , 10);
    } else {
      block = id.block;
      tx = id.tx;
    }

    return { block, tx };
  }

  static isUncommonGoods(block: number | bigint | undefined, tx: number | undefined) {
    return (block === 1n && tx === 0) || 
           (block === 1 && tx === 0);
  }
}
