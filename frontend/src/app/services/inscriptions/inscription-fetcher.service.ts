import { Injectable } from '@angular/core';
import { catchError, map, Observable, of, Subject, throwError } from 'rxjs';
import { Transaction } from 'src/app/interfaces/electrs.interface';

import { ElectrsApiService } from '../electrs-api.service';
import { InscriptionParserService, ParsedInscription } from './inscription-parser.service';
import { BlockchainApiService } from './blockchain-api.service';


interface FetchRequest {
  txid: string;
  subject: Subject<ParsedInscription | null>;
  priority: boolean;
}

/**
 * A service to fetch parsed inscriptions sequentially for given transactions.
 */
@Injectable({
  providedIn: 'root',
})
export class InscriptionFetcherService {

  /** A queue to hold the fetch requests. */
  private requestQueue: FetchRequest[] = [];

  /** A flag to indicate whether the queue is currently being processed. */
  private isProcessing: boolean = false;

  /**
   * Cache for the fetched inscriptions.
   * JavaScript Map objects retain insertion order, which makes it convenient to implement a rudimentary LRU cache
   * LRU (Least Recently Used)
  */
  private fetchedInscriptions: Map<string, ParsedInscription | null> = new Map();


  /**
   * Initializes a new instance of the InscriptionFetcherService.
   * @param electrsApiService - A service to interact with the Electrs API.
   */
  constructor(
    private electrsApiService: ElectrsApiService,
    private inscriptionParserService: InscriptionParserService,
    private blockchainApiService: BlockchainApiService) { }

  /**
   * Fetches the parsed inscription for the specified transaction.
   *
   * @param txid - The transaction ID.
   * @param priority - Whether the request has a higher priority.
   * @returns An Observable that emits the parsed inscription.
   */
  fetchInscription(txid: string, priority: boolean = false): Observable<ParsedInscription | null> {

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

    const requestSubject = new Subject<ParsedInscription | null>();
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
  cancelFetchInscription(txid: string): void {
    // Remove the request from the queue
    this.requestQueue = this.requestQueue.filter(request => request.txid !== txid);
  }

  /** Processes the requests in the queue sequentially. */
  private processQueue(): void {

    if (this.requestQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const currentRequest = this.requestQueue.shift() as FetchRequest;

    this.fetchTransaction(currentRequest.txid).pipe(
      map(transaction => {
        const parsedInscription = this.inscriptionParserService.parseInscription(transaction);

        // Cache the result
        this.addToCache(currentRequest.txid, parsedInscription);

        return parsedInscription;
      })
    ).subscribe({
      next: parsedInscription => {
        // Notify the caller with the parsed inscription and complete the subject
        currentRequest.subject.next(parsedInscription);
        currentRequest.subject.complete();

        // Process the next request in the queue
        // without a delay we will get a HTTP 429 Too Many Requests response
        window.setTimeout(() => this.processQueue(), 200);
      },
      error: error => {
        // console.error('Failed to fetch inscription:', error);
        // Notify the caller with the error and continue to the next request
        // currentRequest.subject.error(error);

        // add the request back to que, to try it out later
        this.requestQueue.push(currentRequest);

        this.processQueue();  // Process the next request in the queue
      }
    });
  }

  /**
   * Adds a transaction to the cache.
   *
   * @param txid - The transaction ID.
   * @param inscription - The parsed inscription or NULL.
   */
  public addToCache(txid: string, inscription: ParsedInscription | null): void {

    // If the cache size has reached its limit, delete the oldest entry
    if (this.fetchedInscriptions.size >= 100 * 1000) {
      const firstKey = this.fetchedInscriptions.keys().next().value;
      this.fetchedInscriptions.delete(firstKey);
      // console.log('Cache limit reached!')
    }

    // Add the new entry to the cache
    this.fetchedInscriptions.set(txid, inscription);

    // Check and resolve any matching pending request
    this.resolveMatchingRequest(txid, inscription);
  }

  /**
   * Adds a transaction from the outside to be parsed and added to the cache.
   *
   * @param transaction - The full transaction object.
   */
  addTransaction(transaction: Transaction): void {
    const parsedInscription = this.inscriptionParserService.parseInscription(transaction);
    this.addToCache(transaction.txid, parsedInscription);
  }

  /**
   * Adds an array of transactions from the outside to be parsed and added to the cache.
   *
   * @param transactions - An array of transaction objects.
   */
  addTransactions(transactions: Transaction[]): void {

    // let countBefore = 0;
    // this.fetchedInscriptions.forEach((inscription) => { if (inscription !== null) { countBefore++; }});

    transactions.forEach(transaction => this.addTransaction(transaction));

    // let countAfter = 0;
    // this.fetchedInscriptions.forEach((inscription) => { if (inscription !== null) { countAfter++; }});
    // console.log('Adding ' + transactions.length + ' entries to the cache. Found ' + (countAfter - countBefore)  + ' inscriptions!');

  }

  /**
   * Resolves a request from the queue that matches the given txid.
   *
   * @param txid - The transaction ID.
   * @param parsedInscription - The parsed inscription.
   */
  private resolveMatchingRequest(txid: string, parsedInscription: ParsedInscription | null): void {
    const index = this.requestQueue.findIndex(request => request.txid === txid);

    if (index !== -1) {
      const request = this.requestQueue.splice(index, 1)[0];
      request.subject.next(parsedInscription);
      request.subject.complete();
    }
  }

  /**
   * Fetches a single transaction by ID.
   * Tries fetching from electrsApiService first, and falls back to blockchainApiService if the first one fails.
   * @param transaction - The transaction object containing the ID (hash).
   * @returns Observable of the transaction data.
   */
  fetchTransaction(txid: string): Observable<Transaction> {
    return this.electrsApiService.getTransaction$(txid).pipe(
      catchError(() => this.blockchainApiService.fetchSingleTransaction(txid)),
      catchError(() => throwError(() => new Error('Failed to fetch transaction from both services.')))
    );
  }
}

// blockchainApiService
// electrsApiService.getTransaction$
// this.blockchainApiService.fetchSingleTransaction
