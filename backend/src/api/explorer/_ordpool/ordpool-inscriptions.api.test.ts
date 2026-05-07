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
// ordpool-parser is left unmocked: isValidInscriptionId is pure regex
// validation, and InscriptionParserService.parse on a fake tx with no
// witness data returns [] without side effects.

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
