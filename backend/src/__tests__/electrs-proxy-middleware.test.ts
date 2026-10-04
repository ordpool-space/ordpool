import express, { Express } from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import { applyImmutableBlockCacheHeader, createElectrsProxyMiddleware, isImmutableEsploraBlockPath, MAX_PROXIED_BODY_BYTES, stripMaxTxs } from '../electrs-proxy-middleware';

jest.mock('../logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), err: jest.fn(), debug: jest.fn() },
}));

// Mock the ordpool OTS flag module so we don't drag in the database / poller
// chain. The mock keeps a controllable set of "known OTS txids" that tests
// can mutate via `__setOtsTxids`. `attachIsOtsCommit` mirrors the real
// behaviour: writes `isOtsCommit = set.has(tx.txid)` and returns the tx.
const otsTxids = new Set<string>();
jest.mock('../api/ordpool-ots-flag', () => ({
  __esModule: true,
  attachIsOtsCommit: jest.fn(<T extends { txid: string; isOtsCommit?: boolean | null }>(tx: T): T => {
    tx.isOtsCommit = otsTxids.has(tx.txid);
    return tx;
  }),
}));

beforeEach(() => {
  otsTxids.clear();
});

type FakeHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function startServer(app: Express): Promise<{ server: http.Server, url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function startFakeElectrs(handler: FakeHandler): Promise<{ server: http.Server, url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function fetchText(url: string, opts: http.RequestOptions = {}): Promise<{ status: number, body: string, headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('electrs-proxy-middleware', () => {
  test('passes /api/v1/* through to next() (upstream routing handles it)', async () => {
    const v1Spy = jest.fn((_req, res) => res.status(200).send('reached upstream'));
    const app = express();
    app.use('/api', createElectrsProxyMiddleware('http://127.0.0.1:1')); // unreachable port — must not be hit
    app.get('/api/v1/blocks/tip/height', v1Spy);
    app.use((_req, res) => res.status(404).send('fallthrough')); // catches anything past v1

    const { server, url } = await startServer(app);
    try {
      const r = await fetchText(`${url}/api/v1/blocks/tip/height`);
      expect(r.status).toBe(200);
      expect(r.body).toBe('reached upstream');
      expect(v1Spy).toHaveBeenCalledTimes(1);
    } finally {
      await close(server);
    }
  });

  test('proxies /api/<electrs-path> to electrs, preserves status + body + querystring', async () => {
    let receivedPath: string | undefined;
    const electrs = await startFakeElectrs((req, res) => {
      receivedPath = req.url;
      res.writeHead(200, { 'content-type': 'application/json', 'x-electrs-marker': 'fake' });
      res.end('{"address":"bc1q...","balance":42}');
    });

    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));

    const { server, url } = await startServer(app);
    try {
      const r = await fetchText(`${url}/api/address/bc1q?since=12345`);
      expect(r.status).toBe(200);
      expect(r.body).toBe('{"address":"bc1q...","balance":42}');
      expect(r.headers['x-electrs-marker']).toBe('fake');
      // electrs sees the path WITHOUT the leading /api (Express strips the mount path).
      expect(receivedPath).toBe('/address/bc1q?since=12345');
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });

  test('injects isOtsCommit=true on GET /tx/<txid> when the txid is in the OTS set', async () => {
    const TXID = 'a'.repeat(64);
    otsTxids.add(TXID);

    const electrs = await startFakeElectrs((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ txid: TXID, fee: 76, status: { confirmed: true } }));
    });

    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));

    const { server, url } = await startServer(app);
    try {
      const r = await fetchText(`${url}/api/tx/${TXID}`);
      expect(r.status).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.isOtsCommit).toBe(true);
      expect(body.txid).toBe(TXID);
      expect(body.fee).toBe(76); // existing fields preserved
      // content-length must reflect the re-serialized body, not the original.
      expect(Number(r.headers['content-length'])).toBe(Buffer.byteLength(r.body));
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });

  test('injects isOtsCommit=false on GET /tx/<txid> when the txid is NOT in the OTS set', async () => {
    const TXID = 'b'.repeat(64);

    const electrs = await startFakeElectrs((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ txid: TXID }));
    });

    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));

    const { server, url } = await startServer(app);
    try {
      const r = await fetchText(`${url}/api/tx/${TXID}`);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ txid: TXID, isOtsCommit: false });
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });

  test('does NOT touch GET /tx/<txid>/hex (different path, plain text body)', async () => {
    const TXID = 'c'.repeat(64);
    otsTxids.add(TXID);

    const electrs = await startFakeElectrs((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('0200000001abcdef'); // raw hex blob, not JSON
    });

    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));

    const { server, url } = await startServer(app);
    try {
      const r = await fetchText(`${url}/api/tx/${TXID}/hex`);
      expect(r.status).toBe(200);
      expect(r.body).toBe('0200000001abcdef');
      expect(r.body).not.toContain('isOtsCommit');
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });

  test('passes through non-200 GET /tx/<txid> unchanged (no JSON parse attempt)', async () => {
    const TXID = 'd'.repeat(64);
    otsTxids.add(TXID);

    const electrs = await startFakeElectrs((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Transaction not found.');
    });

    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));

    const { server, url } = await startServer(app);
    try {
      const r = await fetchText(`${url}/api/tx/${TXID}`);
      expect(r.status).toBe(404);
      expect(r.body).toBe('Transaction not found.');
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });

  test('falls back to passthrough when electrs body is not parseable JSON', async () => {
    const TXID = 'e'.repeat(64);
    otsTxids.add(TXID);

    const electrs = await startFakeElectrs((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{not json'); // malformed
    });

    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));

    const { server, url } = await startServer(app);
    try {
      const r = await fetchText(`${url}/api/tx/${TXID}`);
      expect(r.status).toBe(200);
      expect(r.body).toBe('{not json');
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });

  test('does NOT touch POST /tx (only GET tx-detail is intercepted)', async () => {
    let receivedMethod: string | undefined;
    const electrs = await startFakeElectrs((req, res) => {
      receivedMethod = req.method;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ txid: 'broadcast-result-txid' }));
    });

    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));

    const { server, url } = await startServer(app);
    try {
      const r = await fetchText(`${url}/api/tx`, { method: 'POST' });
      expect(r.status).toBe(200);
      expect(receivedMethod).toBe('POST');
      // POSTed broadcasts come back without `isOtsCommit` injection.
      expect(JSON.parse(r.body)).toEqual({ txid: 'broadcast-result-txid' });
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });

  test('returns 502 when electrs is unreachable', async () => {
    const app = express();
    // 127.0.0.1:1 is reserved/closed — connection refused, immediate ECONNREFUSED.
    app.use('/api', createElectrsProxyMiddleware('http://127.0.0.1:1'));

    const { server, url } = await startServer(app);
    try {
      const r = await fetchText(`${url}/api/address/bc1qdoesntmatter`);
      expect(r.status).toBe(502);
      expect(r.body).toBe('electrs proxy error');
    } finally {
      await close(server);
    }
  });
});

