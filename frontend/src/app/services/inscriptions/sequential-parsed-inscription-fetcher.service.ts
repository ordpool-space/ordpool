import { Injectable } from '@angular/core';
import { Observable, Subject, map, retry } from 'rxjs';
import { ElectrsApiService } from '../electrs-api.service';
import { InscriptionParserService, ParsedInscription } from './inscription-parser.service';


interface FetchRequest {
  txid: string;
  subject: Subject<ParsedInscription | null>;
}

/**
 * A service to fetch parsed inscriptions sequentially for given transactions.
 *
 * @example
 * const fetcherService = new SequentialParsedInscriptionFetcherService(electrsApiService);
 * const parsedInscription$ = fetcherService.fetchInscription('transaction-id');
 * parsedInscription$.subscribe(parsedInscription => console.log(parsedInscription));
 */
@Injectable({
  providedIn: 'root',
})
export class SequentialParsedInscriptionFetcherService {

  /** A queue to hold the fetch requests. */
  private requestQueue: FetchRequest[] = [];

  /** A flag to indicate whether the queue is currently being processed. */
  private isProcessing: boolean = false;

  /**
   * Initializes a new instance of the SequentialParsedInscriptionFetcherService.
   * @param electrsApiService - A service to interact with the Electrs API.
   */
  constructor(private electrsApiService: ElectrsApiService, private inscriptionParserService: InscriptionParserService) { }

  /**
   * Fetches the parsed inscription for the specified transaction.
   *
   * @param txid - The transaction ID.
   * @returns An Observable that emits the parsed inscription.
   */
  fetchInscription(txid: string): Observable<ParsedInscription | null> {
    const requestSubject = new Subject<ParsedInscription | null>();
    const request: FetchRequest = { txid, subject: requestSubject };
    this.requestQueue.push(request);

    // If not currently processing requests, start processing the queue
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

    this.electrsApiService.getTransaction$(currentRequest.txid).pipe(
      retry({ count: 2, delay: 1000 }),
      map(transaction => {
        const witness = transaction.vin[0]?.witness;
        if (witness) {
          return this.inscriptionParserService.parseInscription(witness);
        }
        return null;
      })
    ).subscribe({
      next: parsedInscription => {
        // Notify the caller with the parsed inscription and complete the subject
        currentRequest.subject.next(parsedInscription);
        currentRequest.subject.complete();

        // Process the next request in the queue
        // without a delay we will get a HTTP 429 Too Many Requests response
        window.setTimeout(() => this.processQueue(), 75);
      },
      error: error => {
        // console.error('Failed to fetch inscription:', error);
        // Notify the caller with the error and continue to the next request
        currentRequest.subject.error(error);
        this.processQueue();  // Process the next request in the queue
      }
    });
  }
}
