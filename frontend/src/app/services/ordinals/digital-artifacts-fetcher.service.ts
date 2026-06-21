import { inject, Injectable } from '@angular/core';
import { DigitalArtifact, DigitalArtifactsParserService, DigitalArtifactType } from 'ordpool-parser';
import { catchError, map, merge, Observable, of, Subject, tap, throwError, timeout } from 'rxjs';
import { Transaction } from 'src/app/interfaces/electrs.interface';

import { BlockstreamApiService } from './blockstream-api.service';
import { WalletService } from 'ordpool-sdk';
import { ElectrsApiService } from '../electrs-api.service';


/**
 * A simple service to fetch parsed artifacts sequentially
 */
@Injectable({
  providedIn: 'root',
})
export class DigitalArtifactsFetcherService {

  private readonly maxCacheSize = 100 * 1000; // maximum number of transaction to cache (let's see if this breaks browsers)

  walletService = inject(WalletService);
  electrsApiService = inject(ElectrsApiService);
  blockstreamApiService = inject(BlockstreamApiService);

  /**
   * Cache for the fetched inscriptions.
   * JavaScript Map objects retain insertion order, which makes it convenient to implement a rudimentary LRU cache
   * LRU (Least Recently Used)
  */
  private cachedArtifactsTxns: Map<string, DigitalArtifact[]> = new Map();

  /**
   * Initializes a new instance of the DigitalArtifactsFetcherService.
   * @param rolling - A service to interact with an Esplora Electrs APIs.
   */
  constructor() {

    // reset cache on network change!
    this.walletService.isMainnet$.subscribe(() => {
      this.cachedArtifactsTxns = new Map();
    });
  }

  /**
   * Fetches artifacts for the specified transaction.
   *
   * @param txid - The transaction ID.
   * @param priority - Whether the request has a higher priority.
   * @returns An Observable with the digital artifacts.
   */
  fetchArtifacts(txid: string): Observable<DigitalArtifact[]> {

    const cachedResult = this.cachedArtifactsTxns.get(txid);
    if (cachedResult !== undefined) {
      return of(cachedResult);
    }

    return this.fetchTransaction(txid).pipe(
      map(txn => DigitalArtifactsParserService.parse(txn)),
      tap(artifacts => this.addToCache(txid, artifacts))
    );

  }

  /**
   * Adds a transaction to the cache.
   *
   * @param txid - The transaction ID.
   * @param artifacts - The parsed inscriptions or an empty array.
   */
  private addToCache(txid: string, artifacts: DigitalArtifact[]): void {

    // If the cache size has reached its limit, delete the oldest entry
    if (this.cachedArtifactsTxns.size >= this.maxCacheSize) {
      const firstKey = this.cachedArtifactsTxns.keys().next().value;
      this.cachedArtifactsTxns.delete(firstKey);
      // console.log('Cache limit reached!');
    }

    // Add the new entry to the cache
    this.cachedArtifactsTxns.set(txid, artifacts);
  }

  /**
   * Fetches a single transaction by ID. Order:
   *
   * 1. Our own backend (api.ordpool.space → electrs → bitcoind on happysrv)
   * 2. fallback: blockstream.info (kept — electrs gets slow under
   *    high traffic; Blockstream's public Esplora is the one trusted
   *    Bitcoin-infra fallback we accept on display paths).
   *
   * Trust narrowing per audit L5: blockchain.info (no testnet, less
   * trusted) was removed. mempool.space was never reachable from this
   * chain anyway (host-banned us during the v2 cutover).
   *
   * @param txid The transaction ID.
   * @returns Observable of the transaction data.
   */
  fetchTransaction(txid: string): Observable<Transaction> {
    return this.electrsApiService.getTransaction$(txid).pipe(
      catchError(() => this.blockstreamApiService.getTransaction$(txid)),
      catchError(() => throwError(() => new Error(`Failed to fetch the transaction ${txid} from all possible services.`)))
    );
  }
}
