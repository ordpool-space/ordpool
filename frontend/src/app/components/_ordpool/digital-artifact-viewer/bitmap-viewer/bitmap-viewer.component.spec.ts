import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { Observable, Subject, firstValueFrom, of, toArray } from 'rxjs';

import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { BitmapApiService, BitmapResponse } from '@app/services/ordinals/bitmap-api.service';
import { BitmapViewerComponent } from './bitmap-viewer.component';

/** The URL the viewer last wrote, as the address bar would show it. */
let writtenUrl: string | null = null;
/** Query params the viewer is mounted under. */
let queryParams: Record<string, string> = {};

/**
 * Router, route and Location as the viewer uses them: it reads one query
 * param on mount and writes the URL back through Location. The stub
 * serialises what it is handed so the assertions read a URL string rather
 * than a UrlTree's internals.
 */
const routerStubs = () => {
  writtenUrl = null;
  return [
    {
      provide: Router,
      useValue: {
        createUrlTree: (_: unknown[], extras: { queryParams: Record<string, unknown> }) => extras,
        serializeUrl: (tree: { queryParams: Record<string, unknown> }) => {
          const merged = { ...queryParams, ...tree.queryParams };
          const pairs = Object.entries(merged).filter(([, v]) => v !== null && v !== undefined);
          return '/block/abc' + (pairs.length ? '?' + pairs.map(([k, v]) => `${k}=${v}`).join('&') : '');
        },
      },
    },
    { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: (k: string) => queryParams[k] ?? null } } } },
    { provide: Location, useValue: { replaceState: (url: string) => { writtenUrl = url; } } },
  ];
};

/**
 * The viewer's three view states. They exist so "still fetching" and "no
 * data for this block" stay distinguishable: a nullable view-model renders
 * both as an empty column, with no indication either way.
 */
describe('BitmapViewerComponent view states', () => {

  const setup = (response: Observable<BitmapResponse | null>) => {
    const getBitmapData = jest.fn().mockReturnValue(response);
    TestBed.configureTestingModule({
      declarations: [BitmapViewerComponent],
      providers: [
        { provide: BitmapApiService, useValue: { getBitmapData } },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: (h: string) => h } },
        ...routerStubs(),
      ],
    });
    const component = TestBed.createComponent(BitmapViewerComponent).componentInstance;
    return { component, getBitmapData };
  };

  const blockResponse: BitmapResponse = { height: 800_000, hash: 'abc', sizes: [1, 2, 3] };

  it('reports loading first, then the rendered bitmap', async () => {
    const { component } = setup(of(blockResponse));
    component.height = 800_000;

    const emissions = await firstValueFrom(component.vm$.pipe(toArray()));

    expect(emissions[0]).toEqual({ kind: 'loading' });
    expect(emissions[1]).toMatchObject({ kind: 'ready', data: blockResponse });
  });

  it('fills the squares with the theme accent, not the parser default', async () => {
    // A sentinel rather than #FF9900: that is also brandOrange()'s own
    // fallback, so asserting it would pass even if the theme were never
    // read at all.
    document.documentElement.style.setProperty('--primary', '#0000FF');
    try {
      const { component } = setup(of(blockResponse));
      component.height = 800_000;

      const vm = await firstValueFrom(component.vm$.pipe(toArray()));
      // The stubbed sanitizer hands the markup straight back, so the view
      // model's SafeHtml is the SVG string here.
      const ready = vm[vm.length - 1] as unknown as { kind: 'ready'; svg: string };

      expect(ready.svg).toContain('#0000FF');
      // bitlodo's reference orange, the parser's fallback when no colour
      // is passed.
      expect(ready.svg).not.toContain('#F7931A');
    } finally {
      document.documentElement.style.removeProperty('--primary');
    }
  });

  it('falls back to ordpool orange when the theme defines no accent', async () => {
    document.documentElement.style.removeProperty('--primary');
    const { component } = setup(of(blockResponse));
    component.height = 800_000;

    const vm = await firstValueFrom(component.vm$.pipe(toArray()));
    const ready = vm[vm.length - 1] as unknown as { kind: 'ready'; svg: string };

    expect(ready.svg).toContain('#FF9900');
  });

  it('stays in loading while the request is in flight', async () => {
    const pending = new Subject<BitmapResponse | null>();
    const { component } = setup(pending);
    component.height = 800_000;

    // Nothing has been delivered yet, so the only state so far is loading.
    expect(await firstValueFrom(component.vm$)).toEqual({ kind: 'loading' });
  });

  it('reports unavailable when the block has no data', async () => {
    const { component } = setup(of(null));
    component.height = 800_000;

    const emissions = await firstValueFrom(component.vm$.pipe(toArray()));

    expect(emissions[emissions.length - 1]).toEqual({ kind: 'unavailable' });
  });

  it('goes back to unavailable, without a new request, when the height is cleared', async () => {
    const { component, getBitmapData } = setup(of(blockResponse));
    // Reaching the null branch takes a real height first: the setter's
    // identity guard returns on null-to-null, so assigning null to a fresh
    // component asserts the field initializer and nothing else.
    component.height = 800_000;
    expect(getBitmapData).toHaveBeenCalledTimes(1);

    component.height = null;

    expect(await firstValueFrom(component.vm$)).toEqual({ kind: 'unavailable' });
    expect(getBitmapData).toHaveBeenCalledTimes(1);
  });

  it('does not re-request when the same height is set again', () => {
    const { component, getBitmapData } = setup(of(blockResponse));
    component.height = 800_000;
    component.height = 800_000;

    expect(getBitmapData).toHaveBeenCalledTimes(1);
    expect(getBitmapData).toHaveBeenCalledWith(800_000);
  });

  it('reports unavailable for a claim that carries no transaction sizes', async () => {
    const { component } = setup(of({ height: 800_000, hash: 'abc', sizes: [] }));
    component.height = 800_000;

    const emissions = await firstValueFrom(component.vm$.pipe(toArray()));

    expect(emissions[emissions.length - 1]).toEqual({ kind: 'unavailable' });
  });

  it('draws a single-transaction block like any other', async () => {
    // The early blocks are one coinbase and nothing else, and they are the
    // claims most likely to be looked at for their age.
    const oneTx: BitmapResponse = { height: 100, hash: 'abc', sizes: [1] };
    const { component } = setup(of(oneTx));
    component.height = 100;

    const emissions = await firstValueFrom(component.vm$.pipe(toArray()));
    const ready = emissions[emissions.length - 1] as unknown as { kind: string; svg: string };

    expect(ready.kind).toBe('ready');
    expect(ready.svg).toContain('<svg');
    expect(ready.svg).toContain('#FF9900');
  });
});

