import express, { Express } from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import { createElectrsProxyMiddleware } from '../electrs-proxy-middleware';

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
