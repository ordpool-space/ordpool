import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { renderBitmapSvg } from 'ordpool-parser';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';

export interface BitmapResponse {
  height: number;
  hash: string;
  sizes: number[];
}

@Injectable({ providedIn: 'root' })
export class BitmapApiService {

  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);

  // Per-session cache keyed by claimed block height. Same shape as
  // AlkanesApiService / OrdApiService.getRuneDetails.
  private cache = new Map<number, Observable<SafeHtml | null>>();

  getBitmapSvg(height: number): Observable<SafeHtml | null> {
    const cached = this.cache.get(height);
    if (cached) {
      return cached;
    }
    const obs$ = this.http.get<BitmapResponse | null>(`/api/v1/ordpool/bitmap/${height}`).pipe(
      map(resp => {
        if (!resp) return null;
        return this.sanitizer.bypassSecurityTrustHtml(renderBitmapSvg(resp.sizes));
      }),
      catchError(() => of(null)),
      shareReplay({ refCount: false, bufferSize: 1 }),
    );
    this.cache.set(height, obs$);
    return obs$;
  }
}
