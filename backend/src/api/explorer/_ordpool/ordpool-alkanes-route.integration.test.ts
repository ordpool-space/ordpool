import express, { Application } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';

import {
  ALKANE_SELECTOR_NAME as SELECTOR_NAME,
  ALKANE_SELECTOR_SYMBOL as SELECTOR_SYMBOL,
  ALKANE_SELECTOR_TOTAL_SUPPLY as SELECTOR_TOTAL_SUPPLY,
} from 'ordpool-parser';

/**
 * Real-assembly integration proof for GET /api/v1/ordpool/alkanes/:block/:tx.
 *
 * The existing unit test (`ordpool-alkanes-metadata.test.ts`) proves the leaf
 * decoder `decodeSimulateData` against real captured `alkanes_simulate`
 * responses — but nothing exercised the SERVICE (`$getAlkaneMetadata`) or the
 * ROUTE: the RPC fan-out → assemble `{name,symbol,totalSupply}` → emit the JSON
 * row was untested end-to-end. That is precisely the incident class the
 * maintainer's edict targets: a dependency mock returning an invented shape
 * instead of the real RPC wire contract.
 *
 * Here the ONLY mocks are IO boundaries: the DB repository (`$getByAlkaneId`
 * cache miss, `$upsert` no-op) and the RPC transport (`fetchWithTimeout`), and
 * the transport returns the REAL captured `alkanes_simulate` JSON from
 * backend/testdata/alkanes (in-repo, so the ordpool-only CI checkout is
 * self-contained). Everything else is the REAL `AlkanesMetadataService`:
 * `$fetchFromRpcs`, `$callSimulate`, and the real `decodeSimulateData`.
 *
 * `totalSupply` is NOT hard-coded (it grows on every mint): it's asserted
 * against an INDEPENDENT stdlib little-endian u128 decoder over the same
 * captured hex — two decoders agreeing verifies the value, mirroring the unit
 * test's cross-check. name/symbol are immutable per-contract literals.
 */
