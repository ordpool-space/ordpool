import { Location } from '@angular/common';
import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, Subject, firstValueFrom, of, take, toArray } from 'rxjs';

import { BitmapApiService, BitmapResponse, BitmapResult } from '@app/services/ordinals/bitmap-api.service';
import { BitmapViewerComponent } from './bitmap-viewer.component';

const blockResponse: BitmapResponse = { height: 800_000, hash: 'abc', sizes: [1, 2, 3] };
const ready = (data: BitmapResponse = blockResponse): BitmapResult => ({ kind: 'ready', data });

/**
 * The loading state and the answer after it. The view model never
 * completes (it waits on the reader's retries), so a test reads a fixed
 * number of emissions instead of waiting for the end.
 */
const firstTwo = <T>(vm$: Observable<T>) => vm$.pipe(take(2), toArray());

/**
 * The viewer's states. Each one renders as itself: "still fetching", "the
 * block has not been mined" and "our server could not answer" must stay
 * distinguishable, because only the last is worth retrying and presenting
 * it as either of the others would tell the reader something false.
 */
describe('BitmapViewerComponent view states', () => {

  const setup = (...responses: Observable<BitmapResult>[]) => {
    const getBitmap = jest.fn();
    responses.forEach((r) => getBitmap.mockReturnValueOnce(r));
    TestBed.configureTestingModule({
      declarations: [BitmapViewerComponent],
      providers: [
        { provide: BitmapApiService, useValue: { getBitmap } },
        // Hands the markup straight back, so a view model's SafeHtml is the
        // SVG string these tests read. Nothing here renders the template.
        { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: (h: string) => h } },
        provideRouter([]),
        provideLocationMocks(),
      ],
    });
    const component = TestBed.createComponent(BitmapViewerComponent).componentInstance;
    return { component, getBitmap };
  };

  it('reports loading first, then the rendered bitmap', async () => {
    const { component } = setup(of(ready()));
    component.height = 800_000;

    const emissions = await firstValueFrom(firstTwo(component.vm$));

    expect(emissions[0]).toEqual({ kind: 'loading' });
    expect(emissions[1]).toMatchObject({ kind: 'ready', data: blockResponse });
  });

  it('fills the squares with the theme accent, not the parser default', async () => {
    // A sentinel rather than #FF9900: that is also brandOrange()'s own
    // fallback, so asserting it would pass even if the theme were never
    // read at all.
    document.documentElement.style.setProperty('--primary', '#0000FF');
    try {
      const { component } = setup(of(ready()));
      component.height = 800_000;

      const vm = await firstValueFrom(firstTwo(component.vm$));
      const last = vm[vm.length - 1] as unknown as { kind: 'ready'; svg: string };

      expect(last.svg).toContain('#0000FF');
      // bitlodo's reference orange, the parser's fallback when no colour
      // is passed.
      expect(last.svg).not.toContain('#F7931A');
    } finally {
      document.documentElement.style.removeProperty('--primary');
    }
  });

  it('falls back to ordpool orange when the theme defines no accent', async () => {
    document.documentElement.style.removeProperty('--primary');
    const { component } = setup(of(ready()));
    component.height = 800_000;

    const vm = await firstValueFrom(firstTwo(component.vm$));
    const last = vm[vm.length - 1] as unknown as { kind: 'ready'; svg: string };

    expect(last.svg).toContain('#FF9900');
  });

  it('stays in loading while the request is in flight', async () => {
    const { component } = setup(new Subject<BitmapResult>());
    component.height = 800_000;

    // Nothing has been delivered yet, so the only state so far is loading.
    expect(await firstValueFrom(component.vm$)).toEqual({ kind: 'loading' });
  });

  it('says a block has not been mined as a fact about the chain', async () => {
    const { component } = setup(of<BitmapResult>({ kind: 'not-mined' }));
    component.height = 999_999;

    const emissions = await firstValueFrom(firstTwo(component.vm$));

    expect(emissions[emissions.length - 1]).toEqual({ kind: 'not-mined', height: 999_999 });
  });

  it('says a failure on our side as one, not as missing data', async () => {
    const { component } = setup(of<BitmapResult>({ kind: 'failed' }));
    component.height = 800_000;

    const emissions = await firstValueFrom(firstTwo(component.vm$));

    expect(emissions[emissions.length - 1]).toEqual({ kind: 'failed', height: 800_000 });
  });

  it('asks again when the reader retries, and shows the answer that comes back', async () => {
    const { component, getBitmap } = setup(of<BitmapResult>({ kind: 'failed' }), of(ready()));
    component.height = 800_000;
    const seen: string[] = [];
    const sub = component.vm$.subscribe((vm) => seen.push(vm.kind));

    component.retry();
    sub.unsubscribe();

    expect(getBitmap).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['loading', 'failed', 'loading', 'ready']);
  });

  it('shows nothing, without a request, once the height is cleared', async () => {
    const { component, getBitmap } = setup(of(ready()));
    // Reaching the null branch takes a real height first: the setter's
    // identity guard returns on null-to-null, so assigning null to a fresh
    // component asserts the field initializer and nothing else.
    component.height = 800_000;
    await firstValueFrom(firstTwo(component.vm$));
    expect(getBitmap).toHaveBeenCalledTimes(1);

    component.height = null;

    expect(await firstValueFrom(component.vm$)).toEqual({ kind: 'none' });
    expect(getBitmap).toHaveBeenCalledTimes(1);
  });

  it('does not re-request when the same height is set again', () => {
    const { component, getBitmap } = setup(of(ready()), of(ready()));
    component.height = 800_000;
    component.height = 800_000;
    component.vm$.subscribe().unsubscribe();

    expect(getBitmap).toHaveBeenCalledTimes(1);
    expect(getBitmap).toHaveBeenCalledWith(800_000);
  });

  it('draws a single-transaction block like any other', async () => {
    // The early blocks are one coinbase and nothing else, and they are the
    // claims most likely to be looked at for their age.
    const { component } = setup(of(ready({ height: 100, hash: 'abc', sizes: [1] })));
    component.height = 100;

    const emissions = await firstValueFrom(firstTwo(component.vm$));
    const last = emissions[emissions.length - 1] as unknown as { kind: string; svg: string };

    expect(last.kind).toBe('ready');
    expect(last.svg).toContain('<svg');
    expect(last.svg).toContain('#FF9900');
  });
});

