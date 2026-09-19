import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { Observable, Subject, firstValueFrom, of, toArray } from 'rxjs';

import { BitmapApiService, BitmapResponse } from '@app/services/ordinals/bitmap-api.service';
import { BitmapViewerComponent } from './bitmap-viewer.component';

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
});
