import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { renderBitmapSvg, txSatsToSizes } from 'ordpool-parser';
import { catchError, map, Observable, of, shareReplay, switchMap } from 'rxjs';

import { ApiService } from '../api.service';
import { ElectrsApiService } from '../electrs-api.service';

@Injectable({ providedIn: 'root' })
export class BitmapApiService {

  private http = inject(HttpClient);
  private electrs = inject(ElectrsApiService);
  private api = inject(ApiService);
  private sanitizer = inject(DomSanitizer);

  // Per-session cache keyed by claimed block height. Same shape as
  // AlkanesApiService / OrdApiService.getRuneDetails.
  private cache = new Map<number, Observable<SafeHtml | null>>();

  getBitmapSvg(height: number): Observable<SafeHtml | null> {
    const cached = this.cache.get(height);
    if (cached) {
      return cached;
    }
    const obs$ = this.electrs.getBlockHashFromHeight$(height).pipe(
      switchMap(hash => this.api.getStrippedBlockTransactions$(hash)),
      map(txs => {
        const sizes = txSatsToSizes(txs.map(t => t.value));
        const svg = renderBitmapSvg(sizes);
        return this.sanitizer.bypassSecurityTrustHtml(svg);
      }),
      catchError(() => of(null)),
      shareReplay({ refCount: false, bufferSize: 1 }),
    );
    this.cache.set(height, obs$);
    return obs$;
  }
}
