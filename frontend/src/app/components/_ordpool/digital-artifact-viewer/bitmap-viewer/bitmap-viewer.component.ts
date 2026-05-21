import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { Observable, of } from 'rxjs';

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

  private _height: number | null = null;
  svg$: Observable<SafeHtml | null> = of(null);

  @Input()
  public set height(h: number | null | undefined) {
    const value = (typeof h === 'number') ? h : null;
    if (this._height === value) {
      return;
    }
    this._height = value;
    this.svg$ = value === null ? of(null) : this.bitmapApi.getBitmapSvg(value);
  }
  public get height(): number | null {
    return this._height;
  }

  formatHeight(h: number): string {
    return h.toLocaleString('en-US');
  }
}
