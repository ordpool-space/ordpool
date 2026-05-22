import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input } from '@angular/core';
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
  private cdr = inject(ChangeDetectorRef);

  private _height: number | null = null;
  vm$: Observable<BitmapVm | null> = of(null);
  // 2d  = SVG | 3d = iso/orbit | pfp = first-person walk
  mode: '2d' | '3d' | 'pfp' = '2d';
  // While true, the 3D renderer is mid-back-fly to its initial iso pose.
  // When the renderer emits exitDone we commit mode='2d' and tear it down.
  exiting = false;

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
    // 2D button:
    //   from 2D: jump to 3D (the renderer mounts and plays the intro).
    //   from 3D / PFP: ask the renderer to back-fly to its initial iso pose
    //     and then signal exitDone -- we commit mode='2d' on that event.
    //     PFP's case is identical: the renderer first flies from spawn to
    //     iso (skipping the orbit stop), then signals.
    if (this.mode === '2d') {
      this.mode = '3d';
    } else if (!this.exiting) {
      this.exiting = true;
    }
  }

  togglePfp(): void {
    // 3D <-> PFP. Renderer handles both fly-to-pfp (going in) and
    // fly-to-iso(after=orbit) (coming out) without rebuilding.
    if (this.exiting) return;
    this.mode = (this.mode === 'pfp') ? '3d' : 'pfp';
  }

  onExitDone(): void {
    // Renderer finished its back-fly; commit the mode flip + drop the
    // exit request so the next 3D entry starts clean.
    this.exiting = false;
    this.mode = '2d';
    this.cdr.markForCheck();
  }

  formatHeight(h: number): string {
    return h.toLocaleString('en-US');
  }
}