jest.mock('../../../config', () => ({
  __esModule: true,
  default: { MEMPOOL: { NETWORK: 'mainnet', API_URL_PREFIX: '/api/v1/' }, HIDDEN: { INSCRIPTIONS: [] } },
}));
jest.mock('../../blocks', () => ({ __esModule: true, default: { getCurrentBlockHeight: jest.fn() } }));
jest.mock('../../ordpool-missing-stats', () => ({ __esModule: true, default: { getLastSuccessAt: jest.fn(), getBlocksPerMinute: jest.fn() } }));
jest.mock('../../bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: { $getRawTransaction: jest.fn(), $getBlockHash: jest.fn() } }));
jest.mock('../../mempool', () => ({ __esModule: true, default: { getMempool: jest.fn(() => ({})) } }));
jest.mock('../../../repositories/OrdpoolBlocksRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../../repositories/OrdpoolSkippedBlocksRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../../repositories/OrdpoolOtsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('./ordpool-stamps.api', () => ({ __esModule: true, default: { $getStamp: jest.fn() } }));
jest.mock('./ordpool-atomicals.api', () => ({ __esModule: true, default: { $getFirstAtomicalImage: jest.fn() } }));
jest.mock('./ordpool-inscriptions.api', () => ({ __esModule: true, default: { $getInscriptionOrDelegeate: jest.fn() } }));
jest.mock('./ordpool-statistics.api', () => ({ __esModule: true, default: {} }));

// IO boundaries of the SUT (AlkanesMetadataService), mocked. The service itself
// is REAL — this is the whole point.
jest.mock('../../../repositories/AlkaneMetadataRepository', () => ({
  __esModule: true,
  default: { $getByAlkaneId: jest.fn(async () => null), $upsert: jest.fn(async () => undefined) },
}));
jest.mock('./alkanes-rpc-config', () => ({
  __esModule: true,
  getAlkanesRpcConfig: jest.fn(() => ({ urls: ['http://alkanes.test/rpc'], timeoutMs: 5000, negativeCacheMs: 3_600_000 })),
}));
jest.mock('../../ordpool-fetch', () => ({ __esModule: true, fetchWithTimeout: jest.fn() }));

import generalOrdpoolRoutes from './ordpool.routes';
import { fetchWithTimeout } from '../../ordpool-fetch';
import AlkaneMetadataRepository from '../../../repositories/AlkaneMetadataRepository';

const ALK_DIR = path.resolve(__dirname, '../../../../testdata/alkanes');

// Map the on-chain alkane id encoded in the request body to its fixture dir.
const DIR_BY_ID: Record<string, string> = {
  '2:0': '2_0_diesel',
  '999999:999999': '999999_999999_unknown',
};
// Map the request's selector (body.id) to the captured-response filename stem.
const LABEL_BY_SELECTOR: Record<number, string> = {
  [SELECTOR_NAME]: '99_name',
  [SELECTOR_SYMBOL]: '100_symbol',
  [SELECTOR_TOTAL_SUPPLY]: '101_total_supply',
};

const loadFixture = (dir: string, label: string) =>
  JSON.parse(fs.readFileSync(path.join(ALK_DIR, dir, `${label}_subfrost.json`), 'utf8'));

// Independent (stdlib) little-endian u128 decoder — a DIFFERENT implementation
// from the production hand-rolled BigInt loop, so agreement verifies the value
// without hard-coding a (mint-mutable) number. Same reference the unit test uses.
function referenceDecodeU128LE(hex: string): bigint {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  const buf = Buffer.alloc(16);
  Buffer.from(stripped, 'hex').copy(buf, 0, 0, Math.min(16, stripped.length / 2));
  return (buf.readBigUInt64LE(8) << 64n) | buf.readBigUInt64LE(0);
}

describe('backend GET /api/v1/ordpool/alkanes/:block/:tx: real RPC-assembly over HTTP', () => {
  let app: Application;

  beforeAll(() => {
    // sanity: the captured wire fixtures must exist, or the "real assembly" claim is a lie
    expect(fs.existsSync(path.join(ALK_DIR, '2_0_diesel', '99_name_subfrost.json'))).toBe(true);

    app = express();
    generalOrdpoolRoutes.initRoutes(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AlkaneMetadataRepository.$getByAlkaneId as jest.Mock).mockResolvedValue(null);
    // Route each simulate call to the captured response for that alkane id + selector.
    (fetchWithTimeout as jest.Mock).mockImplementation(async (_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body);
      const dir = DIR_BY_ID[`${body.params[0].target.block}:${body.params[0].target.tx}`];
      const fixture = loadFixture(dir, LABEL_BY_SELECTOR[body.id]);
      return { ok: true, status: 200, json: async () => fixture };
    });
  });

  it('assembles DIESEL (2:0) from the REAL captured alkanes_simulate responses', async () => {
    const res = await request(app).get('/api/v1/ordpool/alkanes/2/0');

    expect(res.status).toBe(200);
    expect(res.body.alkaneId).toBe('2:0');
    expect(res.body.block).toBe('2');
    expect(res.body.tx).toBe('0');
    expect(res.body.name).toBe('DIESEL');     // immutable per-contract literal
    expect(res.body.symbol).toBe('DIESEL');
    // totalSupply verified by an independent decoder over the same captured hex
    const supplyHex = loadFixture('2_0_diesel', '101_total_supply').result.execution.data;
    expect(res.body.totalSupply).toBe(referenceDecodeU128LE(supplyHex).toString());
    expect(res.body.lastError).toBeNull();
    expect(typeof res.body.fetchedAt).toBe('string');
    expect(new Date(res.body.fetchedAt).toISOString()).toBe(res.body.fetchedAt);
    // the real service fanned out one call per selector (name/symbol/total_supply)
    expect(fetchWithTimeout).toHaveBeenCalledTimes(3);
    // and it persisted the resolved row to the cache
    expect(AlkaneMetadataRepository.$upsert).toHaveBeenCalledTimes(1);
  });

  it('degrades to null fields + a lastError for a non-existent alkane (all selectors return 0x)', async () => {
    const res = await request(app).get('/api/v1/ordpool/alkanes/999999/999999');

    expect(res.status).toBe(200);
    expect(res.body.alkaneId).toBe('999999:999999');
    expect(res.body.name).toBeNull();
    expect(res.body.symbol).toBeNull();
    expect(res.body.totalSupply).toBeNull();
    expect(typeof res.body.lastError).toBe('string');
    expect(res.body.lastError.length).toBeGreaterThan(0);
  });

  it('serves a fresh cached row WITHOUT any RPC call (DB fast path)', async () => {
    const supplyHex = loadFixture('2_0_diesel', '101_total_supply').result.execution.data;
    (AlkaneMetadataRepository.$getByAlkaneId as jest.Mock).mockResolvedValueOnce({
      alkaneId: '2:0',
      name: 'DIESEL',
      symbol: 'DIESEL',
      totalSupply: referenceDecodeU128LE(supplyHex).toString(),
      fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastError: null,
      fetchAttempts: 1,
    });

    const res = await request(app).get('/api/v1/ordpool/alkanes/2/0');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('DIESEL');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
    expect(AlkaneMetadataRepository.$upsert).not.toHaveBeenCalled();
  });

  it('rejects a non-integer alkane id with 400 before any RPC/DB work', async () => {
    const res = await request(app).get('/api/v1/ordpool/alkanes/abc/0');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid alkane id');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
    expect(AlkaneMetadataRepository.$getByAlkaneId).not.toHaveBeenCalled();
  });
});
