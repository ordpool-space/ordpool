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
// Optional. Set in the ordpool workflow because that frontend's
// StateService.recommendedFees$ is fed by mempool's WebSocket
// pipeline, not by the SDK's REST poll. The cat21-indexer workflow
// leaves WS_ENABLED unset — its fee picker reads
// SDK.recommendedFees$ which polls /api/v1/fees/recommended directly,
// so it doesn't need a fake WS at all.
const WS_ENABLED = process.env.WS_ENABLED === '1';

const DEFAULT_FEES = {
  fastestFee: 5,
  halfHourFee: 3,
  hourFee: 1,
  economyFee: 1,
  minimumFee: 1,
};

// Live state — mutable so a test can POST /admin/fees with a "hot
// mempool" preset before opening the page. Both the REST poll AND
// the next WS broadcast read off this object.
let currentFees = { ...DEFAULT_FEES };

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
    jsonResponse(res, JSON.stringify(currentFees));
    return;
  }
  // Admin: swap the active fee preset + re-broadcast to every WS
  // client so the picker reflects the change without a reload.
  //   POST /admin/fees      body: a (partial) RecommendedFees JSON
  //   POST /admin/fees/reset    no body — restores DEFAULT_FEES
  if (req.method === 'POST' && req.url === '/admin/fees') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const incoming = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        currentFees = { ...DEFAULT_FEES, ...incoming };
        broadcastSnapshot();
        console.log(`[admin] fees → ${JSON.stringify(currentFees)}`);
        res.writeHead(204, CORS_BASE);
        res.end();
      } catch (err) {
        res.writeHead(400, { 'content-type': 'text/plain', ...CORS_BASE });
        res.end(`bad json: ${err.message}`);
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/admin/fees/reset') {
    currentFees = { ...DEFAULT_FEES };
    broadcastSnapshot();
    console.log(`[admin] fees → reset to default`);
    res.writeHead(204, CORS_BASE);
    res.end();
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

// `broadcastSnapshot` is hoisted into the outer scope but only does
// real work when the WS path is wired up below. Default no-op so the
// admin endpoints can call it unconditionally.
let broadcastSnapshot = () => {};

if (WS_ENABLED) {
  // ESM resolves bare imports against the script's directory, not cwd,
  // so a plain `import 'ws'` from this file fails even when invoked
  // from frontend/. Resolve the path explicitly against process.cwd()
  // and feed the resulting file:// URL to `import()`. The ordpool
  // workflow runs this stub from `frontend/` where `ws` is a transitive
  // dep of the mempool fork. WS_PACKAGE_DIR lets a caller override the
  // lookup (e.g. when bundling the stub elsewhere).
  const { default: nodePath } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const wsDir = process.env.WS_PACKAGE_DIR
    ?? nodePath.resolve(process.cwd(), 'node_modules/ws');
  const wsEntry = pathToFileURL(nodePath.join(wsDir, 'wrapper.mjs')).href;
  const { WebSocketServer } = await import(wsEntry);
  const wss = new WebSocketServer({ server, path: '/api/v1/ws' });
  // Mempool's frontend sends a JSON command to subscribe to channels
  // (`{"action":"want","data":[...]}`). The state-service consumes
  // top-level keys on every incoming server message. We only need to
  // push `fees` once so `recommendedFees$` emits and the cat21-mint
  // empty-state stops gating on `!utxoLoading()`-after-`recommendedFees$`.
  // Anything we don't recognise we silently drop.
  // `buildFrame()` is recomputed every send so a mid-test
  // POST /admin/fees flips the picker tier values on the next
  // broadcast (or the next client's first `init`).
  function buildFrame() {
    const feeRange = [currentFees.minimumFee, currentFees.fastestFee];
    return JSON.stringify({
      fees: currentFees,
      'mempool-blocks': [
        { blockSize: 1_500_000, blockVSize: 750_000, nTx: 1, totalFees: 5_000, medianFee: currentFees.halfHourFee, feeRange },
      ],
      da: {
        progressPercent: 0,
        difficultyChange: 0,
        estimatedRetargetDate: Date.now() + 1209600000,
        remainingBlocks: 2016,
        remainingTime: 1209600000,
        previousRetarget: 0,
        previousTime: Math.floor(Date.now() / 1000),
        nextRetargetHeight: 2016,
        timeAvg: 600,
        adjustedTimeAvg: 600,
        timeOffset: 0,
        expectedBlocks: 0,
      },
      backendInfo: { hostname: 'regtest-stub', version: 'e2e', gitCommit: 'e2e' },
      // The fees-box-clickable component's `isLoading$` is a
      // combineLatest of `isLoadingWebSocket$` and
      // `loadingIndicators$.pipe(startWith({mempool:0}))` — it stays
      // true (and the picker stays in its skeleton-tile state) until
      // `loadingIndicators.mempool` reaches 100. Without this key the
      // fee picker never exits skeleton and a Playwright spec waiting
      // for `.fee-estimation-container .item a` to count 4 times out
      // (observed on run 27482094562).
      loadingIndicators: { mempool: 100 },
    });
  }
  broadcastSnapshot = () => {
    const frame = buildFrame();
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) client.send(frame);
    }
  };
  wss.on('connection', (ws) => {
    console.log('[ws] client connected');
    ws.send(buildFrame());
    ws.on('message', (raw) => {
      // mempool's client kicks off `{"action":"init"}` then `want` —
      // re-send the snapshot on every command so any state pivot lands.
      console.log(`[ws] ← ${raw.toString().slice(0, 200)}`);
      ws.send(buildFrame());
    });
    ws.on('close', () => console.log('[ws] client disconnected'));
  });
}

server.listen(PORT, () => {
  console.log(`fees-electrs-stub listening on :${PORT} → ${ELECTRS_URL}${WS_ENABLED ? ' (WS enabled)' : ''}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
