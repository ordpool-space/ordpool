import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { EMPTY, Observable, of, timer } from 'rxjs';
import { catchError, concatMap, expand, mergeMap, takeWhile, toArray } from 'rxjs/operators';
import { TransactionStripped } from 'src/app/interfaces/node-api.interface';

import { InscriptionFetcherService } from './inscription-fetcher.service';

export interface Inscription {
  id: string;
  number: number;
  address: string;
  genesis_address: string;
  genesis_block_height: number;
  genesis_block_hash: string;
  genesis_tx_id: string;
  genesis_fee: string;
  genesis_timestamp: number;
  tx_id: string;
  location: string;
  output: string;
  value: string;
  offset: string;
  sat_ordinal: string;
  sat_rarity: string;
  sat_coinbase_height: number;
  mime_type: string;
  content_type: string;
  content_length: number;
  timestamp: number;
  curse_type: any;
  recursive: boolean;
  recursion_refs: any;
}

export interface InscriptionsResponse {
  limit: number;
  offset: number;
  total: number;
  results: Inscription[];
}

@Injectable({
  providedIn: 'root'
})
export class HiroApiService {

  private readonly BASE_URL = 'https://api.hiro.so/ordinals/v1';
  private retryCount = 0;
  private maxRetrys = 4;

  constructor(private httpClient: HttpClient,
    private inscriptionFetcherService: InscriptionFetcherService) { }

  /**
   * Retrieves a list of inscriptions based on the provided filters.
   * Warning: Hiro returns zero results if the block hasn't been indexed yet!!
   *
   * @param genesis_block - Bitcoin block identifier (hash)
   * @param offset - Result offset
   * @param limit - Results per page, between 1 and 60
   * @returns Observable containing the inscriptions response
   */
  getInscriptions(genesis_block: string, offset: number = 0, limit: number = 60): Observable<InscriptionsResponse> {
    return this.httpClient.get<InscriptionsResponse>(`${this.BASE_URL}/inscriptions`, {
      params: {
        genesis_block,
        offset,
        limit
      }
    }).pipe(
      catchError(() => of({
        limit,
        offset,
        total: 0,
        results: []
      })) // Return an empty array in case of an error
    );
  }

  /**
   * Recursively retrieves all inscriptions for a given genesis block.
   * Warning: Hiro returns zero results if the block hasn't been indexed yet!!
   *
   * @param genesis_block - Bitcoin block identifier (hash)
   * @returns Observable containing an array of all inscriptions
   */

  fetchAllInscriptions(genesis_block: string): Observable<Inscription[]> {
    return this.getInscriptions(genesis_block).pipe(
      expand(response =>
        response.offset + response.results.length < response.total
          ? this.getInscriptions(genesis_block, response.offset + response.limit)
          : EMPTY  // Use EMPTY here instead of null
      ),
      concatMap(response => response.results),
      toArray()
    );
  }

  /**
   * Recursively fetches and caches all inscriptions for a specific genesis block.
   * If initial call results in an empty array, it retries up to a fixed number of times with increasing intervals.
   *
   * Testing: https://ordinals.com/block/000000000000000000003441ad183b60b2280b0cf5ecb7566d6e6174b9e48551 has 573 Inscriptions
   *
   * @param {string} genesis_block - The Bitcoin block identifier (hash).
   */
  fetchAndCacheBlock(genesis_block: string, transactions: TransactionStripped[]): void {

    this.retryCount = 0;

    this.fetchAllInscriptions(genesis_block).pipe(
      expand((results: Inscription[]) => {
        if (results.length === 0 && this.retryCount <= this.maxRetrys) {
          this.retryCount++;
          // Increment the delay by multiplying the retry count with 5000 (5 seconds)
          return timer(this.retryCount * 5000).pipe(
            mergeMap(() => this.fetchAllInscriptions(genesis_block))
          );
        } else {
          return of(null);  // End condition
        }
      }),
      takeWhile(results => results !== null), // Continue until we get a null (end condition)
      catchError(() => of([])) // Handle potential errors and return an empty array
    ).subscribe(inscriptions => {
      if (inscriptions.length) {

        // If there is NO match, we are save to call addToCache with NULL,
        // so that this txn is not any longer catched!
        for (const transaction of transactions) {
          const matchingInscription = inscriptions.find(i => i.tx_id === transaction.txid);
          if (!matchingInscription) {
            this.inscriptionFetcherService.addToCache(transaction.txid, null); // assuming addToCache takes an array of TransactionStripped type.
          }
        }
      }
    });
  }
}
