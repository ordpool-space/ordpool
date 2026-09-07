import express, { Application } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';

/**
 * Real-infra integration proof for the /stamp-content + /atomical-content SSR
 * paths — the sibling of `ordpool-content-ssr.integration.test.ts` for the
 * two other content surfaces the ordpool backend serves.
 *
 * The unit tests (`ordpool.routes.content-dispatch.test.ts`,
 * `ordpool-stamps.api.test.ts`, `ordpool-atomicals.api.test.ts`) mock the
 * parser and assert against a HAND-WRITTEN fake shape (`fakeStamp.getDataRaw`,
 * an invented `fakeFile`). That proves the route's dispatch / hidden-gate logic
 * but NOT that a real captured stamp / atomical decodes to the exact bytes the
 * route serves — the precise blind spot the maintainer's edict targets after a
 * mock returning an invented shape hid a bug.
 *
 * Here the ONLY mock is the tx-fetch IO boundary
 * (`bitcoinApi.$getRawTransaction`), and it returns a REAL captured mainnet
 * transaction from ordpool-parser's testdata (vendored into __fixtures__ so the
 * ordpool-only CI checkout is self-contained). Everything below the fetch is
 * real: `$fetchTxByTxid`, the REAL `StampParserService.parse` /
 * `AtomicalParserService.parse`, the route handler, the header writing, and the
 * served bytes. The byte-exact assertion is against the same decoded reference
 * the parser's own specs pin.
 */
const HIDDEN_TXID = 'f'.repeat(64);
jest.mock('../../blocks', () => ({ __esModule: true, default: { getCurrentBlockHeight: jest.fn() } }));
jest.mock('../../ordpool-missing-stats', () => ({ __esModule: true, default: { getLastSuccessAt: jest.fn(), getBlocksPerMinute: jest.fn() } }));
jest.mock('../../ordpool-alkanes-metadata', () => ({ __esModule: true, default: { $getAlkaneMetadata: jest.fn() } }));
jest.mock('../../bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: { $getRawTransaction: jest.fn(), $getBlockHash: jest.fn() } }));
jest.mock('../../mempool', () => ({ __esModule: true, default: { getMempool: jest.fn(() => ({})) } }));
jest.mock('../../../repositories/OrdpoolBlocksRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../../repositories/OrdpoolSkippedBlocksRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../../repositories/OrdpoolOtsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('./ordpool-statistics.api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../config', () => ({
  __esModule: true,
  default: { MEMPOOL: { NETWORK: 'mainnet', API_URL_PREFIX: '/api/v1/' }, HIDDEN: { INSCRIPTIONS: ['f'.repeat(64)] } },
}));
// ordpool-stamps.api + ordpool-atomicals.api are intentionally NOT mocked here:
// they ARE the real decode path under test. They run the real ordpool-parser
// (StampParserService / AtomicalParserService) over the tx returned by the
// mocked fetch boundary.

import generalOrdpoolRoutes from './ordpool.routes';
import bitcoinApi from '../../bitcoin/bitcoin-api-factory';

const FIX = path.resolve(__dirname, '__fixtures__');
const CSP = "default-src 'self' https://ordinals.com 'unsafe-eval' 'unsafe-inline' data: blob:";

// Stamp #1383565 — PNG pixel art, OLGA P2WSH encoding, 1393 bytes decoded.
const STAMP_PNG_TXID = '516e62beeffb26fb37f8e95e809274e5bbde76eb75a28357f6bbcd4eedbfe8ca';
// Atomical DFT ("ATOM") — first image file is a PNG, 8496 bytes decoded.
const ATOMICAL_TXID = '1d2f39f54320631d0432fa495a45a4f298a2ca1b18adef8e4356e327d003a694';

const readTx = (txid: string) => JSON.parse(fs.readFileSync(path.join(FIX, `tx_${txid}.json`), 'utf8'));
const stampBytes = () => fs.readFileSync(path.join(FIX, 'stamp_1383565_image.png'));
const atomicalBytes = () => fs.readFileSync(path.join(FIX, 'atomical_dft_atom_image.png'));

// Collect the raw response body as a Buffer for a byte-exact comparison
// (supertest's default text/json parsers would lose the exact bytes).
function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('backend /stamp-content + /atomical-content SSR: real decode + serve over HTTP', () => {
  let app: Application;

  beforeAll(() => {
    // sanity: the fixtures must exist, or the "real decode" claim is a lie
    expect(fs.existsSync(path.join(FIX, `tx_${STAMP_PNG_TXID}.json`))).toBe(true);
    expect(fs.existsSync(path.join(FIX, `tx_${ATOMICAL_TXID}.json`))).toBe(true);
    expect(stampBytes().length).toBe(1393);
    expect(atomicalBytes().length).toBe(8496);

    app = express();
    generalOrdpoolRoutes.initRoutes(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('/stamp-content: decodes a REAL captured stamp tx and serves the EXACT image bytes + content-type + CSP', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockResolvedValue(readTx(STAMP_PNG_TXID));
    const res = await request(app).get(`/stamp-content/${STAMP_PNG_TXID}`).buffer(true).parse(binaryParser as any);

    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('image/png');
    expect(res.headers['content-security-policy']).toBe(CSP);
    // byte-exact: the real StampParserService decoded the OLGA P2WSH outputs and
    // the route served the reconstructed PNG faithfully
    expect(res.body).toEqual(stampBytes());
    expect(bitcoinApi.$getRawTransaction).toHaveBeenCalledWith(STAMP_PNG_TXID, false, false, false);
  });

  it('/stamp-content: refuses a hidden tx with 451 BEFORE any tx fetch', async () => {
    const res = await request(app).get(`/stamp-content/${HIDDEN_TXID}`);

    expect(res.status).toBe(451);
    expect(bitcoinApi.$getRawTransaction).not.toHaveBeenCalled();
  });

  it('/stamp-content: 404 when the tx carries no stamp / is unknown', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).get(`/stamp-content/${'a'.repeat(64)}`);

    expect(res.status).toBe(404);
  });

  it('/stamp-content: 400 on an invalid txid (no fetch)', async () => {
    const res = await request(app).get('/stamp-content/not-a-valid-txid');

    expect(res.status).toBe(400);
    expect(bitcoinApi.$getRawTransaction).not.toHaveBeenCalled();
  });

  it('/atomical-content: decodes a REAL captured atomical tx and serves the EXACT first-image bytes + content-type + CSP', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockResolvedValue(readTx(ATOMICAL_TXID));
    const res = await request(app).get(`/atomical-content/${ATOMICAL_TXID}`).buffer(true).parse(binaryParser as any);

    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('image/png');
    expect(res.headers['content-security-policy']).toBe(CSP);
    // byte-exact: the real AtomicalParserService CBOR-decoded the files and the
    // route served the first image-MIME file faithfully
    expect(res.body).toEqual(atomicalBytes());
    expect(bitcoinApi.$getRawTransaction).toHaveBeenCalledWith(ATOMICAL_TXID, false, false, false);
  });

  it('/atomical-content: refuses a hidden tx with 451 BEFORE any tx fetch', async () => {
    const res = await request(app).get(`/atomical-content/${HIDDEN_TXID}`);

    expect(res.status).toBe(451);
    expect(bitcoinApi.$getRawTransaction).not.toHaveBeenCalled();
  });

  it('/atomical-content: 404 when the tx carries no image-bearing file / is unknown', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).get(`/atomical-content/${'a'.repeat(64)}`);

    expect(res.status).toBe(404);
  });
});
