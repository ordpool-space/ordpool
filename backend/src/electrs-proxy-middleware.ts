import { NextFunction, Request, RequestHandler, Response } from 'express';
import * as http from 'http';
import logger from './logger';

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
export function createElectrsProxyMiddleware(electrsBaseUrl: string | undefined): RequestHandler {
  const electrsHost = new URL(electrsBaseUrl || 'http://127.0.0.1:3000');
  const port = electrsHost.port || '80';
  const hostHeader = `${electrsHost.hostname}:${port}`;

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/v1' || req.path.startsWith('/v1/')) {
      return next();
    }
    const proxyReq = http.request({
      host: electrsHost.hostname,
      port: Number(port),
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: hostHeader },
    }, (electrsRes) => {
      res.writeHead(electrsRes.statusCode || 502, electrsRes.headers);
      electrsRes.pipe(res);
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
