import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { StateService } from '../state.service';
import { BitmapApiService, BitmapResponse, BitmapResult } from './bitmap-api.service';

/**
 * The bitmap data service, against a mocked HTTP boundary.
 *
 * The server answers 200 null for a block past its own tip and 503 when it
 * cannot answer. The service leans on the chain tip it knows: a height
 * beyond it has not been mined; a null for anything else, like a 503, is
 * our server not answering. Both get retried, and if they keep failing it
 * is reported as a failure and not kept.
 */
describe('BitmapApiService', () => {
  const url = (h: number) => `/api/v1/ordpool/bitmap/${h}`;
  const block: BitmapResponse = { height: 800_000, hash: 'abc', sizes: [1, 2, 3] };

  let service: BitmapApiService;
  let http: HttpTestingController;
  let state: { latestBlockHeight: number };

  beforeEach(() => {
    jest.useFakeTimers();
    state = { latestBlockHeight: 900_000 };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: StateService, useValue: state },
      ],
    });
    service = TestBed.inject(BitmapApiService);
    http = TestBed.inject(HttpTestingController);
  });

  let errors: jest.SpyInstance;
  beforeEach(() => {
    // The service reports a failed load to the console on purpose: a
    // failure is shown to the reader AND logged, never swallowed. The spy
    // keeps the run's output clean and lets the failure tests pin that.
    errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    http.verify();
    errors.mockRestore();
    jest.useRealTimers();
  });

  const collect = (height: number) => {
    const out: BitmapResult[] = [];
    service.getBitmap(height).subscribe((r) => out.push(r));
    return out;
  };

  /** Let the backoff before retry number `n` (1-based) elapse. */
  const waitForRetry = (n: number) =>
    jest.advanceTimersByTime(BitmapApiService.retryBaseMs * 2 ** (n - 1));

  it('reports a block past the chain tip as not mined, without asking', () => {
    const out = collect(900_001);

    http.expectNone(url(900_001));
    expect(out).toEqual([{ kind: 'not-mined' }]);
  });

  it('asks when the tip is not known yet', () => {
    state.latestBlockHeight = -1;
    const out = collect(800_000);

    http.expectOne(url(800_000)).flush(block);
    expect(out).toEqual([{ kind: 'ready', data: block }]);
  });

  it('keeps an answer for the session', () => {
    const first = collect(800_000);
    http.expectOne(url(800_000)).flush(block);
    const second = collect(800_000);

    http.expectNone(url(800_000));
    expect(first).toEqual([{ kind: 'ready', data: block }]);
    expect(second).toEqual([{ kind: 'ready', data: block }]);
  });

  it('retries a null answer for a mined block and shows what the retry brings', () => {
    const out = collect(800_000);

    http.expectOne(url(800_000)).flush(null);
    expect(out).toEqual([]);
    waitForRetry(1);
    http.expectOne(url(800_000)).flush(block);

    expect(out).toEqual([{ kind: 'ready', data: block }]);
  });

  it('reports a failure once the retries are spent, and does not keep it', () => {
    const out = collect(800_000);

    http.expectOne(url(800_000)).flush(null);
    for (let n = 1; n <= BitmapApiService.retries; n++) {
      waitForRetry(n);
      http.expectOne(url(800_000)).flush(null);
    }
    expect(out).toEqual([{ kind: 'failed' }]);
    expect(errors).toHaveBeenCalledWith('bitmap data for block 800000 could not be loaded', expect.any(Error));

    // A later viewer, or the reader's own retry, asks again.
    const again = collect(800_000);
    http.expectOne(url(800_000)).flush(block);
    expect(again).toEqual([{ kind: 'ready', data: block }]);
  });

  it('treats a server error like a null answer', () => {
    const out = collect(800_000);

    http.expectOne(url(800_000)).flush('boom', { status: 502, statusText: 'Bad Gateway' });
    for (let n = 1; n <= BitmapApiService.retries; n++) {
      waitForRetry(n);
      http.expectOne(url(800_000)).flush('boom', { status: 502, statusText: 'Bad Gateway' });
    }

    expect(out).toEqual([{ kind: 'failed' }]);
  });

  it('treats an empty transaction list as a non-answer: every block has its coinbase', () => {
    const out = collect(800_000);

    http.expectOne(url(800_000)).flush({ ...block, sizes: [] });
    for (let n = 1; n <= BitmapApiService.retries; n++) {
      waitForRetry(n);
      http.expectOne(url(800_000)).flush({ ...block, sizes: [] });
    }

    expect(out).toEqual([{ kind: 'failed' }]);
  });
});
