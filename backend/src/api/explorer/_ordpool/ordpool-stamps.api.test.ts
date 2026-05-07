import { DigitalArtifactType, StampParserService } from 'ordpool-parser';

import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import memPool from '../../mempool';
import ordpoolStampsApi from './ordpool-stamps.api';

jest.mock('../../bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: { $getRawTransaction: jest.fn() },
}));
jest.mock('../../mempool', () => ({
  __esModule: true,
  default: { getMempool: jest.fn() },
}));

const TXID = '516e62beeffb26fb37f8e95e809274e5bbde76eb75a28357f6bbcd4eedbfe8ca';

describe('OrdpoolStampsApi.$getStamp', () => {

  let parseSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    parseSpy = jest.spyOn(StampParserService, 'parse');
    (memPool.getMempool as jest.Mock).mockReturnValue({});
    (bitcoinApi.$getRawTransaction as jest.Mock).mockResolvedValue({
      txid: TXID,
      vin: [{ witness: [], scriptsig: '' }],
      vout: [{ scriptpubkey: '', value: 0 }],
    });
  });

  afterEach(() => {
    parseSpy.mockRestore();
  });

  it('returns the parsed stamp when the parser identifies a Stamp artifact', async () => {
    const stamp = {
      type: DigitalArtifactType.Stamp,
      contentType: 'image/png',
      contentSize: 1393,
      getDataRaw: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      getContent: () => '',
      getDataUri: () => 'data:image/png;base64,...',
    } as any;
    parseSpy.mockReturnValue(stamp);

    const result = await ordpoolStampsApi.$getStamp(TXID);

    expect(result).toBe(stamp);
  });

  it('returns undefined for SRC-20 artifacts (StampParserService also yields these but they have no raw renderable bytes)', async () => {
    parseSpy.mockReturnValue({ type: DigitalArtifactType.Src20 } as any);

    const result = await ordpoolStampsApi.$getStamp(TXID);

    expect(result).toBeUndefined();
  });

  it('returns undefined for SRC-721 artifacts', async () => {
    parseSpy.mockReturnValue({ type: DigitalArtifactType.Src721 } as any);

    const result = await ordpoolStampsApi.$getStamp(TXID);

    expect(result).toBeUndefined();
  });

  it('returns undefined for SRC-101 artifacts', async () => {
    parseSpy.mockReturnValue({ type: DigitalArtifactType.Src101 } as any);

    const result = await ordpoolStampsApi.$getStamp(TXID);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the parser returns null', async () => {
    parseSpy.mockReturnValue(null);

    const result = await ordpoolStampsApi.$getStamp(TXID);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the tx is not on chain (404)', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockRejectedValue(
      Object.assign(new Error('not found'), { response: { status: 404 } }),
    );

    const result = await ordpoolStampsApi.$getStamp(TXID);

    expect(result).toBeUndefined();
  });

  it('uses the mempool entry when present and skips the bitcoin API', async () => {
    const tx = { txid: TXID, vin: [{ witness: [], scriptsig: '' }], vout: [] };
    (memPool.getMempool as jest.Mock).mockReturnValue({ [TXID]: tx });
    parseSpy.mockReturnValue({ type: DigitalArtifactType.Stamp, contentType: 'image/png' } as any);

    await ordpoolStampsApi.$getStamp(TXID);

    expect(bitcoinApi.$getRawTransaction).not.toHaveBeenCalled();
    expect(parseSpy).toHaveBeenCalledWith(tx);
  });

  it('rethrows non-404 errors from the bitcoin API', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockRejectedValue(new Error('connection refused'));

    await expect(ordpoolStampsApi.$getStamp(TXID)).rejects.toThrow('connection refused');
  });
});
