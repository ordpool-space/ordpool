import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of, shareReplay } from 'rxjs';

export interface AlkaneMetadata {
  alkaneId: string;
  block: string;
  tx: string;
  name: string | null;
  symbol: string | null;
  totalSupply: string | null;
  fetchedAt: string;
  lastError: string | null;
}

@Injectable({ providedIn: 'root' })
export class AlkanesApiService {

  private http = inject(HttpClient);

  // Same shape as OrdApiService.getRuneDetails: Map<id, Observable> +
  // shareReplay. refCount stays false so the cache survives unsubscribes.
  private cache = new Map<string, Observable<AlkaneMetadata | null>>();

  getAlkaneDetails(block: bigint, tx: bigint): Observable<AlkaneMetadata | null> {
    const id = `${block}:${tx}`;
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }
    const obs$ = this.http.get<AlkaneMetadata>(`/api/v1/ordpool/alkanes/${block}/${tx}`).pipe(
      catchError(() => of(null)),
      shareReplay({ refCount: false, bufferSize: 1 }),
    );
    this.cache.set(id, obs$);
    return obs$;
  }
}
