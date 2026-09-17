import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { Observable, Subject, firstValueFrom, of, toArray } from 'rxjs';

import { BitmapApiService, BitmapResponse } from '@app/services/ordinals/bitmap-api.service';
import { BitmapViewerComponent } from './bitmap-viewer.component';

/**
 * The viewer's three view states. Before these existed the template tested
 * a nullable view-model, so "still fetching" and "no data for this block"
 * both rendered as an empty column with no indication either way.
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

  it('draws the squares in ordpool orange, not the parser default', async () => {
    document.documentElement.style.setProperty('--primary', '#FF9900');
    const { component } = setup(of(blockResponse));
    component.height = 800_000;

    const vm = await firstValueFrom(component.vm$.pipe(toArray()));
    // The stubbed sanitizer hands the markup straight back, so the view
    // model's SafeHtml is the SVG string here.
    const ready = vm[vm.length - 1] as unknown as { kind: 'ready'; svg: string };

    expect(ready.svg).toContain('#FF9900');
    // bitlodo's reference orange, the fallback when no colour is passed
    expect(ready.svg).not.toContain('#F7931A');
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

  it('reports unavailable without asking the API when there is no height', async () => {
    const { component, getBitmapData } = setup(of(blockResponse));
    component.height = null;

    expect(await firstValueFrom(component.vm$)).toEqual({ kind: 'unavailable' });
    expect(getBitmapData).not.toHaveBeenCalled();
  });

  it('does not re-request when the same height is set again', () => {
    const { component, getBitmapData } = setup(of(blockResponse));
    component.height = 800_000;
    component.height = 800_000;

    expect(getBitmapData).toHaveBeenCalledTimes(1);
    expect(getBitmapData).toHaveBeenCalledWith(800_000);
  });
});
