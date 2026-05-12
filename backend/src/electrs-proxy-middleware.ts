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

export function createElectrsProxyMiddleware(electrsBaseUrl: string | undefined): RequestHandler {
  const electrsHost = new URL(electrsBaseUrl || 'http://127.0.0.1:3000');
  const port = electrsHost.port || '80';
  const hostHeader = `${electrsHost.hostname}:${port}`;

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/v1' || req.path.startsWith('/v1/')) {
      return next();
    }
    const injectOtsCommit = req.method === 'GET' && TX_DETAIL_PATH.test(req.path);
    const proxyReq = http.request({
      host: electrsHost.hostname,
      port: Number(port),
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: hostHeader },
    }, (electrsRes) => {
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
    proxyReq.on('error', (err) => {
      logger.warn(`electrs proxy error for ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).send('electrs proxy error');
      }
    });
    req.pipe(proxyReq);
  };
}
