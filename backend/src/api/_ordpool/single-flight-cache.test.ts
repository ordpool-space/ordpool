jest.mock('../../logger', () => ({ __esModule: true, default: { err: jest.fn() } }));

import { SingleFlightCache } from './single-flight-cache';

describe('SingleFlightCache — single-flight + TTL + stale-while-revalidate', () => {
  afterEach(() => jest.useRealTimers());

  it('collapses concurrent misses into ONE computation (single-flight)', async () => {
    const cache = new SingleFlightCache<object>(60_000);
    let resolve!: (v: object) => void;
    const compute = jest.fn(() => new Promise<object>((r) => { resolve = r; }));

    const calls = Array.from({ length: 100 }, () => cache.get('k', compute));
    await Promise.resolve();
    resolve({ ok: 1 });
    const results = await Promise.all(calls);

    expect(compute).toHaveBeenCalledTimes(1);
    results.forEach((r) => expect(r).toEqual({ ok: 1 }));
  });

  it('serves a fresh cached value without recomputing', async () => {
    const cache = new SingleFlightCache<object>(60_000);
    const compute = jest.fn().mockResolvedValue({ v: 'x' });

    const first = await cache.get('k', compute);
    const second = await cache.get('k', compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('keys independently', async () => {
    const cache = new SingleFlightCache<object>(60_000);
    const compute = jest.fn()
      .mockResolvedValueOnce({ k: 'a' })
      .mockResolvedValueOnce({ k: 'b' });

    expect(await cache.get('a', compute)).toEqual({ k: 'a' });
    expect(await cache.get('b', compute)).toEqual({ k: 'b' });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('serves STALE immediately after TTL, refreshing in the background (SWR)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const cache = new SingleFlightCache<object>(5 * 60_000);
    const compute = jest.fn()
      .mockResolvedValueOnce({ v: 'a' })
      .mockResolvedValueOnce({ v: 'b' });

    expect(await cache.get('k', compute)).toEqual({ v: 'a' }); // cold: awaits 'a'

    jest.setSystemTime(new Date('2026-01-01T00:06:00Z')); // past TTL
    const stale = await cache.get('k', compute);
    expect(stale).toEqual({ v: 'a' });            // stale served at once
    expect(compute).toHaveBeenCalledTimes(2);      // background refresh kicked off

    await Promise.resolve(); await Promise.resolve(); // let the refresh settle

    expect(await cache.get('k', compute)).toEqual({ v: 'b' }); // now fresh
    expect(compute).toHaveBeenCalledTimes(2);                   // served from cache
  });

  it('does NOT cache a failed computation and retries next call', async () => {
    const cache = new SingleFlightCache<object>(60_000);
    const compute = jest.fn()
      .mockRejectedValueOnce(new Error('db storm'))
      .mockResolvedValueOnce({ v: 'ok' });

    await expect(cache.get('k', compute)).rejects.toThrow('db storm');
    await expect(cache.get('k', compute)).resolves.toEqual({ v: 'ok' });
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
