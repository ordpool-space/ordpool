import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, defer, map, Observable, of, retry, shareReplay, tap, timer } from 'rxjs';

import { StateService } from '../state.service';

export interface BitmapResponse {
  height: number;
  hash: string;
  sizes: number[];
}

/**
 * What the viewer can honestly say about a claim.
 *
 * `not-mined` is a fact about the chain: the claimed block does not exist
 * yet. `failed` is a fact about us: the block exists and our server could
 * not hand over its transactions. The two must never read the same,
 * because only the second one is worth retrying.
 */
export type BitmapResult =
  | { kind: 'ready'; data: BitmapResponse }
  | { kind: 'not-mined' }
  | { kind: 'failed' };

/** Our server answered, but with nothing for a block that exists. */
class EmptyAnswerError extends Error {}

@Injectable({ providedIn: 'root' })
export class BitmapApiService {

  private http = inject(HttpClient);
  private stateService = inject(StateService);

  /**
   * Retries after the first attempt, and the delay before the first of
   * them; each later retry waits twice as long as the one before. A policy
   * choice rather than a measurement: long enough to ride out a backend
   * restart or a dropped connection, short enough that a reader who is
   * going to see an error sees it within seconds.
   */
  static readonly retries = 2;
  static readonly retryBaseMs = 1_000;

  /**
   * Per-session cache keyed by claimed block height. Only answers are
   * kept: a failure is dropped from the cache, so the next viewer, or the
   * reader's own retry, asks again instead of inheriting it.
   */
  private cache = new Map<number, Observable<BitmapResult>>();

  getBitmap(height: number): Observable<BitmapResult> {
    // The chain tip settles the one case the server's answer cannot: a
    // height beyond it is a block that has not been mined, so there is
    // nothing to fetch. latestBlockHeight = -1 means the tip is not known
    // yet; then the request goes out and its answer decides.
    const tip = this.stateService.latestBlockHeight;
    if (tip >= 0 && height > tip) {
      return of<BitmapResult>({ kind: 'not-mined' });
    }
    const cached = this.cache.get(height);
    if (cached) {
      return cached;
    }
    const result$ = defer(() => this.http.get<BitmapResponse | null>(`/api/v1/ordpool/bitmap/${height}`)).pipe(
      // The server answers 200 null for a block past ITS chain tip and 503
      // when it cannot answer at all (tip unknown after a restart, RPC
      // failure); a 503 lands in retry below as an HTTP error. A null for a
      // block the tip check above already knows to be mined means the
      // server's tip is behind ours: not a fact about the block either, so
      // it is retried the same way. Every block carries at least its
      // coinbase, so an empty list is the same kind of non-answer.
      map((data) => {
        if (data === null || data.sizes.length === 0) {
          throw new EmptyAnswerError(`no transactions returned for block ${height}`);
        }
        return data;
      }),
      retry({
        count: BitmapApiService.retries,
        delay: (_error, attempt) => timer(BitmapApiService.retryBaseMs * 2 ** (attempt - 1)),
      }),
      map((data): BitmapResult => ({ kind: 'ready', data })),
      catchError((err: unknown) => {
        console.error(`bitmap data for block ${height} could not be loaded`, err);
        return of<BitmapResult>({ kind: 'failed' });
      }),
      tap((result) => {
        if (result.kind === 'failed') {
          this.cache.delete(height);
        }
      }),
      shareReplay({ refCount: false, bufferSize: 1 }),
    );
    this.cache.set(height, result$);
    return result$;
  }
}