describe('immutable esplora block cache', () => {
  test('isImmutableEsploraBlockPath — block-by-hash yes, /status + /blocks list no', () => {
    const h = '0'.repeat(64);
    expect(isImmutableEsploraBlockPath(`/block/${h}`)).toBe(true);
    expect(isImmutableEsploraBlockPath(`/block/${h}/txids`)).toBe(true);
    expect(isImmutableEsploraBlockPath(`/block/${h}/txs/25`)).toBe(true);
    expect(isImmutableEsploraBlockPath(`/block/${h}/header`)).toBe(true);
    // reorg-mutable + the changing list + unrelated paths must NOT be immutable
    expect(isImmutableEsploraBlockPath(`/block/${h}/status`)).toBe(false);
    expect(isImmutableEsploraBlockPath('/blocks/tip/height')).toBe(false);
    expect(isImmutableEsploraBlockPath('/block-height/800000')).toBe(false);
    expect(isImmutableEsploraBlockPath('/address/bc1qxyz')).toBe(false);
  });

  test('applyImmutableBlockCacheHeader overwrites electrs Cache-Control on a 2xx block, drops Expires', () => {
    const res = { statusCode: 200, headers: { 'cache-control': 'public, max-age=10', 'expires': 'someday' } } as unknown as http.IncomingMessage;
    applyImmutableBlockCacheHeader('/block/' + '0'.repeat(64), res);
    expect(res.headers['cache-control']).toBe('public, max-age=86400, s-maxage=2592000');
    expect(res.headers['expires']).toBeUndefined();
  });

  test('applyImmutableBlockCacheHeader leaves a 404 (block-not-found) untouched', () => {
    const res = { statusCode: 404, headers: { 'cache-control': 'public, max-age=10' } } as unknown as http.IncomingMessage;
    applyImmutableBlockCacheHeader('/block/' + '0'.repeat(64), res);
    expect(res.headers['cache-control']).toBe('public, max-age=10');
  });

  test('end-to-end: proxy overwrites electrs Cache-Control to 30d for /api/block/<hash>', async () => {
    const h = '0'.repeat(64);
    const electrs = await startFakeElectrs((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=10', 'expires': 'someday' });
      res.end(JSON.stringify({ id: h, height: 800000 }));
    });
    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));
    const { server, url } = await startServer(app);
    try {
      const r = await fetchText(`${url}/api/block/${h}`);
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('public, max-age=86400, s-maxage=2592000');
      expect(r.headers['expires']).toBeUndefined();
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });

  test('end-to-end: proxy does NOT overwrite Cache-Control for /api/block/<hash>/status (reorg-mutable)', async () => {
    const h = '0'.repeat(64);
    const electrs = await startFakeElectrs((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=10' });
      res.end(JSON.stringify({ in_best_chain: true, height: 800000 }));
    });
    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));
    const { server, url } = await startServer(app);
    try {
      const r = await fetchText(`${url}/api/block/${h}/status`);
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('public, max-age=10'); // electrs's own, preserved
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });
});

