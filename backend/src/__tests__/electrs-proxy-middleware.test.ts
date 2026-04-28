import express, { Express } from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import { createElectrsProxyMiddleware } from '../electrs-proxy-middleware';

jest.mock('../logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), err: jest.fn(), debug: jest.fn() },
}));

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
