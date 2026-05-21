import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { parseBitmapHeight, ParsedInscription } from 'ordpool-parser';
import { catchError, from, map, Observable, of, shareReplay, switchMap } from 'rxjs';

import { BitmapApiService } from '../../../../services/ordinals/bitmap-api.service';

interface BitmapVm {
  height: number;
  svg: SafeHtml | null;
}

@Component({
  selector: 'app-bitmap-viewer',
  templateUrl: './bitmap-viewer.component.html',
  styleUrls: ['./bitmap-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class BitmapViewerComponent {

  private bitmapApi = inject(BitmapApiService);

  private _inscription: ParsedInscription | undefined;
  vm$: Observable<BitmapVm | null> = of(null);

  @Input()
  public set parsedInscription(inscription: ParsedInscription | undefined) {
    if (this._inscription?.uniqueId === inscription?.uniqueId) {
      return;
    }
    this._inscription = inscription;

    if (!inscription) {
      this.vm$ = of(null);
      return;
    }

    this.vm$ = from(inscription.getContent()).pipe(
      switchMap(content => {
        const height = parseBitmapHeight(content ?? '');
        if (height === null) {
          return of(null);
        }
        return this.bitmapApi.getBitmapSvg(height).pipe(
          map(svg => ({ height, svg })),
        );
      }),
      catchError(() => of(null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }

  formatHeight(h: number): string {
    return h.toLocaleString('en-US');
  }
}