/**
 * The states the reader is left in when the 3D side fails or is slow, and
 * the hand-made fullscreen for browsers whose Fullscreen API does not cover
 * a plain element.
 */
describe('BitmapViewerComponent 3D fallbacks', () => {

  const setup = () => {
    TestBed.configureTestingModule({
      declarations: [BitmapViewerComponent],
      // The template mounts the renderer, the toolbar tooltips and the
      // skeleton; none of them are under test here.
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: BitmapApiService, useValue: { getBitmapData: () => of(blockResponse) } },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: (h: string) => h } },
        ...routerStubs(),
      ],
    });
    const fixture = TestBed.createComponent(BitmapViewerComponent);
    fixture.componentInstance.height = 800_000;
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  };

  const blockResponse: BitmapResponse = { height: 800_000, hash: 'abc', sizes: [1, 2, 3] };

  // The hand-made fullscreen writes on the document body, so a test that
  // fails half way through would otherwise hand the next one a dirty page
  // and a second, misleading failure.
  afterEach(() => { document.body.style.overflow = ''; });

  it('covers the stage until the renderer has drawn its first frame', () => {
    const { component } = setup();

    component.toggleView();
    expect(component.sceneLoading).toBe(true);

    component.onReady();
    expect(component.sceneLoading).toBe(false);
  });

  it('uncovers the stage when the renderer reports it has no WebGL', () => {
    const { component } = setup();
    component.toggleView();

    component.onUnsupported();

    // Without this the placeholder outlives the thing it was covering.
    expect(component.sceneLoading).toBe(false);
    expect(component.webglUnsupported).toBe(true);
  });

  it('explains a lost context, and drops the explanation on the next attempt', () => {
    const { component } = setup();
    component.toggleView();

    component.onContextLost();
    expect(component.contextLost).toBe(true);
    expect(component.sceneLoading).toBe(false);

    // The renderer emits exitDone alongside, which is what returns to 2D.
    component.onExitDone();
    component.toggleView();

    expect(component.contextLost).toBe(false);
  });

  it('fills the viewport by hand when the element has no Fullscreen API', () => {
    const { component, fixture } = setup();
    const stage = component.stage.nativeElement;
    // Safari on the iPhone: the method is absent on a div entirely.
    (stage as unknown as { requestFullscreen?: unknown }).requestFullscreen = undefined;
    document.body.style.overflow = 'scroll';

    component.toggleFullscreen();

    expect(component.pseudoFullscreen).toBe(true);
    expect(component.fullscreen).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.bitmap-stage.is-pseudo-fullscreen')).toBeTruthy();

    // The browser owns no part of this, so Escape is ours to handle.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(component.pseudoFullscreen).toBe(false);
    expect(component.fullscreen).toBe(false);
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('puts the 3D view in the address bar, and takes it back out', () => {
    const { component } = setup();

    component.toggleView();
    expect(writtenUrl).toBe('/block/abc?bitmap3d=800000');

    component.onExitDone();
    expect(writtenUrl).toBe('/block/abc');
  });

  it('keeps the query params it found alongside its own', () => {
    queryParams = { tab: 'artifacts' };
    try {
      const { component } = setup();
      component.toggleView();

      expect(writtenUrl).toBe('/block/abc?tab=artifacts&bitmap3d=800000');
    } finally {
      queryParams = {};
    }
  });

  it('opens on 3D when the link names this claim', () => {
    queryParams = { bitmap3d: '800000' };
    try {
      const { component } = setup();

      expect(component.mode).toBe('3d');
      expect(component.sceneLoading).toBe(true);
    } finally {
      queryParams = {};
    }
  });

  it('stays flat when the link names a different claim', () => {
    // A transaction can hold more than one bitmap, so the height in the
    // link has to pick out the one it belongs to.
    queryParams = { bitmap3d: '999999' };
    try {
      expect(setup().component.mode).toBe('2d');
    } finally {
      queryParams = {};
    }
  });

  it('leaves the real Fullscreen API alone where it exists', () => {
    const { component } = setup();
    const stage = component.stage.nativeElement;
    const requestFullscreen = jest.fn();
    (stage as unknown as { requestFullscreen: unknown }).requestFullscreen = requestFullscreen;

    component.toggleFullscreen();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(component.pseudoFullscreen).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });
});
