import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, inject, Input, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { renderBitmapSvg } from 'ordpool-parser';
import { map, Observable, of, startWith } from 'rxjs';

import { BitmapApiService, BitmapResponse } from '../../../../services/ordinals/bitmap-api.service';

/**
 * The three states the viewer can be in. Kept as a discriminated union so
 * "the request is still in flight" and "this block has no data" stay
 * distinguishable in the template: they read the same to a nullable
 * view-model, and rendering both as nothing leaves no hint that anything
 * was ever going to appear.
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
  /**
   * Fullscreen is filled in by hand rather than by the browser. Safari on
   * the iPhone implements the Fullscreen API for video elements only, so
   * `requestFullscreen` is simply absent on a div there and the stage would
   * stay a 600 px square: the one case the fullscreen exists for, since a
   * phone in landscape is where the extra room matters.
   */
  pseudoFullscreen = false;
  /** Set once the renderer reports it cannot get a WebGL context. */
  webglUnsupported = false;
  /** The GPU dropped the context; the reader is back on the SVG. */
  contextLost = false;
  /** 3D is mounting: the three.js chunk and the scene build sit in here. */
  sceneLoading = false;

  onUnsupported(): void {
    this.webglUnsupported = true;
    this.sceneLoading = false;
    this.cdr.markForCheck();
  }

  onContextLost(): void {
    // The renderer emits exitDone alongside this, which is what actually
    // flips the mode; this only explains the jump back to the SVG.
    this.contextLost = true;
    this.sceneLoading = false;
    this.cdr.markForCheck();
  }

  onReady(): void {
    this.sceneLoading = false;
    this.cdr.markForCheck();
  }

  constructor() {
    const onFsChange = () => {
      // Sync our local state with the browser's actual fullscreen element.
      // User can leave fullscreen via ESC too -- this catches that path.
      // Skipped while the stage is filling the viewport by hand: the
      // browser holds no fullscreen element then, and reading one would
      // undo the flag we set ourselves.
      if (this.pseudoFullscreen) return;
      this.fullscreen = document.fullscreenElement === this.stage?.nativeElement;
      this.cdr.markForCheck();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('fullscreenchange', onFsChange);
      // A viewer torn down while it was filling the viewport would
      // otherwise leave the document unscrollable.
      this.setPseudoFullscreen(false);
    });
  }

  toggleFullscreen(): void {
    const el = this.stage?.nativeElement;
    if (!el) return;
    if (typeof el.requestFullscreen !== 'function') {
      this.setPseudoFullscreen(!this.pseudoFullscreen);
      return;
    }
    if (document.fullscreenElement === el) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.();
    }
  }

  /**
   * The hand-made fullscreen: the stage is pinned over the viewport and the
   * document behind it stops scrolling. The browser owns no part of this,
   * so Escape has to be wired up here too.
   */
  private setPseudoFullscreen(on: boolean): void {
    if (this.pseudoFullscreen === on) return;
    this.pseudoFullscreen = on;
    this.fullscreen = on;
    if (on) {
      this.bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', this.onPseudoFullscreenKey);
    } else {
      document.body.style.overflow = this.bodyOverflow;
      document.removeEventListener('keydown', this.onPseudoFullscreenKey);
    }
    this.cdr.markForCheck();
  }

  private bodyOverflow = '';
  private readonly onPseudoFullscreenKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.setPseudoFullscreen(false);
  };

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
          // A claim with no transaction sizes draws as an empty square in
          // 2D and as an empty scene in 3D, neither of which says anything.
          // It is the same nothing as a missing block, so it reads as one.
          map((data): BitmapVm => data === null || data.sizes.length === 0
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
    // The button stays focusable and hoverable while there is no WebGL (a
    // `disabled` one would swallow the hover its tooltip needs), so the
    // action is declined here instead.
    if (this.webglUnsupported) return;
    // 2D button:
    //   from 2D: jump to 3D (the renderer mounts and plays the intro).
    //   from 3D / PFP: ask the renderer to back-fly to its initial iso pose
    //     and then signal exitDone -- we commit mode='2d' on that event.
    //     PFP's case is identical: the renderer first flies from spawn to
    //     iso (skipping the orbit stop), then signals.
    if (this.mode === '2d') {
      this.mode = '3d';
      this.sceneLoading = true;
      // A fresh mount gets a fresh context, so the old failure no longer
      // describes what the reader is looking at.
      this.contextLost = false;
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
    if (enteringPfp && this.coarsePointer && !document.fullscreenElement && !this.pseudoFullscreen) {
      const el = this.stage?.nativeElement;
      if (el && typeof el.requestFullscreen === 'function') {
        el.requestFullscreen();
      } else {
        // No Fullscreen API on this element (Safari on the iPhone): pin the
        // stage over the viewport ourselves, or the walk happens in a
        // 600 px square on the device with the least room to spare.
        this.setPseudoFullscreen(true);
      }
    }
  }

  /**
   * Held as one live MediaQueryList instead of calling matchMedia on every
   * read: the template asks for this on each change-detection pass, and
   * `.matches` on an existing list is a property read.
   *
   * The query is deliberately narrow. `'ontouchstart' in window` is true on
   * any laptop with a touch screen, and widening it that way would strip the
   * tooltips from readers who do have a mouse to hover with.
   */
  private readonly coarsePointerQuery = window.matchMedia?.('(pointer: coarse)') ?? null;

  /** True on a pointer that cannot hover, so a tooltip only ever occludes. */
  get coarsePointer(): boolean {
    return this.coarsePointerQuery?.matches ?? false;
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
