/**
 * Regression test for the 2026-09-07 prod incident: /api/v1/mining/pools/:interval
 * ran its heavy blocks x pools x blocks_audits aggregation LIVE + uncached, so
 * ~42 req/min stacked ~100 concurrent copies of the same ~160s query and melted
 * shared MariaDB. The fix adds a short-TTL cache + single-flight to
 * `$getPoolsStats`; this pins that behaviour so a regression that drops either
 * (letting the stampede back in) fails loudly.
 *
 * The SUT is the cache/single-flight WRAPPER; its only DB-touching collaborator,
 * the private `$computePoolsStats`, is stubbed (IO boundary), and mining.ts's
 * heavy imports are mocked so the singleton loads without a DB.
 */
jest.mock('../../database', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('../../config', () => ({ __esModule: true, default: { MEMPOOL: { NETWORK: 'mainnet' }, DATABASE: {} } }));
jest.mock('../../repositories/BlocksRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../repositories/PoolsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../repositories/HashratesRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../repositories/DifficultyAdjustmentsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../repositories/BlocksAuditsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../repositories/PricesRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));
jest.mock('../bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: {} }));
jest.mock('../loading-indicators', () => ({ __esModule: true, default: {} }));

import mining from './mining';

describe('mining.$getPoolsStats — cache + single-flight (prod-incident regression)', () => {

  beforeEach(() => {
    jest.restoreAllMocks();
    // reset the singleton's cache state between tests
    (mining as any).poolsStatsCache = {};
    (mining as any).poolsStatsInflight = {};
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('collapses concurrent misses into ONE underlying computation (single-flight)', async () => {
    let resolveCompute!: (v: object) => void;
    const compute = jest.spyOn(mining as any, '$computePoolsStats')
      .mockImplementation(() => new Promise((r) => { resolveCompute = r as (v: object) => void; }));

    // 100 concurrent requests fired while the first computation is still pending
    const calls = Array.from({ length: 100 }, () => mining.$getPoolsStats('1m'));
    await Promise.resolve(); // let all 100 reach the wrapper
    resolveCompute({ pools: [], blockCount: 0 });
    const results = await Promise.all(calls);

    // the stampede collapses to a single query
    expect(compute).toHaveBeenCalledTimes(1);
    results.forEach((r) => expect(r).toEqual({ pools: [], blockCount: 0 }));
  });

  it('serves a cached result within the TTL without recomputing', async () => {
    const compute = jest.spyOn(mining as any, '$computePoolsStats').mockResolvedValue({ pools: ['x'] });

    const first = await mining.$getPoolsStats('1m');
    const second = await mining.$getPoolsStats('1m');

    expect(compute).toHaveBeenCalledTimes(1); // second served from cache
    expect(second).toBe(first);
  });

  it('keys the cache by interval (a different interval recomputes)', async () => {
    const compute = jest.spyOn(mining as any, '$computePoolsStats')
      .mockResolvedValueOnce({ pools: ['1m'] })
      .mockResolvedValueOnce({ pools: ['24h'] });

    const a = await mining.$getPoolsStats('1m');
    const b = await mining.$getPoolsStats('24h');

    expect(compute).toHaveBeenCalledTimes(2);
    expect(a).toEqual({ pools: ['1m'] });
    expect(b).toEqual({ pools: ['24h'] });
  });

  it('recomputes after the TTL expires', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const compute = jest.spyOn(mining as any, '$computePoolsStats')
      .mockResolvedValueOnce({ pools: ['a'] })
      .mockResolvedValueOnce({ pools: ['b'] });

    const first = await mining.$getPoolsStats('1m');
    jest.setSystemTime(new Date('2026-01-01T00:06:00Z')); // past the 5-min TTL
    const second = await mining.$getPoolsStats('1m');

    expect(compute).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ pools: ['a'] });
    expect(second).toEqual({ pools: ['b'] });
  });

  it('does NOT cache a failed computation and retries on the next call', async () => {
    const compute = jest.spyOn(mining as any, '$computePoolsStats')
      .mockRejectedValueOnce(new Error('db storm'))
      .mockResolvedValueOnce({ pools: ['ok'] });

    await expect(mining.$getPoolsStats('1m')).rejects.toThrow('db storm');
    // in-flight cleared + error not cached → retry recomputes and succeeds
    await expect(mining.$getPoolsStats('1m')).resolves.toEqual({ pools: ['ok'] });
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
