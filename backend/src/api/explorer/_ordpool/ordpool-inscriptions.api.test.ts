import { InscriptionParserService } from 'ordpool-parser';

import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import memPool from '../../mempool';
import ordpoolInscriptionsApi from './ordpool-inscriptions.api';

// Factory mocks short-circuit the module-load chain so the suite boots
// without a real mempool-config.json. Each transitively-loaded module
// (bitcoin-client.ts, database.ts, ...) reads config at the top, so we
// stub the ones we care about by hand instead of letting jest auto-mock
// load the real files.
jest.mock('../../bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: { $getRawTransaction: jest.fn() },
}));
jest.mock('../../mempool', () => ({
  __esModule: true,
  default: { getMempool: jest.fn() },
}));
// Synthetic ParsedInscription shape — only the fields the API code under
// test reads. Tests for $getFirstImageInscription install
// jest.spyOn(InscriptionParserService, 'parse') and hand-craft these.
function fakeInscription(overrides: { contentType?: string; delegates?: string[] } = {}): any {
  return {
    contentType: overrides.contentType,
    getDelegates: () => overrides.delegates || [],
    contentSize: 0,
    getContentEncoding: () => undefined,
    getDataRaw: () => new Uint8Array(),
  };
}

// Real mainnet txid (image/png inscription); used here for shape only,
// the parser sees a stub transaction we hand it via the mocked bitcoinApi.
const VALID_TXID = '6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799';
const VALID_INSCRIPTION_ID = `${VALID_TXID}i0`;

describe('OrdpoolInscriptionsApi.$getInscriptionById call shape', () => {

  beforeEach(() => {
    jest.resetAllMocks();
    (memPool.getMempool as jest.Mock).mockReturnValue({});
    (bitcoinApi.$getRawTransaction as jest.Mock).mockResolvedValue({
      txid: VALID_TXID,
      vin: [{ witness: [], scriptsig: '' }],
      vout: [{ scriptpubkey: '', value: 0 }],
    });
  });

  it('calls $getRawTransaction with skipConversion=false so the parser sees Esplora shape', async () => {
    // The bug: skipConversion=true left the bitcoind RPC shape
    // (vin[].txinwitness, scriptSig as object) un-converted. The parser
    // reads vin[].witness and silently returned [], so every confirmed-tx
    // /preview / /content lookup that fell through to the RPC fetch path
    // 404'd. Guard the call shape so the regression can't sneak back.
    await (ordpoolInscriptionsApi as any).$getInscriptionById(VALID_INSCRIPTION_ID);

    expect(bitcoinApi.$getRawTransaction).toHaveBeenCalledTimes(1);
    const args = (bitcoinApi.$getRawTransaction as jest.Mock).mock.calls[0];
    expect(args[0]).toBe(VALID_TXID);
    expect(args[1]).toBe(false); // skipConversion MUST be false
    expect(args[2]).toBe(false); // addPrevout
    expect(args[3]).toBe(false); // lazyPrevouts
  });

  it('skips the bitcoin API call when the transaction is already in the mempool', async () => {
    // Mempool entries are already stored in Esplora shape, so bypassing
    // the RPC fetch is fine; this branch was never affected by the bug.
    (memPool.getMempool as jest.Mock).mockReturnValue({
      [VALID_TXID]: {
        txid: VALID_TXID,
        vin: [{ witness: [], scriptsig: '' }],
        vout: [{ scriptpubkey: '', value: 0 }],
      },
    });

    await (ordpoolInscriptionsApi as any).$getInscriptionById(VALID_INSCRIPTION_ID);

    expect(bitcoinApi.$getRawTransaction).not.toHaveBeenCalled();
  });

  it('returns undefined for a 404 from the bitcoin API (tx not found on chain)', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockRejectedValue(
      Object.assign(new Error('not found'), { response: { status: 404 } }),
    );

    const result = await (ordpoolInscriptionsApi as any).$getInscriptionById(VALID_INSCRIPTION_ID);

    expect(result).toBeUndefined();
  });

  it('rethrows non-404 errors from the bitcoin API', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockRejectedValue(new Error('connection refused'));

    await expect(
      (ordpoolInscriptionsApi as any).$getInscriptionById(VALID_INSCRIPTION_ID),
    ).rejects.toThrow('connection refused');
  });
});

