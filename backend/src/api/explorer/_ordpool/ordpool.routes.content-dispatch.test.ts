import { Request, Response } from 'express';

import generalOrdpoolRoutes from './ordpool.routes';
import ordpoolInscriptionsApi from './ordpool-inscriptions.api';
import ordpoolStampsApi from './ordpool-stamps.api';
import ordpoolAtomicalsApi from './ordpool-atomicals.api';
import { DigitalArtifactType } from 'ordpool-parser';

// Same factory-mock pattern as ordpool.routes.test.ts: short-circuit the
// module-load chain so the suite boots without a real config file.
jest.mock('../../blocks', () => ({ __esModule: true, default: { getCurrentBlockHeight: jest.fn() } }));
jest.mock('../../ordpool-missing-stats', () => ({ __esModule: true, default: { getLastSuccessAt: jest.fn(), getBlocksPerMinute: jest.fn() } }));
jest.mock('../../ordpool-alkanes-metadata', () => ({ __esModule: true, default: { $getAlkaneMetadata: jest.fn() } }));
jest.mock('../../bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: { $getBlockHash: jest.fn() } }));
jest.mock('../../../repositories/OrdpoolBlocksRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../../repositories/OrdpoolSkippedBlocksRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../../../repositories/OrdpoolOtsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('./ordpool-inscriptions.api', () => ({
  __esModule: true,
  default: {
    $getInscriptionOrDelegeate: jest.fn(),
    $getFirstImageInscription: jest.fn(),
  },
}));
jest.mock('./ordpool-stamps.api', () => ({ __esModule: true, default: { $getStamp: jest.fn() } }));
jest.mock('./ordpool-atomicals.api', () => ({ __esModule: true, default: { $getFirstAtomicalImage: jest.fn() } }));
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

describe('getInscriptionContent route handler dispatch', () => {
  // isValidTxid lives in ordpool-parser and has its own dedicated unit test in
  // inscription-parser.service.helper.spec.ts. Here we verify the route handler
  // dispatches on it correctly.

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

describe('getStampContent route handler', () => {

  const fakeStamp: any = {
    type: DigitalArtifactType.Stamp,
    contentType: 'image/png',
    contentSize: 4,
    getDataRaw: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    getContent: () => '',
    getDataUri: () => 'data:image/png;base64,...',
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('serves the stamp bytes with its content-type when found', async () => {
    (ordpoolStampsApi.$getStamp as jest.Mock).mockResolvedValue(fakeStamp);
    const req = { params: { txid: TXID } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getStampContent(req, res);

    expect(ordpoolStampsApi.$getStamp).toHaveBeenCalledWith(TXID);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 4);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 for an invalid txid', async () => {
    const req = { params: { txid: 'not-a-txid' } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getStampContent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(ordpoolStampsApi.$getStamp).not.toHaveBeenCalled();
  });

  it('returns 400 for an inscription-shaped id (must be bare txid)', async () => {
    const req = { params: { txid: `${TXID}i0` } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getStampContent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(ordpoolStampsApi.$getStamp).not.toHaveBeenCalled();
  });

  it('returns 404 when the txid carries no stamp', async () => {
    (ordpoolStampsApi.$getStamp as jest.Mock).mockResolvedValue(undefined);
    const req = { params: { txid: TXID } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getStampContent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 when the resolver throws', async () => {
    (ordpoolStampsApi.$getStamp as jest.Mock).mockRejectedValue(new Error('boom'));
    const req = { params: { txid: TXID } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getStampContent(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('getAtomicalContent route handler', () => {

  const fakeFile: any = {
    name: 'image.png',
    contentType: 'image/png',
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    getContent: () => '',
    getData: () => '',
    getDataUri: () => 'data:image/png;base64,...',
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('serves the first image-bearing file when one is found', async () => {
    (ordpoolAtomicalsApi.$getFirstAtomicalImage as jest.Mock).mockResolvedValue(fakeFile);
    const req = { params: { txid: TXID } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getAtomicalContent(req, res);

    expect(ordpoolAtomicalsApi.$getFirstAtomicalImage).toHaveBeenCalledWith(TXID);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 4);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 for an invalid txid', async () => {
    const req = { params: { txid: 'nope' } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getAtomicalContent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(ordpoolAtomicalsApi.$getFirstAtomicalImage).not.toHaveBeenCalled();
  });

  it('returns 404 when no image-bearing file exists in the atomical', async () => {
    (ordpoolAtomicalsApi.$getFirstAtomicalImage as jest.Mock).mockResolvedValue(undefined);
    const req = { params: { txid: TXID } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getAtomicalContent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 when the resolver throws', async () => {
    (ordpoolAtomicalsApi.$getFirstAtomicalImage as jest.Mock).mockRejectedValue(new Error('boom'));
    const req = { params: { txid: TXID } } as unknown as Request;
    const res = makeRes();

    await (generalOrdpoolRoutes as any).getAtomicalContent(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
