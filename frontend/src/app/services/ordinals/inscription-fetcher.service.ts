import { inject, Injectable } from '@angular/core';
import { DigitalArtifact, DigitalArtifactsParserService } from 'ordpool-parser';
import { catchError, map, merge, Observable, of, Subject, throwError } from 'rxjs';
import { Transaction } from 'src/app/interfaces/electrs.interface';

import { BlockchainApiService } from './blockchain-api.service';
import { RollingElectrsApiService } from './rolling-electrs-api.service';
import { WalletService } from './wallet.service';


interface FetchRequest {
  txid: string;
  subject: Subject<DigitalArtifact[]>;
  priority: boolean;
}

/**
 * A service to fetch parsed artifacts sequentially / parallel for given transactions.
 */
@Injectable({
  providedIn: 'root',
})
export class InscriptionFetcherService {

  private readonly maxCacheSize = 100 * 1000; // maximum number of transaction to cache (let's see if this breaks browsers)

  walletService = inject(WalletService);

  /** A queue to hold the fetch requests. */
  private requestQueue: FetchRequest[] = [];

  /** A flag to indicate whether the queue is currently being processed. */
  private isProcessing: boolean = false;

  /**
   * Cache for the fetched inscriptions.
   * JavaScript Map objects retain insertion order, which makes it convenient to implement a rudimentary LRU cache
   * LRU (Least Recently Used)
  */
  private fetchedInscriptions: Map<string, DigitalArtifact[]> = new Map();

  /**
   * Initializes a new instance of the InscriptionFetcherService.
   * @param rolling - A service to interact with an Esplora Electrs APIs.
   */
  constructor(
    private rollingElectrsApiService: RollingElectrsApiService,
    private blockchainApiService: BlockchainApiService) {

    // reset everything on network change!
    this.walletService.isMainnet$.subscribe(() => {

      this.requestQueue = [];
      this.isProcessing = false;
      this.fetchedInscriptions = new Map();
    });
  }

  /**
   * Fetches inscriptions for the specified transaction.
   *
   * @param txid - The transaction ID.
   * @param priority - Whether the request has a higher priority.
   * @returns An Observable that emits the parsed inscriptions.
   */
  fetchInscriptions(txid: string, priority: boolean = false): Observable<DigitalArtifact[]> {

    const cachedResult = this.fetchedInscriptions.get(txid);
    if (cachedResult !== undefined) {
      return of(cachedResult);
    }

    // Check if a request with the same txid already exists in the queue
    const existingRequest = this.requestQueue.find(request => request.txid === txid);

    if (existingRequest) {
      if (priority && !existingRequest.priority) {
        // If the new request has a higher priority, remove the existing request
        // and add it to the beginning of the queue
        this.requestQueue = this.requestQueue.filter(request => request !== existingRequest);
        existingRequest.priority = true;
        this.requestQueue.unshift(existingRequest);
      }
      return existingRequest.subject.asObservable();
    }

    const requestSubject = new Subject<DigitalArtifact[]>();
    const request: FetchRequest = { txid, subject: requestSubject, priority };

    if (priority) {
      this.requestQueue.unshift(request);
    } else {
      this.requestQueue.push(request);
    }

    if (!this.isProcessing) {
      this.processQueue();
    }

    return requestSubject.asObservable();
  }

  /**
   * Cancels the fetch request for the specified transaction.
   *
   * @param txid - The transaction ID.
   */
  cancelFetchInscriptions(txid: string): void {
    // Remove the request from the queue
    this.requestQueue = this.requestQueue.filter(request => request.txid !== txid);
  }

  /** Processes requests in the queue simultaneously without waiting for each other. */
  private processQueue(): void {

    if (this.requestQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;

    // Fetch 3 requests in parallel
    const requestsToProcess = this.requestQueue.splice(0, 3);

    merge(
      ...requestsToProcess.map(request =>
        this.fetchTransaction(request.txid).pipe(
          map(transaction => {

            const artifacts = DigitalArtifactsParserService.parse(transaction);
            this.addToCache(request.txid, artifacts);

            request.subject.next(artifacts);
            request.subject.complete();

            return of(null);
          }),
          catchError(error => {
            // add the request back to que, to try it out later
            this.requestQueue.push(request);

            return of(null);
          })
        )
      )
    ).subscribe({
      complete: () => {
        if (this.requestQueue.length > 0) {

          // Process the next requests in the queue
          // but wit a tiny delay to avaoid too many HTTP 429 Too Many Requests responses
          // window.setTimeout(() => this.processQueue(), 50);
          this.processQueue();
        } else {
          this.isProcessing = false;
        }
      }
    });
  }

  /**
   * Adds a transaction to the cache (no fetching required).
   *
   * @param txid - The transaction ID.
   * @param inscriptions - The parsed inscriptions or an empty array.
   */
  public addToCache(txid: string, inscriptions: DigitalArtifact[]): void {

    // If the cache size has reached its limit, delete the oldest entry
    if (this.fetchedInscriptions.size >= this.maxCacheSize) {
      const firstKey = this.fetchedInscriptions.keys().next().value;
      this.fetchedInscriptions.delete(firstKey);
      console.log('Cache limit reached!');
    }

    // Add the new entry to the cache
    this.fetchedInscriptions.set(txid, inscriptions);

    // Check and resolve any matching pending request
    this.resolveMatchingRequest(txid, inscriptions);
  }

  /**
   * Adds a transaction from the outside to be parsed and added to the cache.
   *
   * @param transaction - The full transaction object.
   */
  addTransaction(transaction: Transaction): void {
    const artifacts = InscriptionParserService.parseInscriptions(transaction);
    this.addToCache(transaction.txid, artifacts);
  }

  /**
   * Adds an array of transactions from the outside to be parsed and added to the cache.
   *
   * @param transactions - An array of transaction objects.
   */
  addTransactions(transactions: Transaction[]): void {

    let countBefore = 0;
    this.fetchedInscriptions.forEach((inscription) => { if (inscription !== null) { countBefore++; }});

    transactions.forEach(transaction => this.addTransaction(transaction));

    let countAfter = 0;
    this.fetchedInscriptions.forEach((inscription) => { if (inscription !== null) { countAfter++; }});
    console.log('Adding ' + transactions.length + ' entries to the cache. Found ' + (countAfter - countBefore)  + ' inscriptions!');
  }

  /**
   * Resolves a request from the queue that matches the given txid.
   *
   * @param txid - The transaction ID.
   * @param artifacts - The parsed inscription.
   */
  private resolveMatchingRequest(txid: string, artifacts: DigitalArtifact[]): void {
    const index = this.requestQueue.findIndex(request => request.txid === txid);

    if (index !== -1) {
      const request = this.requestQueue.splice(index, 1)[0];
      request.subject.next(artifacts);
      request.subject.complete();
    }
  }

  /**
   * Fetches a single transaction by ID.
   * Tries fetching from
   *
   * 1. Our list of Electrs APIs
   * 2. and as last resort the blockchainApiService if everything else fails.
   *
   * @param transaction - The transaction object containing the ID (hash).
   * @returns Observable of the transaction data.
   */
  fetchTransaction(txid: string): Observable<Transaction> {
    return this.rollingElectrsApiService.getTransaction$(txid).pipe(
      catchError(() => this.blockchainApiService.fetchSingleTransaction(txid)),
      catchError(() => throwError(() => new Error(`Failed to fetch the transaction ${txid} from all possible services.`)))
    );
  }
}
