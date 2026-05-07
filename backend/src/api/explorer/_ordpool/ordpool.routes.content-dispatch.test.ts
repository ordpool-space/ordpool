import { Request, Response } from 'express';

import generalOrdpoolRoutes, { isBareTxid } from './ordpool.routes';
import ordpoolInscriptionsApi from './ordpool-inscriptions.api';
import { InscriptionPreviewService } from 'ordpool-parser';

// Same factory-mock pattern as ordpool.routes.test.ts: short-circuit the
// module-load chain so the suite boots without a real config file.
jest.mock('../../blocks', () => ({ __esModule: true, default: { getCurrentBlockHeight: jest.fn() } }));
jest.mock('../../ordpool-missing-stats', () => ({ __esModule: true, default: { getLastSuccessAt: jest.fn(), getBlocksPerMinute: jest.fn() } }));
jest.mock('../../../repositories/OrdpoolBlocksRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../../repositories/OrdpoolSkippedBlocksRepository', () => ({ __esModule: true, default: {} }));
jest.mock('./ordpool-inscriptions.api', () => ({
  __esModule: true,
  default: {
    $getInscriptionOrDelegeate: jest.fn(),
    $getFirstImageInscription: jest.fn(),
  },
}));
jest.mock('./ordpool-statistics.api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../config', () => ({
  __esModule: true,
  default: { MEMPOOL: { NETWORK: 'mainnet', API_URL_PREFIX: '/api/v1/' } },
}));

const TXID = '6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799';

function makeRes() {
  const res: Partial<Response> = {};
  res.setHeader = jest.fn();
  res.status = jest.fn().mockImplementation(() => res);
  res.json = jest.fn().mockImplementation(() => res);
  res.send = jest.fn().mockImplementation(() => res);
  return res as Response & { status: jest.Mock; send: jest.Mock; setHeader: jest.Mock };
}

function fakeInscription(): any {
  return {
    contentType: 'image/png',
    contentSize: 0,
    getContentEncoding: () => undefined,
    getDataRaw: () => new Uint8Array(),
    getDelegates: () => [],
  };
}

describe('isBareTxid', () => {
  it.each([
    ['64 lowercase hex chars', '6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799', true],
    ['64 uppercase hex chars', 'A'.repeat(64), true],
    ['64 mixed-case hex chars', 'aBcDeF12'.repeat(8), true],
    ['txid with i0 suffix', '6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i0', false],
    ['txid with i37 suffix', '6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i37', false],
    ['63 hex chars (one short)', 'a'.repeat(63), false],
    ['65 hex chars (one too many)', 'a'.repeat(65), false],
    ['64 chars with one non-hex letter', 'g' + 'a'.repeat(63), false],
    ['empty string', '', false],
    ['just an integer index', '0', false],
  ])('%s -> %s', (_label, value, expected) => {
    expect(isBareTxid(value)).toBe(expected);
  });
});

describe('getInscriptionContent route handler dispatch', () => {

  beforeEach(() => {
    jest.resetAllMocks();
    // The fragment shader / atlas test plan: bare txid path must reach
    // $getFirstImageInscription, full inscription-id path must reach the
    // existing $getInscriptionOrDelegeate. Each test verifies one branch.
  });

  it('routes a bare txid to $getFirstImageInscription', async () => {
    (ordpoolInscriptionsApi.$getFirstImageInscription as jest.Mock).mockResolvedValue(fakeInscription());
    const req = { params: { inscriptionId: TXID } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getInscriptionContent(req, res);

    expect(ordpoolInscriptionsApi.$getFirstImageInscription).toHaveBeenCalledWith(TXID);
    expect(ordpoolInscriptionsApi.$getInscriptionOrDelegeate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('routes a txid+iN to $getInscriptionOrDelegeate', async () => {
    (ordpoolInscriptionsApi.$getInscriptionOrDelegeate as jest.Mock).mockResolvedValue(fakeInscription());
    const req = { params: { inscriptionId: `${TXID}i0` } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getInscriptionContent(req, res);

    expect(ordpoolInscriptionsApi.$getInscriptionOrDelegeate).toHaveBeenCalledWith(`${TXID}i0`);
    expect(ordpoolInscriptionsApi.$getFirstImageInscription).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('routes txid+i37 to $getInscriptionOrDelegeate (multi-digit indices stay on the inscription path)', async () => {
    (ordpoolInscriptionsApi.$getInscriptionOrDelegeate as jest.Mock).mockResolvedValue(fakeInscription());
    const req = { params: { inscriptionId: `${TXID}i37` } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getInscriptionContent(req, res);

    expect(ordpoolInscriptionsApi.$getInscriptionOrDelegeate).toHaveBeenCalledWith(`${TXID}i37`);
    expect(ordpoolInscriptionsApi.$getFirstImageInscription).not.toHaveBeenCalled();
  });

  it('returns 404 when first-image lookup yields nothing', async () => {
    (ordpoolInscriptionsApi.$getFirstImageInscription as jest.Mock).mockResolvedValue(undefined);
    const req = { params: { inscriptionId: TXID } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getInscriptionContent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith('Transaction or inscription not found.');
  });

  it('returns 404 when inscription-id lookup yields nothing', async () => {
    (ordpoolInscriptionsApi.$getInscriptionOrDelegeate as jest.Mock).mockResolvedValue(undefined);
    const req = { params: { inscriptionId: `${TXID}i0` } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getInscriptionContent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 400 when no id is supplied at all', async () => {
    const req = { params: {} } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getInscriptionContent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(ordpoolInscriptionsApi.$getFirstImageInscription).not.toHaveBeenCalled();
    expect(ordpoolInscriptionsApi.$getInscriptionOrDelegeate).not.toHaveBeenCalled();
  });

  it('returns 500 when the resolver throws', async () => {
    (ordpoolInscriptionsApi.$getFirstImageInscription as jest.Mock).mockRejectedValue(new Error('boom'));
    const req = { params: { inscriptionId: TXID } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getInscriptionContent(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
