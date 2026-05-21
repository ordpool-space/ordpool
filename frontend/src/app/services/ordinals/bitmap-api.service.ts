import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of, shareReplay } from 'rxjs';

import { StateService } from '../state.service';

export interface BitmapResponse {
  height: number;
  hash: string;
  sizes: number[];
}

@Injectable({ providedIn: 'root' })
export class BitmapApiService {

  private http = inject(HttpClient);
  private stateService = inject(StateService);

  // Per-session cache keyed by claimed block height. The backend caps
  // unconfirmed lookups itself (returns null + no-store for height > tip),
  // but we short-circuit those before the HTTP call ever fires.
  private cache = new Map<number, Observable<BitmapResponse | null>>();

  getBitmapData(height: number): Observable<BitmapResponse | null> {
    // Skip the round-trip for unconfirmed/future blocks. The state service
    // tracks the chain tip; latestBlockHeight = -1 means we don't know yet,
    // in which case we let the request through and let the backend decide.
    const tip = this.stateService.latestBlockHeight;
    if (tip >= 0 && height > tip) {
      return of(null);
    }
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