// The access rules upstream's nginx applies in front of the backend/electrs
// split (production/nginx/location-api.conf, http-basic.conf).
describe('upstream nginx access rules', () => {
  type Seen = { url: string, bytes: number };

  // A fake electrs that records every request it receives with its body size,
  // so a test can assert exactly which requests got through.
  async function recordingElectrs(): Promise<{ server: http.Server, url: string, seen: Seen[] }> {
    const seen: Seen[] = [];
    const e = await startFakeElectrs((req, res) => {
      let bytes = 0;
      req.on('data', (c: Buffer) => { bytes += c.length; });
      req.on('end', () => {
        seen.push({ url: req.url || '', bytes });
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('electrs');
      });
    });
    return { ...e, seen };
  }

  function send(url: string, method: string, body: Buffer, chunked: boolean): Promise<number> {
    return new Promise((resolve, reject) => {
      const headers: http.OutgoingHttpHeaders = chunked
        ? { 'transfer-encoding': 'chunked' }
        : { 'content-length': String(body.length) };
      const req = http.request(url, { method, headers }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode || 0));
      });
      // The proxy may answer 413 and close before the whole body is written.
      req.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') { reject(err); }
      });
      if (chunked) {
        const step = 1024 * 1024;
        for (let i = 0; i < body.length; i += step) { req.write(body.subarray(i, i + step)); }
        req.end();
      } else {
        req.end(body);
      }
    });
  }

  test('403 for electrs /internal and backend /v1/internal, case-insensitively, and nothing reaches either', async () => {
    const electrs = await recordingElectrs();
    const v1Hits: string[] = [];
    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));
    app.get('/api/v1/internal/blocks/definition/current', (req, res) => { v1Hits.push(req.originalUrl); res.send('backend'); });
    app.get('/api/v1/blocks/tip/height', (req, res) => { v1Hits.push(req.originalUrl); res.send('backend'); });

    const { server, url } = await startServer(app);
    try {
      expect((await fetchText(`${url}/api/internal/mempool/txs`)).status).toBe(403);
      expect((await fetchText(`${url}/api/internal`)).status).toBe(403);
      expect((await fetchText(`${url}/api/INTERNAL/mempool/txs/all`)).status).toBe(403);
      expect((await fetchText(`${url}/api/v1/internal/blocks/definition/current`)).status).toBe(403);
      expect((await fetchText(`${url}/API/V1/Internal/blocks/definition/current`)).status).toBe(403);
      // Allowed neighbours, to prove the block is not a blanket one.
      expect((await fetchText(`${url}/api/internalized/x`)).status).toBe(200);
      expect((await fetchText(`${url}/api/v1/blocks/tip/height`)).status).toBe(200);

      expect(electrs.seen.map(s => s.url)).toEqual(['/internalized/x']);
      expect(v1Hits).toEqual(['/api/v1/blocks/tip/height']);
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });

  test('stripMaxTxs removes max_txs, including a percent-encoded key, and leaves every other URL byte-identical', () => {
    expect(stripMaxTxs('/address/bc1q/txs?max_txs=100000000&after_txid=ab')).toBe('/address/bc1q/txs?after_txid=ab');
    expect(stripMaxTxs('/address/bc1q/txs?max_txs=100000000')).toBe('/address/bc1q/txs');
    expect(stripMaxTxs('/addresses/txs?max%5Ftxs=9&x=1')).toBe('/addresses/txs?x=1');
    expect(stripMaxTxs('/address/bc1q?since=12345')).toBe('/address/bc1q?since=12345');
    expect(stripMaxTxs('/q?a=b%20c&d=e+f')).toBe('/q?a=b%20c&d=e+f');
    expect(stripMaxTxs('/blocks/tip/height')).toBe('/blocks/tip/height');
  });

  test('electrs receives the history request without max_txs', async () => {
    const electrs = await recordingElectrs();
    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));
    const { server, url } = await startServer(app);
    try {
      expect((await fetchText(`${url}/api/address/bc1q/txs?max_txs=100000000&after_txid=ab`)).status).toBe(200);
      expect(electrs.seen.map(s => s.url)).toEqual(['/address/bc1q/txs?after_txid=ab']);
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });

  test('a body of exactly the limit is forwarded whole; one byte more is 413 whether declared or chunked', async () => {
    const electrs = await recordingElectrs();
    const app = express();
    app.use('/api', createElectrsProxyMiddleware(electrs.url));
    const { server, url } = await startServer(app);
    try {
      const atLimit = Buffer.alloc(MAX_PROXIED_BODY_BYTES, 0x61);
      const overLimit = Buffer.alloc(MAX_PROXIED_BODY_BYTES + 1, 0x61);

      expect(await send(`${url}/api/tx`, 'POST', atLimit, false)).toBe(200);
      expect(await send(`${url}/api/tx`, 'POST', overLimit, false)).toBe(413);
      expect(await send(`${url}/api/tx`, 'POST', overLimit, true)).toBe(413);
      expect(await send(`${url}/api/tx`, 'POST', atLimit, true)).toBe(200);

      // Only the two at-limit bodies arrived, each complete.
      expect(electrs.seen).toEqual([
        { url: '/tx', bytes: MAX_PROXIED_BODY_BYTES },
        { url: '/tx', bytes: MAX_PROXIED_BODY_BYTES },
      ]);
    } finally {
      await close(server);
      await close(electrs.server);
    }
  });
});
