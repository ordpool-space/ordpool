import { NextFunction, Request, Response } from 'express';

// HACK --- Ordpool: cache-policy middleware — our "nginx expires" layer.
//
// mempool runs a self-hosted nginx tier that stamps `Cache-Control`/`expires`
// per endpoint and caches in nginx `proxy_cache`. We don't run nginx: the
// Cloudflare Tunnel forwards straight to this Node process, and the Cloudflare
// edge is our proxy_cache. But Cloudflare only caches a path when a Cache Rule
// marks it eligible AND the origin sends a cacheable `Cache-Control`. Upstream's
// handlers send at most `Cache-control: public` + an `Expires` date (no
// max-age), and several endpoints send nothing — so the edge treats them all as
// DYNAMIC. This middleware supplies the missing directive.
//
// It stamps `Cache-Control: public, max-age=<browser>, s-maxage=<edge>` on an
// allowlist of read-only GET endpoints. `s-maxage` drives the Cloudflare edge
// TTL (with a respect-origin Cache Rule); `max-age` is the shorter browser TTL,
// so humans stay fresher than the shared edge copy. Values are adopted from
// mempool's own live prod headers and their nginx proxy_cache tiers, adapted to
// our lower scale (we widen the 1s fee/tip client TTL so the edge actually
// collapses crawler bursts). See cloudflare/CACHING.md §0.
//
// The header is set inside a `res.writeHead` hook so it wins over whatever the
// upstream handler already set, WITHOUT editing any upstream route file — zero
// merge surface. Only 2xx responses are stamped (a transient 5xx must not get
// pinned at the edge); non-GET, non-allowlisted paths are passed through
// untouched, so `POST /api/tx`, the WebSocket, and address/tx lookups stay
// DYNAMIC by construction.

export interface CachePolicy {
  /** Cloudflare edge TTL in seconds (via s-maxage). */
  edge: number;
  /** Browser TTL in seconds (via max-age); <= edge. */
  browser: number;
}

const DAY = 86_400;

const POLICIES: ReadonlyArray<{ match: (path: string) => boolean; policy: CachePolicy }> = [
  // Immutable: a block addressed by hash never changes (a reorg changes the tip,
  // not the data at a given hash). mempool caches this "forever" (30d). Matches
  // `/api/v1/block/<hash>` and its sub-resources (/txs, /txids, /header, …), but
  // NOT `/api/v1/blocks` (the recent-blocks list, which changes) — note the
  // trailing slash. Backend route (res.json), so our header wins cleanly.
  { match: (p) => p.startsWith('/api/v1/block/'), policy: { edge: 30 * DAY, browser: DAY } },
  // Near-real-time: keep browsers nearly live, let the edge collapse crawler bursts.
  { match: (p) => p === '/api/v1/blocks/tip/height', policy: { edge: 10, browser: 5 } },
  { match: (p) => p === '/api/v1/fees/recommended', policy: { edge: 15, browser: 5 } },
  // Heavy aggregations (the crawler magnets); staleness invisible vs ~10 min blocks.
  // 120s edge matches mempool's observed max-age for pools/hashrate.
  { match: (p) => p.startsWith('/api/v1/mining/'), policy: { edge: 120, browser: 60 } },
  { match: (p) => p.startsWith('/api/v1/statistics/'), policy: { edge: 120, browser: 60 } },
  { match: (p) => p === '/api/v1/difficulty-adjustment', policy: { edge: 120, browser: 60 } },
];

/** Resolve the cache policy for a request path, or undefined if not cacheable. */
export function findCachePolicy(path: string): CachePolicy | undefined {
  return POLICIES.find((entry) => entry.match(path))?.policy;
}

export function ordpoolCachePolicy(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }
  const policy = findCachePolicy(req.path);
  if (!policy) {
    return next();
  }

  // Wrap writeHead so our header is applied at flush time, after (and overriding)
  // whatever the upstream handler set. The cast is needed because writeHead has
  // several overload signatures we don't want to reproduce; we forward args verbatim.
  const originalWriteHead = res.writeHead.bind(res) as (...a: unknown[]) => Response;
  (res as unknown as { writeHead: (...a: unknown[]) => Response }).writeHead = (...args: unknown[]) => {
    const status = (typeof args[0] === 'number' ? args[0] : res.statusCode) || 0;
    if (status >= 200 && status < 300) {
      res.setHeader('Cache-Control', `public, max-age=${policy.browser}, s-maxage=${policy.edge}`);
      // Correct for compressed variants; never Vary on Cookie (that disables edge
      // caching). Our API responses carry no Set-Cookie, so this stays safe.
      res.setHeader('Vary', 'Accept-Encoding');
      // Drop upstream's bare `Expires` + `Pragma: public`, which would otherwise
      // fight the max-age we just set.
      res.removeHeader('Expires');
      res.removeHeader('Pragma');
    }
    return originalWriteHead(...args);
  };
  next();
}
