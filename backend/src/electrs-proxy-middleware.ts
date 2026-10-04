import { NextFunction, Request, RequestHandler, Response } from 'express';
import * as http from 'http';
import logger from './logger';
import { attachIsOtsCommit } from './api/ordpool-ots-flag';

// HACK --- Ordpool: cheap nginx replacement.
// Mempool's upstream production runs nginx in front of backend + electrs to path-route
// /api/v1/* → backend and /api/* → electrs (with the /api prefix stripped). We don't
// run nginx — the Cloudflare Tunnel forwards everything to this Node process. So we do
// the same path-rewriting in Express here, before any other route is matched.
//
// Mounted under '/api' in index.ts, so req.path arrives without that prefix
// (e.g. GET /api/v1/blocks → req.path === '/v1/blocks'). /v1/* falls through to
// upstream's normal routing; everything else streams to electrs.
//
// For our traffic (a few hundred req/s peak, mostly bots) the ~200µs Node proxy
// overhead vs. nginx's ~50µs is invisible relative to electrs's 10-100ms response time.
// If we ever scale to where the proxy itself becomes the bottleneck, this gets replaced
// by nginx in front of cloudflared and these lines deleted.
//
// HACK -- Ordpool: when `MEMPOOL.BACKEND === 'esplora'` (prod), upstream's
// `bitcoin.routes.ts:75-80` gates off `getTransaction`, so `/api/tx/<txid>`
// is served by this proxy. We intercept GET /tx/<64-hex> here, buffer the
// JSON body, and inject the tristate `isOtsCommit` field via
// `attachIsOtsCommit` so the frontend's OtsKnowledgeService can skip the
// lazy probe on the strip wire. Everything else streams through untouched.
// See ORDPOOL-FLAGS-ARCHITECTURE.md §4.
const TX_DETAIL_PATH = /^\/tx\/[0-9a-f]{64}$/i;

// HACK -- Ordpool: immutable-block edge cache for the esplora surface.
// A block addressed by hash never changes, so `/block/<hash>` and its
// sub-resources (txids/txs/header/raw) are cacheable ~forever — the electrs
// equivalent of the /api/v1/block/ tier and mempool's nginx `cache-forever`.
// electrs sends its own short Cache-Control, and this proxy passes electrs's
// headers straight to writeHead, so the cache-policy middleware (which runs
// BEFORE the proxy sets headers) can't win here — we overwrite the header on
// the electrs response directly. `req.path` is mount-stripped ('/api' removed),
// so a request to /api/block/<hash> arrives here as '/block/<hash>'.
// `/status` is EXCLUDED: a block's in_best_chain / next_best can flip on a reorg.
const IMMUTABLE_BLOCK_CACHE_CONTROL = 'public, max-age=86400, s-maxage=2592000';

/** True for esplora block resources whose bytes never change (safe to cache 30d). */
export function isImmutableEsploraBlockPath(reqPath: string): boolean {
  return reqPath.startsWith('/block/') && !reqPath.endsWith('/status');
}

/**
 * If `reqPath` is an immutable esplora block resource and the upstream returned
 * 2xx, overwrite the electrs Cache-Control (and drop its Expires/Pragma) so the
 * Cloudflare edge caches it long. Mutates `electrsRes.headers` in place.
 */
export function applyImmutableBlockCacheHeader(reqPath: string, electrsRes: http.IncomingMessage): void {
  const status = electrsRes.statusCode || 0;
  if (status < 200 || status >= 300) { return; }
  if (!isImmutableEsploraBlockPath(reqPath)) { return; }
  electrsRes.headers['cache-control'] = IMMUTABLE_BLOCK_CACHE_CONTROL;
  delete electrsRes.headers['expires'];
  delete electrsRes.headers['pragma'];
}

// HACK -- Ordpool: the access rules upstream's nginx applies in front of this
// split, which a plain path-router loses.
//
// `/api/internal/` (electrs) and `/api/v1/internal/` (backend) answer 403 to
// external clients, as in upstream's `production/nginx/location-api.conf`.
// Upstream can tell internal from external by source address; we cannot,
// because cloudflared reaches this process over loopback, so every request
// here is external and the block is unconditional. Our own backend talks to
// electrs at ESPLORA.REST_API_URL directly and never goes through this proxy.
// Case-insensitive because Express route matching is.
const INTERNAL_PATH = /^\/(v1\/)?internal(\/|$)/i;

