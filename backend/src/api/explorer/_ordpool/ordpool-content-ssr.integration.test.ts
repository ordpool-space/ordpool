import express, { Application } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';

/**
 * Real-infra integration proof for the /content + /preview SSR path.
 *
 * The unit test (`ordpool.routes.content-dispatch.test.ts`) mocks
 * `InscriptionParserService.parse` to exercise the route's dispatch / hidden-gate
 * / delegate logic. This spec proves the OTHER half the maintainer's edict
 * demands: that the real route, over real HTTP, decodes a REAL captured
 * transaction with the REAL parser and serves the exact inscription bytes with
 * the correct content-type + Content-Security-Policy.
 *
 * The ONLY mock is the tx-fetch IO boundary (`bitcoinApi.$getRawTransaction`),
 * and it returns a REAL captured esplora transaction from ordpool-parser's
 * testdata — a faithful capture of the dependency's wire contract, the allowed
 * kind of mock, never an invented shape. Everything below the fetch is real:
 * `$fetchTxByTxid`, `InscriptionParserService.parse`, the route handler, the
 * header writing, and the served bytes.
 */

// Boot the routes without a real mempool-config.json (same module-load-chain
// short-circuit as content-dispatch.test), but keep ordpool-inscriptions.api
// REAL so the real decode runs. `bitcoin-api-factory` is mocked at the
// $getRawTransaction boundary; `mempool` returns an empty pool so the fetch
// falls through to that boundary.
const HIDDEN_TXID = 'f'.repeat(64);
jest.mock('../../blocks', () => ({ __esModule: true, default: { getCurrentBlockHeight: jest.fn() } }));
jest.mock('../../ordpool-missing-stats', () => ({ __esModule: true, default: { getLastSuccessAt: jest.fn(), getBlocksPerMinute: jest.fn() } }));
jest.mock('../../ordpool-alkanes-metadata', () => ({ __esModule: true, default: { $getAlkaneMetadata: jest.fn() } }));
jest.mock('../../bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: { $getRawTransaction: jest.fn(), $getBlockHash: jest.fn() } }));
jest.mock('../../mempool', () => ({ __esModule: true, default: { getMempool: jest.fn(() => ({})) } }));
jest.mock('../../../repositories/OrdpoolBlocksRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../../repositories/OrdpoolSkippedBlocksRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../../repositories/OrdpoolOtsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('./ordpool-stamps.api', () => ({ __esModule: true, default: { $getStamp: jest.fn() } }));
jest.mock('./ordpool-atomicals.api', () => ({ __esModule: true, default: { $getFirstAtomicalImage: jest.fn() } }));
jest.mock('./ordpool-statistics.api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../config', () => ({
  __esModule: true,
  default: { MEMPOOL: { NETWORK: 'mainnet', API_URL_PREFIX: '/api/v1/' }, HIDDEN: { INSCRIPTIONS: ['f'.repeat(64)] } },
}));

import generalOrdpoolRoutes from './ordpool.routes';
import bitcoinApi from '../../bitcoin/bitcoin-api-factory';

// A real mainnet reveal (plain text/plain inscription, no content-encoding) so
// the served bytes equal the decoded content byte-for-byte. The fixture pair
// (input tx + known-good decoded content, captured from ordpool-parser's
// testdata) is vendored into __fixtures__ so the test is self-contained: in CI
// ordpool-parser is an installed npm dependency, not a workspace sibling.
const TESTDATA = path.resolve(__dirname, '__fixtures__');
const TXID = '430901147831e41111aced3895ee4b9742cf72ac3cffa132624bd38c551ef379';
const INSCRIPTION_ID = `${TXID}i0`;
const CSP = "default-src 'self' https://ordinals.com 'unsafe-eval' 'unsafe-inline' data: blob:";

const realTx = () => JSON.parse(fs.readFileSync(path.join(TESTDATA, `tx_${TXID}.json`), 'utf8'));
const expectedBytes = () => fs.readFileSync(path.join(TESTDATA, `inscription_${INSCRIPTION_ID}.txt`));

// Collect the raw response body as a Buffer for a byte-exact comparison
// (supertest's default text/json parsers would lose the exact bytes).
function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('backend /content + /preview SSR: real decode + serve over HTTP', () => {
  let app: Application;

  beforeAll(() => {
    // sanity: the fixtures must exist, or the "real decode" claim is a lie
    expect(fs.existsSync(path.join(TESTDATA, `tx_${TXID}.json`))).toBe(true);
    expect(expectedBytes().length).toBe(10);

    app = express();
    generalOrdpoolRoutes.initRoutes(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (bitcoinApi.$getRawTransaction as jest.Mock).mockResolvedValue(realTx());
  });

  it('/content: decodes a REAL captured tx and serves the EXACT inscription bytes + content-type + CSP', async () => {
    const res = await request(app).get(`/content/${INSCRIPTION_ID}`).buffer(true).parse(binaryParser as any);

    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/plain');
    expect(res.headers['content-security-policy']).toBe(CSP);
    // byte-exact: the real parser produced the right content, the route served it faithfully
    expect(res.body).toEqual(expectedBytes());
    // the fetch really happened at the esplora (skipConversion=false) boundary
    expect(bitcoinApi.$getRawTransaction).toHaveBeenCalledWith(TXID, false, false, false);
  });

  it('/preview: serves the sandbox-ready HTML wrapper for the same real inscription with content-type + CSP', async () => {
    const res = await request(app).get(`/preview/${INSCRIPTION_ID}`);

    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/html');
    expect(res.headers['content-security-policy']).toBe(CSP);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('/content: refuses a hidden inscription with 451 BEFORE any tx fetch', async () => {
    const res = await request(app).get(`/content/${HIDDEN_TXID}i0`);

    expect(res.status).toBe(451);
    expect(bitcoinApi.$getRawTransaction).not.toHaveBeenCalled();
  });

  it('/content: 404 when the tx carries no inscription / is unknown', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).get(`/content/${'a'.repeat(64)}i0`);

    expect(res.status).toBe(404);
  });
});