describe('OrdpoolInscriptionsApi.$getFirstImageInscription', () => {

  let parseSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    parseSpy = jest.spyOn(InscriptionParserService, 'parse');
    (memPool.getMempool as jest.Mock).mockReturnValue({});
    (bitcoinApi.$getRawTransaction as jest.Mock).mockResolvedValue({
      txid: VALID_TXID,
      vin: [{ witness: [], scriptsig: '' }],
      vout: [{ scriptpubkey: '', value: 0 }],
    });
  });

  afterEach(() => {
    parseSpy.mockRestore();
  });

  it('returns the only inscription when the tx has a single image', async () => {
    const image = fakeInscription({ contentType: 'image/png' });
    parseSpy.mockReturnValue([image]);

    const result = await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);

    expect(result).toBe(image);
  });

  it('skips a JSON inscription at index 0 and returns the image at index 1', async () => {
    // Batch reveal: the parser sets ordpool_inscription_image because index 1
    // is image/png, but a flat /content/<txid>i0 lookup hits the JSON. The
    // first-image resolver is the fix.
    const json = fakeInscription({ contentType: 'application/json' });
    const image = fakeInscription({ contentType: 'image/webp' });
    parseSpy.mockReturnValue([json, image]);

    const result = await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);

    expect(result).toBe(image);
  });

  it('skips text and JSON to return the image at index 2', async () => {
    const text = fakeInscription({ contentType: 'text/plain' });
    const json = fakeInscription({ contentType: 'application/json' });
    const image = fakeInscription({ contentType: 'image/gif' });
    parseSpy.mockReturnValue([text, json, image]);

    const result = await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);

    expect(result).toBe(image);
  });

  it('returns the FIRST image when multiple images are present', async () => {
    const a = fakeInscription({ contentType: 'image/jpeg' });
    const b = fakeInscription({ contentType: 'image/png' });
    parseSpy.mockReturnValue([a, b]);

    const result = await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);

    expect(result).toBe(a);
  });

  it('matches every common image MIME variant we serve', async () => {
    for (const contentType of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif']) {
      const ins = fakeInscription({ contentType });
      parseSpy.mockReturnValue([ins]);
      const result = await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);
      expect(result).toBe(ins);
    }
  });

  it('does NOT match non-image content types', async () => {
    for (const contentType of ['application/json', 'text/plain', 'text/html', 'application/octet-stream', 'video/mp4', 'audio/mpeg']) {
      const ins = fakeInscription({ contentType });
      parseSpy.mockReturnValue([ins]);
      const result = await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);
      expect(result).toBeUndefined();
    }
  });

  it('treats inscriptions with no contentType (delegate stubs) as non-image', async () => {
    const stub = fakeInscription({ contentType: undefined });
    parseSpy.mockReturnValue([stub]);

    const result = await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the tx contains no inscriptions at all', async () => {
    parseSpy.mockReturnValue([]);

    const result = await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the tx is not on chain (bitcoin API 404)', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockRejectedValue(
      Object.assign(new Error('not found'), { response: { status: 404 } }),
    );

    const result = await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);

    expect(result).toBeUndefined();
  });

  it('rethrows non-404 errors from the bitcoin API', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockRejectedValue(new Error('connection refused'));

    await expect(
      ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID),
    ).rejects.toThrow('connection refused');
  });

  it('uses the mempool entry when present and skips the bitcoin API', async () => {
    const mempoolTx = { txid: VALID_TXID, vin: [{ witness: [], scriptsig: '' }], vout: [] };
    (memPool.getMempool as jest.Mock).mockReturnValue({ [VALID_TXID]: mempoolTx });
    const image = fakeInscription({ contentType: 'image/png' });
    parseSpy.mockReturnValue([image]);

    const result = await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);

    expect(bitcoinApi.$getRawTransaction).not.toHaveBeenCalled();
    expect(parseSpy).toHaveBeenCalledWith(mempoolTx);
    expect(result).toBe(image);
  });

  it('resolves a delegate when the first image points at one', async () => {
    // The image we find has a delegate; the resolver should chase it via the
    // existing $getInscriptionOrDelegeate path and return the delegate's
    // inscription. We mock that downstream call directly to keep the test
    // focused on the delegate-handoff edge.
    const imageWithDelegate = fakeInscription({
      contentType: 'image/png',
      delegates: ['aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111i0'],
    });
    parseSpy.mockReturnValue([imageWithDelegate]);

    const delegated = fakeInscription({ contentType: 'image/svg+xml' });
    const delegateSpy = jest
      .spyOn(ordpoolInscriptionsApi, '$getInscriptionOrDelegeate')
      .mockResolvedValue(delegated as any);

    const result = await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);

    expect(delegateSpy).toHaveBeenCalledWith(
      'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111i0',
      1, // recursive level incremented
    );
    expect(result).toBe(delegated);
    delegateSpy.mockRestore();
  });

  it('throws after 4 levels of delegate recursion', async () => {
    const looping = fakeInscription({
      contentType: 'image/png',
      delegates: ['bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222i0'],
    });
    parseSpy.mockReturnValue([looping]);

    await expect(
      ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID, 5),
    ).rejects.toThrow('Too many delegate levels');
  });

  it('passes skipConversion=false to the bitcoin API (Esplora-shape conversion regression guard)', async () => {
    const image = fakeInscription({ contentType: 'image/png' });
    parseSpy.mockReturnValue([image]);

    await ordpoolInscriptionsApi.$getFirstImageInscription(VALID_TXID);

    expect(bitcoinApi.$getRawTransaction).toHaveBeenCalledTimes(1);
    const args = (bitcoinApi.$getRawTransaction as jest.Mock).mock.calls[0];
    expect(args[0]).toBe(VALID_TXID);
    expect(args[1]).toBe(false); // skipConversion MUST be false
  });
});