/**
 * What the reader is left with when the 3D side fails or is slow, and the
 * hand-made fullscreen for browsers whose Fullscreen API does not cover a
 * plain element.
 */
describe('BitmapViewerComponent 3D fallbacks', () => {

  const setup = () => {
    TestBed.configureTestingModule({
      declarations: [BitmapViewerComponent],
      // The template mounts the renderer, the toolbar tooltips and the
      // skeleton; none of them are under test here.
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: BitmapApiService, useValue: { getBitmap: () => of(ready()) } },
        provideRouter([]),
        provideLocationMocks(),
      ],
    });
    const fixture = TestBed.createComponent(BitmapViewerComponent);
    fixture.componentInstance.height = 800_000;
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  };

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

  it.each([
    ['onLoadFailed', 'load-failed'],
    ['onUnsupported', 'unsupported'],
    ['onContextLost', 'context-lost'],
  ] as const)('%s uncovers the stage and names the reason (%s)', (handler, note) => {
    const { component } = setup();
    component.toggleView();

    component[handler]();

    // Without the first, the placeholder outlives the thing it was covering.
    expect(component.sceneLoading).toBe(false);
    expect(component.threeDNote).toBe(note);
  });

  it('names the reason on screen, where a touch screen sees it too', () => {
    const { component, fixture } = setup();
    component.toggleView();
    component.onUnsupported();
    component.onExitDone();
    fixture.detectChanges();

    const note: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="bitmap-3d-note"]');
    expect(note?.textContent).toContain('WebGL');
  });

  it('never locks the 3D button: the next press is a fresh attempt', () => {
    const { component } = setup();
    component.toggleView();
    component.onUnsupported();
    component.onExitDone();

    component.toggleView();

    // Every cause of a failed attempt can pass (a blocked context, memory
    // pressure, a chunk that did not load), so pressing again must try.
    expect(component.mode).toBe('3d');
    expect(component.threeDNote).toBeNull();
  });

  it('leaves the hand-made fullscreen when 3D fails, so the reason is visible', () => {
    const { component } = setup();
    const stage = component.stage.nativeElement;
    (stage as unknown as { requestFullscreen?: unknown }).requestFullscreen = undefined;
    component.toggleView();
    component.toggleFullscreen();
    expect(component.pseudoFullscreen).toBe(true);

    component.onContextLost();

    expect(component.pseudoFullscreen).toBe(false);
    expect(component.fullscreen).toBe(false);
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

/**
 * The 3D deep link, against the real router and a real (mock) Location, so
 * what is asserted is the URL the address bar would show. The transaction
 * page is the host that matters: it carries its own query params and
 * fragment, and navigates with merged params itself.
 */
describe('BitmapViewerComponent deep link', () => {

  @Component({
    template: `<app-bitmap-viewer [height]="800000" [artifactId]="'abci5'"/>`,
    standalone: false,
  })
  class HostComponent {}

  const open = async (url: string) => {
    TestBed.configureTestingModule({
      declarations: [BitmapViewerComponent, HostComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: BitmapApiService, useValue: { getBitmap: () => of(ready()) } },
        provideRouter([{ path: 'tx/:id', component: HostComponent }]),
        provideLocationMocks(),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const viewerEl = harness.routeNativeElement?.querySelector('app-bitmap-viewer');
    const component = harness.fixture.debugElement.query((d) => d.nativeElement === viewerEl)
      ?.componentInstance as BitmapViewerComponent;
    return { harness, component, location: TestBed.inject(Location) };
  };

  it('puts the 3D view in the address bar, keeps the page\'s own params and fragment, and takes it out again', async () => {
    const { harness, component, location } = await open('/tx/abc?showDetails=true#vin=0');

    component.toggleView();
    await harness.fixture.whenStable();
    const path = location.path(true);
    expect(path).toContain('showDetails=true');
    expect(path).toContain('bitmap3d=800000');
    expect(path).toContain('#vin=0');

    component.onExitDone();
    await harness.fixture.whenStable();
    expect(location.path(true)).toBe('/tx/abc?showDetails=true&artifact=abci5#vin=0');
  });

  it('names the artifact, so a claim on a later artifact page is linked as that page', async () => {
    const { harness, component, location } = await open('/tx/abc');

    component.toggleView();
    await harness.fixture.whenStable();

    expect(location.path(true)).toBe('/tx/abc?bitmap3d=800000&artifact=abci5');
  });

  it('opens on 3D when the link names this claim', async () => {
    const { component } = await open('/tx/abc?bitmap3d=800000');

    expect(component.mode).toBe('3d');
    expect(component.sceneLoading).toBe(true);
  });

  it('stays flat when the link names a different claim', async () => {
    // A transaction can hold more than one bitmap, so the height in the
    // link has to pick out the one it belongs to.
    const { component } = await open('/tx/abc?bitmap3d=999999');

    expect(component.mode).toBe('2d');
  });
});
