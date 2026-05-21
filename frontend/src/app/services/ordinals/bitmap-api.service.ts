import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of, shareReplay } from 'rxjs';

export interface BitmapResponse {
  height: number;
  hash: string;
  sizes: number[];
}

@Injectable({ providedIn: 'root' })
export class BitmapApiService {

  private http = inject(HttpClient);

  // Per-session cache keyed by claimed block height. The backend itself
  // returns null for unconfirmed blocks (height > tip) with no-store, so
  // null answers don't get cached cross-page-load, but within a single tab
  // we want the same block to dedupe.
  private cache = new Map<number, Observable<BitmapResponse | null>>();

  getBitmapData(height: number): Observable<BitmapResponse | null> {
    const cached = this.cache.get(height);
    if (cached) {
      return cached;
    }
    const obs$ = this.http.get<BitmapResponse | null>(`/api/v1/ordpool/bitmap/${height}`).pipe(
      catchError(() => of(null)),
      shareReplay({ refCount: false, bufferSize: 1 }),
    );
    this.cache.set(height, obs$);
    return obs$;
  }
}
