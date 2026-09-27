import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, inject, Input, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { renderBitmapSvg } from 'ordpool-parser';
import { map, Observable, of, startWith, Subject, switchMap } from 'rxjs';

import { BitmapApiService, BitmapResponse, BitmapResult } from '../../../../services/ordinals/bitmap-api.service';
import { walkStartsWithTouchUi } from './bitmap-touch';

/**
 * The states the viewer can be in, as a discriminated union so each one
 * renders as itself. `not-mined` and `failed` in particular must never read
 * alike: the first is a fact about the chain, the second a failure on our
 * side that is worth retrying, and presenting ours as the chain's would tell
 * the reader something false about the block.
 */
type BitmapVm =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'not-mined'; height: number }
  | { kind: 'failed'; height: number }
  | { kind: 'ready'; data: BitmapResponse; svg: SafeHtml };

/**
 * Why the 3D view is not showing, when it tried and could not. Each one is
 * a line the reader can see, touch screens included, and none of them
 * locks the 3D button: every cause here can pass, so the next press tries
 * again.
 */
export type ThreeDNote = 'load-failed' | 'unsupported' | 'context-lost';

/**
 * Ordpool's bitcoin orange, read from the theme the same way the 3D
 * renderer reads it, so the two drawings of one bitmap are the same colour.
 * `renderBitmapSvg` otherwise falls back to bitlodo's #F7931A, which is
 * what the reference implementation ships and a slightly duller orange.
 */
const brandOrange = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#FF9900';

/** Query parameter carrying the height of the claim shown in 3D. */
const deepLinkParam = 'bitmap3d';

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
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  @ViewChild('stage') stage!: ElementRef<HTMLElement>;

  /**
   * The inscription id carrying this claim. Written into the deep link as
   * `?artifact=`, which the transaction page reads to open on that artifact:
   * a claim sitting on page five of a batch reveal would otherwise be linked
   * as page one, where a different claim is showing.
   */
  @Input() artifactId: string | null = null;

  private _height: number | null = null;
  private readonly retry$ = new Subject<void>();
  vm$: Observable<BitmapVm> = of<BitmapVm>({ kind: 'none' });
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
  /** Why the last attempt at 3D ended, until the next attempt starts. */
  threeDNote: ThreeDNote | null = null;
  /** 3D is mounting: the three.js chunk and the scene build sit in here. */
  sceneLoading = false;

  /** The three.js chunk or the scene build failed; nothing is known about WebGL. */
  onLoadFailed(): void {
    this.endThreeD('load-failed');
  }

  /** No WebGL context was handed out, whether absent, blocked or exhausted. */
  onUnsupported(): void {
    this.endThreeD('unsupported');
  }

  /** The GPU took the context away mid-session. */
  onContextLost(): void {
    this.endThreeD('context-lost');
  }

  /**
   * The renderer emits exitDone alongside each of these, which is what
   * flips the mode back to 2D; this records why. Fullscreen is left too:
   * the note sits under the stage, and a stage still covering the viewport
   * would hide the one line explaining why the scene just vanished.
   */
  private endThreeD(note: ThreeDNote): void {
    this.threeDNote = note;
    this.sceneLoading = false;
    this.leaveFullscreen();
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
      // Torn down inside the page (the artifact pager moved on) while
      // showing 3D: take the claim out of the address bar, or the URL keeps
      // naming a view that is no longer on screen. Not while the router is
      // navigating: then the page itself is going, and a navigation of our
      // own would fight the one in flight.
      if (this.mode !== '2d' && !this.router.getCurrentNavigation()) {
        this.writeDeepLink(false);
      }
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

  /** Leave fullscreen, whichever kind the stage is in. */
  private leaveFullscreen(): void {
    this.setPseudoFullscreen(false);
    if (this.stage && document.fullscreenElement === this.stage.nativeElement) {
      document.exitFullscreen?.();
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
    // A link that carries this claim's height opens on the 3D view. Keyed
    // by height rather than a bare flag because a transaction can hold
    // several bitmaps, and a flag would apply to all of them at once. Only
    // the iso view is reachable this way: the walk takes over the pointer
    // and the screen, which is not something a link should do to a reader
    // who has not asked for it yet.
    if (value !== null && this.route.snapshot?.queryParamMap?.get(deepLinkParam) === String(value)) {
      this.mode = '3d';
      this.sceneLoading = true;
    }
    this.vm$ = value === null
      ? of<BitmapVm>({ kind: 'none' })
      : this.retry$.pipe(
          startWith(undefined),
          switchMap(() => this.bitmapApi.getBitmap(value).pipe(
            map((result) => this.toVm(value, result)),
            startWith<BitmapVm>({ kind: 'loading' }),
          )),
        );
  }

  private toVm(height: number, result: BitmapResult): BitmapVm {
    switch (result.kind) {
      case 'not-mined':
        return { kind: 'not-mined', height };
      case 'failed':
        return { kind: 'failed', height };
      case 'ready':
        return {
          kind: 'ready',
          data: result.data,
          svg: this.sanitizer.bypassSecurityTrustHtml(
            renderBitmapSvg(result.data.sizes, { color: brandOrange() }),
          ),
        };
    }
  }

  /** Ask again after our server could not answer. */
  retry(): void {
    this.retry$.next();
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
      this.sceneLoading = true;
      // A fresh mount is a fresh attempt, so the old reason no longer
      // describes what the reader is looking at.
      this.threeDNote = null;
      this.writeDeepLink(true);
    } else if (!this.exiting) {
      this.exiting = true;
    }
  }

  /**
   * Put the 3D view in the address bar, so the link a reader copies opens
   * what they are looking at.
   *
   * Through the router, with replaceUrl, so the router's own record of the
   * URL stays the address bar's: pages that navigate with merged query
   * params (the transaction page does, for its details and flow toggles)
   * then carry this along or drop it correctly, and a viewer mounted later
   * reads the current value rather than the one the page loaded with.
   * Query-param changes re-run no resolvers, and replaceUrl adds no history
   * entry per toggle. The fragment is the transaction page's too (#vin,
   * #vout, #accelerate) and survives.
   */
  private writeDeepLink(on: boolean): void {
    if (this._height === null) return;
    const queryParams: Record<string, string | number | null> = {
      [deepLinkParam]: on ? this._height : null,
    };
    // `artifact` stays behind when 3D closes: it names the artifact the
    // reader is still looking at, only the 3D half of the link is over.
    if (on && this.artifactId) {
      queryParams['artifact'] = this.artifactId;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  togglePfp(): void {
    // 3D <-> PFP. Renderer handles both fly-to-pfp (going in) and
    // fly-to-iso(after=orbit) (coming out) without rebuilding.
    if (this.exiting) return;
    const enteringPfp = this.mode !== 'pfp';
    this.mode = enteringPfp ? 'pfp' : '3d';
    // A walk that opens with joysticks goes fullscreen on entry. Without
    // this the canvas stays at its aspect-ratio 1/1, max-width 600 px size:
    // rotating the phone gives more viewport but the canvas doesn't grow.
    // Fullscreen tracks the actual viewport, so orientation changes work
    // automatically. The browser requires this be called within a user-
    // gesture handler -- the click on the PFP toggle qualifies.
    if (enteringPfp && walkStartsWithTouchUi() && !document.fullscreenElement && !this.pseudoFullscreen) {
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
    this.sceneLoading = false;
    this.writeDeepLink(false);
    this.cdr.markForCheck();
  }

  formatHeight(h: number): string {
    return h.toLocaleString('en-US');
  }
}
