import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, inject, Input, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { renderBitmapSvg } from 'ordpool-parser';
import { map, Observable, of, startWith } from 'rxjs';

import { BitmapApiService, BitmapResponse } from '../../../../services/ordinals/bitmap-api.service';

/**
 * The three states the viewer can be in. Previously the template tested a
 * nullable view-model, which made "the request is still in flight" and
 * "this block has no data" render identically -- as nothing at all, with
 * no hint that anything was ever going to appear.
 */
type BitmapVm =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; data: BitmapResponse; svg: SafeHtml };

/**
 * Ordpool's bitcoin orange, read from the theme the same way the 3D
 * renderer reads it, so the two drawings of one bitmap are the same colour.
 * `renderBitmapSvg` otherwise falls back to bitlodo's #F7931A, which is
 * what the reference implementation ships and a slightly duller orange.
 */
const brandOrange = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#FF9900';

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
  private destroyRef = inject(DestroyRef);

  @ViewChild('stage') stage!: ElementRef<HTMLElement>;

  private _height: number | null = null;
  vm$: Observable<BitmapVm> = of<BitmapVm>({ kind: 'unavailable' });
  // 2d  = SVG | 3d = iso/orbit | pfp = first-person walk
  mode: '2d' | '3d' | 'pfp' = '2d';
  // While true, the 3D renderer is mid-back-fly to its initial iso pose.
  // When the renderer emits exitDone we commit mode='2d' and tear it down.
  exiting = false;
  fullscreen = false;
  /** Set once the renderer reports it cannot get a WebGL context. */
  webglUnsupported = false;

  onUnsupported(): void {
    this.webglUnsupported = true;
    this.cdr.markForCheck();
  }

  constructor() {
    const onFsChange = () => {
      // Sync our local state with the browser's actual fullscreen element.
      // User can leave fullscreen via ESC too -- this catches that path.
      this.fullscreen = document.fullscreenElement === this.stage?.nativeElement;
      this.cdr.markForCheck();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('fullscreenchange', onFsChange);
    });
  }

  toggleFullscreen(): void {
    const el = this.stage?.nativeElement;
    if (!el) return;
    if (document.fullscreenElement === el) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.();
    }
  }

  @Input()
  public set height(h: number | null | undefined) {
    const value = (typeof h === 'number') ? h : null;
    if (this._height === value) {
      return;
    }
    this._height = value;
    this.vm$ = value === null
      ? of<BitmapVm>({ kind: 'unavailable' })
      : this.bitmapApi.getBitmapData(value).pipe(
          map((data): BitmapVm => data === null
            ? { kind: 'unavailable' }
            : {
                kind: 'ready',
                data,
                svg: this.sanitizer.bypassSecurityTrustHtml(
                  renderBitmapSvg(data.sizes, { color: brandOrange() }),
                ),
              }),
          startWith<BitmapVm>({ kind: 'loading' }),
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
    const enteringPfp = this.mode !== 'pfp';
    this.mode = enteringPfp ? 'pfp' : '3d';
    // Mobile: auto-fullscreen on PFP entry. Without this, the canvas
    // stays at its aspect-ratio:1/1 max-width:600px size -- rotating the
    // phone gives more viewport real estate but the canvas doesn't grow.
    // Fullscreen tracks the actual viewport, so orientation changes work
    // automatically. The browser requires this be called within a user-
    // gesture handler -- the click on the PFP toggle qualifies.
    if (enteringPfp && this.isCoarsePointer() && !document.fullscreenElement) {
      this.stage?.nativeElement.requestFullscreen?.();
    }
  }

  isCoarsePointer(): boolean {
    return window.matchMedia?.('(pointer: coarse)').matches
      || ('ontouchstart' in window);
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
