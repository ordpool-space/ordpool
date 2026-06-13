#!/usr/bin/env node
/**
 * Tiny HTTP shim that lets the cat21.space frontend talk to a bare
 * regtest stack (bitcoind + electrs) without spinning up the full
 * ordpool-backend just for one endpoint.
 *
 * Two responsibilities:
 *
 *   1. /api/v1/fees/recommended  → returns a static low-fee body. The
 *      SDK's recommendedFees$ stream polls this; in production
 *      ordpool-backend computes the real numbers from electrs but on
 *      regtest the only consumer (the picker) just needs SOMETHING
 *      finite for the tier buttons + auto-seed to work.
 *
 *   2. /api/*                    → reverse-proxy to electrs on
 *      :3000 path-for-path. Covers /api/address/<addr>/utxo,
 *      /api/tx/<txid>, /api/tx (broadcast), etc. — every electrs
 *      endpoint the mint flow reaches for.
 *
 * Zero npm deps; uses node:http + node:https only. Run as:
 *
 *   PORT=8999 ELECTRS_URL=http://localhost:3000 node fees-electrs-stub.mjs
 */
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT ?? 8999);
const ELECTRS_URL = process.env.ELECTRS_URL ?? 'http://localhost:3000';

const FEES_BODY = JSON.stringify({
  fastestFee: 5,
  halfHourFee: 3,
  hourFee: 1,
  economyFee: 1,
  minimumFee: 1,
});

const electrs = new URL(ELECTRS_URL);

function proxyToElectrs(req, res) {
  const upstreamPath = req.url.startsWith('/api/')
    ? req.url.slice('/api'.length) // /api/address/.../utxo → /address/.../utxo
    : req.url;
  const upstream = http.request({
    hostname: electrs.hostname,
    port: electrs.port || 80,
    method: req.method,
    path: upstreamPath || '/',
    headers: req.headers,
  }, (upRes) => {
    // electrs doesn't emit CORS headers; the frontend is on a
    // different origin (localhost:4221) so without these the browser
    // blocks the response and the orchestrator's utxos$ stream
    // appears to hang in loading-utxos forever.
    const headers = {
      ...upRes.headers,
      'access-control-allow-origin': '*',
      'access-control-expose-headers': '*',
    };
    res.writeHead(upRes.statusCode ?? 502, headers);
    upRes.pipe(res);
  });
  upstream.on('error', (err) => {
    res.writeHead(502, {
      'content-type': 'text/plain',
      'access-control-allow-origin': '*',
    });
    res.end(`upstream electrs error: ${err.message}`);
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/v1/fees/recommended') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(FEES_BODY);
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': '*',
    });
    res.end();
    return;
  }
  // Everything else falls through to electrs, including a healthz
  // path so the workflow's "wait for stub" loop has something cheap
  // to poll.
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  proxyToElectrs(req, res);
});

server.listen(PORT, () => {
  console.log(`fees-electrs-stub listening on :${PORT} → ${ELECTRS_URL}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
