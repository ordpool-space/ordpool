import { AtomicalParserService } from 'ordpool-parser';

import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import memPool from '../../mempool';
import ordpoolAtomicalsApi from './ordpool-atomicals.api';

jest.mock('../../bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: { $getRawTransaction: jest.fn() },
}));
jest.mock('../../mempool', () => ({
  __esModule: true,
  default: { getMempool: jest.fn() },
}));

const TXID = '1d2f39f54320631d0432fa495a45a4f298a2ca1b18adef8e4356e327d003a694';

function fakeFile(contentType: string, name = 'file', data: Uint8Array = new Uint8Array()): any {
  return { name, contentType, data, getContent: () => '', getData: () => '', getDataUri: () => `data:${contentType};base64,` };
}

function fakeAtomical(files: any[]): any {
  return {
    operation: 'nft',
    getPayloadRaw: () => new Uint8Array(),
    getArgs: () => null,
    getFiles: () => files,
  };
}

describe('OrdpoolAtomicalsApi.$getFirstAtomicalImage', () => {

  let parseSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    parseSpy = jest.spyOn(AtomicalParserService, 'parse');
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

  it('returns the only image file when the atomical has one', async () => {
    const png = fakeFile('image/png', 'image.png');
    parseSpy.mockReturnValue(fakeAtomical([png]));

    const result = await ordpoolAtomicalsApi.$getFirstAtomicalImage(TXID);

    expect(result).toBe(png);
  });

  it('skips a JSON metadata file and returns the image file', async () => {
    const json = fakeFile('application/json', 'metadata.json');
    const image = fakeFile('image/webp', 'asset.webp');
    parseSpy.mockReturnValue(fakeAtomical([json, image]));

    const result = await ordpoolAtomicalsApi.$getFirstAtomicalImage(TXID);

    expect(result).toBe(image);
  });

  it('returns the FIRST image file when there are multiple', async () => {
    const a = fakeFile('image/jpeg', 'a.jpg');
    const b = fakeFile('image/png', 'b.png');
    parseSpy.mockReturnValue(fakeAtomical([a, b]));

    const result = await ordpoolAtomicalsApi.$getFirstAtomicalImage(TXID);

    expect(result).toBe(a);
  });

  it('returns undefined when no file is image-typed', async () => {
    parseSpy.mockReturnValue(fakeAtomical([fakeFile('application/json'), fakeFile('text/plain')]));

    const result = await ordpoolAtomicalsApi.$getFirstAtomicalImage(TXID);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the atomical has no files', async () => {
    parseSpy.mockReturnValue(fakeAtomical([]));

    const result = await ordpoolAtomicalsApi.$getFirstAtomicalImage(TXID);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the tx is not an atomical', async () => {
    parseSpy.mockReturnValue(null);

    const result = await ordpoolAtomicalsApi.$getFirstAtomicalImage(TXID);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the tx is not on chain (404)', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockRejectedValue(
      Object.assign(new Error('not found'), { response: { status: 404 } }),
    );

    const result = await ordpoolAtomicalsApi.$getFirstAtomicalImage(TXID);

    expect(result).toBeUndefined();
  });

  it('rethrows non-404 errors from the bitcoin API', async () => {
    (bitcoinApi.$getRawTransaction as jest.Mock).mockRejectedValue(new Error('connection refused'));

    await expect(ordpoolAtomicalsApi.$getFirstAtomicalImage(TXID)).rejects.toThrow('connection refused');
  });
});