// Request bodies are capped at upstream nginx's `client_max_body_size 10m`
// (`production/nginx/http-basic.conf`). electrs buffers a whole body before
// routing it.
export const MAX_PROXIED_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Drop `max_txs` from the query string, so electrs always applies its own
 * configured page size on the history routes. No consumer of this API sets it.
 * URLSearchParams decodes keys, which matters because electrs decodes them too
 * (`max%5Ftxs` is `max_txs` to it).
 */
export function stripMaxTxs(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) { return url; }
  const params = new URLSearchParams(url.slice(q + 1));
  if (!params.has('max_txs')) { return url; }
  params.delete('max_txs');
  const rest = params.toString();
  return rest ? `${url.slice(0, q)}?${rest}` : url.slice(0, q);
}

export function createElectrsProxyMiddleware(electrsBaseUrl: string | undefined): RequestHandler {
  const electrsHost = new URL(electrsBaseUrl || 'http://127.0.0.1:3000');
  const port = electrsHost.port || '80';
  const hostHeader = `${electrsHost.hostname}:${port}`;

  return (req: Request, res: Response, next: NextFunction) => {
    if (INTERNAL_PATH.test(req.path)) {
      res.status(403).end();
      return;
    }
    if (req.path === '/v1' || req.path.startsWith('/v1/')) {
      return next();
    }
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROXIED_BODY_BYTES) {
      res.status(413).end();
      return;
    }
    const injectOtsCommit = req.method === 'GET' && TX_DETAIL_PATH.test(req.path);
    const proxyReq = http.request({
      host: electrsHost.hostname,
      port: Number(port),
      path: stripMaxTxs(req.url),
      method: req.method,
      headers: { ...req.headers, host: hostHeader },
    }, (electrsRes) => {
      applyImmutableBlockCacheHeader(req.path, electrsRes);
      if (!injectOtsCommit) {
        res.writeHead(electrsRes.statusCode || 502, electrsRes.headers);
        electrsRes.pipe(res);
        return;
      }
      // Buffer the small (~1-3 KB) tx-detail JSON so we can inject
      // `isOtsCommit`. If anything looks off (non-200, content-encoding,
      // unparseable body, missing txid), fall back to a clean passthrough
      // so we never corrupt a response we don't understand.
      const status = electrsRes.statusCode || 502;
      const encoding = electrsRes.headers['content-encoding'];
      if (status !== 200 || encoding) {
        res.writeHead(status, electrsRes.headers);
        electrsRes.pipe(res);
        return;
      }
      const chunks: Buffer[] = [];
      electrsRes.on('data', (c: Buffer) => chunks.push(c));
      electrsRes.on('end', () => {
        const body = Buffer.concat(chunks);
        try {
          const tx = JSON.parse(body.toString('utf8'));
          if (!tx || typeof tx.txid !== 'string') {
            res.writeHead(status, electrsRes.headers);
            res.end(body);
            return;
          }
          attachIsOtsCommit(tx);
          const out = Buffer.from(JSON.stringify(tx));
          const headers: http.OutgoingHttpHeaders = { ...electrsRes.headers };
          headers['content-length'] = String(out.length);
          delete headers['transfer-encoding'];
          res.writeHead(status, headers);
          res.end(out);
        } catch {
          res.writeHead(status, electrsRes.headers);
          res.end(body);
        }
      });
      electrsRes.on('error', () => {
        if (!res.headersSent) {
          res.status(502).send('electrs proxy stream error');
        }
      });
    });
    let bodyTooLarge = false;
    proxyReq.on('error', (err) => {
      if (bodyTooLarge) { return; }
      logger.warn(`electrs proxy error for ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).send('electrs proxy error');
      }
    });
    // Counted while streaming, because a chunked body declares no length.
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      if (bodyTooLarge) { return; }
      received += chunk.length;
      if (received > MAX_PROXIED_BODY_BYTES) {
        bodyTooLarge = true;
        proxyReq.destroy();
        if (!res.headersSent) {
          res.status(413).end();
        }
        req.resume();
        return;
      }
      if (!proxyReq.write(chunk)) {
        req.pause();
        proxyReq.once('drain', () => req.resume());
      }
    });
    req.on('end', () => {
      if (!bodyTooLarge) { proxyReq.end(); }
    });
  };
}
