import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { parseBitmapHeight, ParsedInscription } from 'ordpool-parser';
import { from, Observable, of, switchMap } from 'rxjs';

import { BitmapApiService } from '../../../../services/ordinals/bitmap-api.service';

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
  height: number | null = null;
  svg$: Observable<SafeHtml | null> = of(null);

  @Input()
  public set parsedInscription(inscription: ParsedInscription | undefined) {
    if (this._inscription?.uniqueId === inscription?.uniqueId) {
      return;
    }
    this._inscription = inscription;
    this.height = null;
    this.svg$ = of(null);

    if (!inscription) {
      return;
    }

    this.svg$ = from(inscription.getContent()).pipe(
      switchMap(content => {
        const h = parseBitmapHeight(content ?? '');
        if (h === null) {
          return of(null);
        }
        this.height = h;
        return this.bitmapApi.getBitmapSvg(h);
      }),
    );
  }

  formatHeight(h: number): string {
    return h.toLocaleString('en-US');
  }
}
