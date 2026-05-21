import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { renderBitmapSvg } from 'ordpool-parser';
import { map, Observable, of } from 'rxjs';

import { BitmapApiService, BitmapResponse } from '../../../../services/ordinals/bitmap-api.service';

interface BitmapVm {
  data: BitmapResponse;
  svg: SafeHtml;
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
  private sanitizer = inject(DomSanitizer);

  private _height: number | null = null;
  vm$: Observable<BitmapVm | null> = of(null);
  view: '2d' | '3d' = '2d';

  @Input()
  public set height(h: number | null | undefined) {
    const value = (typeof h === 'number') ? h : null;
    if (this._height === value) {
      return;
    }
    this._height = value;
    this.vm$ = value === null
      ? of(null)
      : this.bitmapApi.getBitmapData(value).pipe(
          map(data => data === null ? null : ({
            data,
            svg: this.sanitizer.bypassSecurityTrustHtml(renderBitmapSvg(data.sizes)),
          })),
        );
  }

  toggleView(): void {
    this.view = this.view === '2d' ? '3d' : '2d';
  }

  formatHeight(h: number): string {
    return h.toLocaleString('en-US');
  }
}
