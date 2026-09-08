import logger from '../../logger';

// HACK -- Ordpool: generic single-flight + TTL + stale-while-revalidate cache.
//
// Extracted from the pools-stats prod-incident fix so the MECHANISM lives in
// owned code (never merge-conflicts with upstream mempool) and the upstream
// files keep only a thin, fenced wrapper.
//
// Why this exists at all: Cloudflare's free plan has no origin shield — it does
// not coalesce concurrent edge-misses and has no edge stale-while-revalidate.
// This is the in-process stand-in for nginx's `proxy_cache_use_stale updating`
// (mempool gets that from their nginx tier; we don't run nginx). It is NOT
// redundant with the Cloudflare edge cache. See cloudflare/CACHING.md §0.
//
//   - single-flight: concurrent misses for a key collapse onto ONE computation.
//   - TTL: a fresh value is served without recomputing.
//   - stale-while-revalidate: an expired-but-present value is served immediately
//     while ONE background refresh runs; only a true cold start (nothing cached
//     yet) awaits the computation. A failed refresh is logged and the stale
//     value keeps serving, so a transient error is never cached.
export class SingleFlightCache<T> {
  private cache = new Map<string, { at: number; data: T }>();
  private inflight = new Map<string, Promise<T>>();

  constructor(private readonly ttlMs: number, private readonly label = 'cache') {}

  /**
   * Return the cached value for `key`, or compute it. Fresh → served as-is;
   * stale-but-present → served immediately while one background refresh runs;
   * absent → awaits a single-flighted computation. `compute` is a thunk so the
   * caller can close over whatever arguments the key maps to.
   */
  get(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.at) < this.ttlMs) {
      return Promise.resolve(cached.data);
    }
    const inflight = this.inflight.get(key) ?? this.startRefresh(key, compute);
    return cached ? Promise.resolve(cached.data) : inflight;
  }

  private startRefresh(key: string, compute: () => Promise<T>): Promise<T> {
    const promise = compute()
      .then((data) => { this.cache.set(key, { at: Date.now(), data }); return data; })
      .finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, promise);
    // Stale-while-revalidate callers don't await this promise, so a rejection
    // would surface as an unhandled rejection. Log it; the stale value keeps
    // serving and the next request retries. Cold-start callers still receive
    // the rejection through the returned promise.
    promise.catch((e) => {
      logger.err(`Cannot refresh ${this.label} (${key}). Reason: ` + (e instanceof Error ? e.message : e));
    });
    return promise;
  }

  /** Drop all cached + in-flight state (used by tests). */
  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}
