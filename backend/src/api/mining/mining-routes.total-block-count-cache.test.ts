/**
 * Regression test for the residual latency after the 2026-09-07 pools incident:
 * the /mining/pools handler ran BlocksRepository.$blockCount(null, null)
 * (`count(height) WHERE stale=0`, ~11s over 654k rows) UNCACHED on every
 * request, for the X-total-count header. `getCachedTotalBlockCount` wraps it in
 * a short-TTL cache + single-flight so concurrent requests share ONE count.
 *
 * SUT is the cache wrapper; the DB call (BlocksRepository.$blockCount) is the
 * mocked IO boundary. mining-routes' heavy imports are mocked so it loads without
 * a DB.
 */
jest.mock('../../config', () => ({ __esModule: true, default: { MEMPOOL: { NETWORK: 'mainnet', API_URL_PREFIX: '/api/v1/' } } }));
jest.mock('../../repositories/BlocksRepository', () => ({ __esModule: true, default: { $blockCount: jest.fn() } }));
jest.mock('../../repositories/BlocksAuditsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../repositories/DifficultyAdjustmentsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../repositories/HashratesRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../repositories/PricesRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../repositories/AccelerationRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));
jest.mock('./mining', () => ({ __esModule: true, default: { $getPoolsStats: jest.fn() } }));
jest.mock('../services/acceleration', () => ({ __esModule: true, default: {} }));

import BlocksRepository from '../../repositories/BlocksRepository';
import { getCachedTotalBlockCount, __resetTotalBlockCountCache } from './mining-routes';

const $blockCount = BlocksRepository.$blockCount as jest.Mock;

describe('getCachedTotalBlockCount — cache + single-flight (pools-incident residual)', () => {

  beforeEach(() => {
    jest.restoreAllMocks();
    __resetTotalBlockCountCache();
    $blockCount.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    __resetTotalBlockCountCache();
  });

  it('collapses concurrent requests into ONE underlying $blockCount (single-flight)', async () => {
    let resolve!: (v: number) => void;
    $blockCount.mockImplementation(() => new Promise((r) => { resolve = r as (v: number) => void; }));

    const calls = Array.from({ length: 100 }, () => getCachedTotalBlockCount());
    await Promise.resolve();
    resolve(654045);
    const results = await Promise.all(calls);

    expect($blockCount).toHaveBeenCalledTimes(1);
    expect($blockCount).toHaveBeenCalledWith(null, null);
    results.forEach((r) => expect(r).toBe(654045));
  });

  it('serves the cached count within the TTL without re-querying', async () => {
    $blockCount.mockResolvedValue(654045);
    const a = await getCachedTotalBlockCount();
    const b = await getCachedTotalBlockCount();
    expect($blockCount).toHaveBeenCalledTimes(1);
    expect(a).toBe(654045);
    expect(b).toBe(654045);
  });

  it('re-queries after the TTL expires', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    $blockCount.mockResolvedValueOnce(654045).mockResolvedValueOnce(654050);

    const a = await getCachedTotalBlockCount();
    jest.setSystemTime(new Date('2026-01-01T00:06:00Z')); // past 5-min TTL
    const b = await getCachedTotalBlockCount();

    expect($blockCount).toHaveBeenCalledTimes(2);
    expect(a).toBe(654045);
    expect(b).toBe(654050);
  });

  it('does NOT cache a failed count and retries next call', async () => {
    $blockCount.mockRejectedValueOnce(new Error('db storm')).mockResolvedValueOnce(654045);
    await expect(getCachedTotalBlockCount()).rejects.toThrow('db storm');
    await expect(getCachedTotalBlockCount()).resolves.toBe(654045);
    expect($blockCount).toHaveBeenCalledTimes(2);
  });
});
