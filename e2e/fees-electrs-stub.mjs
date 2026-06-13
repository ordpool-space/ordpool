#!/usr/bin/env node
/**
 * Tiny HTTP shim that lets the ordpool / cat21.space frontend talk to a
 * bare regtest stack (bitcoind + electrs) without spinning up the full
 * ordpool-backend AND/OR cat21-indexer just for a handful of endpoints.
 *
 * Three responsibilities:
 *
 *   1. /api/v1/fees/recommended  → static low-fee body.
 *
 *   2. /api/status               → cat21-indexer-shape status (totalCats=0,
 *      /api/cats/numbers/:ipp/:p    lastSyncTime=null, empty cats lists).
 *      /api/cats/:ipp/:p           ordpool's wallet asset scanner hits
 *                                  these on every connect to identify cat
 *                                  sats among the wallet's UTXOs. On
 *                                  regtest there are no cats, so empty
 *                                  responses are correct AND let the
 *                                  scanner finish (vs. hanging on ECONNREFUSED).
 *
 *   3. /api/*                    → reverse-proxy to electrs path-for-path.
 *      Covers /api/address/<addr>/utxo, /api/tx/<txid>, /api/tx (broadcast).
 *
 * Every response carries `cache-control: no-store` so a "no UTXOs yet"
 * empty body from before funding doesn't get replayed from the browser
 * cache after the wallet is funded + page reloaded.
 *
 * Zero npm deps; uses node:http only. Run as:
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

const EMPTY_STATUS_BODY = JSON.stringify({
  totalCats: 0,
  lastSyncTime: null,
});

function emptyCatsBody(itemsPerPage, currentPage) {
  return JSON.stringify({
    currentPage: Number(currentPage) || 1,
    itemsPerPage: Number(itemsPerPage) || 12,
    totalCount: 0,
    totalPages: 0,
    data: [],
  });
}

const CORS_BASE = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': '*',
  'cache-control': 'no-store, no-cache, must-revalidate',
  pragma: 'no-cache',
  expires: '0',
};

const electrs = new URL(ELECTRS_URL);

function jsonResponse(res, body) {
  res.writeHead(200, {
    'content-type': 'application/json',
    ...CORS_BASE,
  });
  res.end(body);
}

function proxyToElectrs(req, res) {
  const upstreamPath = req.url.startsWith('/api/')
    ? req.url.slice('/api'.length) // /api/address/.../utxo → /address/.../utxo
    : req.url;
  // Strip browser-side hop-by-hop / cache / origin headers — electrs
  // doesn't need them and `host: localhost:8999` is misleading once the
  // request is forwarded.
  const upstreamHeaders = { ...req.headers };
  for (const h of ['host', 'origin', 'referer', 'cookie', 'if-none-match',
    'if-modified-since', 'cache-control', 'connection']) {
    delete upstreamHeaders[h];
  }
  const upstream = http.request({
    hostname: electrs.hostname,
    port: electrs.port || 80,
    method: req.method,
    path: upstreamPath || '/',
    headers: upstreamHeaders,
  }, (upRes) => {
    const headers = {
      ...upRes.headers,
      ...CORS_BASE, // overrides cache-control etc. coming from electrs
    };
    // Log non-trivial responses so a "stub returned [] when it shouldn't"
    // failure has something to grep for in fees-stub.log.
    if (/\/address\/.*\/utxo/.test(upstreamPath)) {
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        const body = Buffer.concat(chunks);
        console.log(
          `[utxo] ${req.method} ${upstreamPath} → ${upRes.statusCode} ${body.length}B ${body.length < 200 ? body.toString() : '…'}`,
        );
        res.writeHead(upRes.statusCode ?? 502, headers);
        res.end(body);
      });
      upRes.on('error', (err) => {
        res.writeHead(502, { 'content-type': 'text/plain', ...CORS_BASE });
        res.end(`upstream read error: ${err.message}`);
      });
      return;
    }
    res.writeHead(upRes.statusCode ?? 502, headers);
    upRes.pipe(res);
  });
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain', ...CORS_BASE });
    res.end(`upstream electrs error: ${err.message}`);
  });
  req.pipe(upstream);
}

const CATS_NUMBERS_RE = /^\/api\/cats\/numbers\/(\d+)\/(\d+)\/?$/;
const CATS_PAGE_RE = /^\/api\/cats\/(\d+)\/(\d+)\/?$/;

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': '*',
      ...CORS_BASE,
    });
    res.end();
    return;
  }
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain', ...CORS_BASE });
    res.end('ok');
    return;
  }
  if (req.method === 'GET' && req.url === '/api/v1/fees/recommended') {
    jsonResponse(res, FEES_BODY);
    return;
  }
  if (req.method === 'GET' && req.url === '/api/status') {
    jsonResponse(res, EMPTY_STATUS_BODY);
    return;
  }
  const numbersMatch = req.method === 'GET' && CATS_NUMBERS_RE.exec(req.url);
  if (numbersMatch) {
    jsonResponse(res, emptyCatsBody(numbersMatch[1], numbersMatch[2]));
    return;
  }
  const pageMatch = req.method === 'GET' && CATS_PAGE_RE.exec(req.url);
  if (pageMatch) {
    jsonResponse(res, emptyCatsBody(pageMatch[1], pageMatch[2]));
    return;
  }
  // Everything else falls through to electrs.
  proxyToElectrs(req, res);
});

server.listen(PORT, () => {
  console.log(`fees-electrs-stub listening on :${PORT} → ${ELECTRS_URL}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
