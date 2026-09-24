import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import memPool from '../../mempool';
import { $fetchTxByTxid } from './ordpool-tx-fetch.helper';

// Factory mocks short-circuit the config-reading module-load chain (same
// approach as ordpool-inscriptions.api.test.ts) so the suite boots without a
// real mempool-config.json.
jest.mock('../../bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: { $getRawTransaction: jest.fn() },
}));
jest.mock('../../mempool', () => ({
  __esModule: true,
  default: { getMempool: jest.fn() },
}));

const TXID = '1111111111111111111111111111111111111111111111111111111111111111';
const getRawTransaction = bitcoinApi.$getRawTransaction as jest.Mock;
const getMempool = memPool.getMempool as jest.Mock;

// The exact bitcoind Core RPC rejection for a missing tx: rpc-api/jsonrpc.ts
// builds `new Error(message)` and sets `.code` from the JSON-RPC error code.
// getrawtransaction on an absent txid returns code -5 (RPC_INVALID_ADDRESS_OR_KEY).
function coreRpcNotFound(): Error & { code: number } {
  const err = new Error('No such mempool or blockchain transaction. Use gettransaction for wallet transactions.') as Error & { code: number };
  err.code = -5;
  return err;
}

describe('$fetchTxByTxid not-found classification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMempool.mockReturnValue({}); // tx not in mempool -> falls back to RPC
  });

  it('returns the mempool entry without touching RPC when the tx is in the mempool', async () => {
    const memTx = { txid: TXID } as any;
    getMempool.mockReturnValue({ [TXID]: memTx });
    await expect($fetchTxByTxid(TXID)).resolves.toBe(memTx);
    expect(getRawTransaction).not.toHaveBeenCalled();
  });

  it('maps a bitcoind Core RPC not-found (code -5) to undefined, does NOT throw', async () => {
    // The load-bearing assertion: without the `error.code === -5` branch this
    // rejects (the route then 500s and leaks the RPC string). Mutation-check by
    // deleting that branch in ordpool-tx-fetch.helper.ts -> this test goes red.
    getRawTransaction.mockRejectedValue(coreRpcNotFound());
    await expect($fetchTxByTxid(TXID)).resolves.toBeUndefined();
  });

  it('maps an esplora HTTP 404 to undefined', async () => {
    getRawTransaction.mockRejectedValue({ response: { status: 404 } });
    await expect($fetchTxByTxid(TXID)).resolves.toBeUndefined();
  });

  it('rethrows a genuine fault (not a not-found), e.g. txindex still loading', async () => {
    const loading = new Error('Loading block index...') as Error & { code: number };
    loading.code = -28; // RPC_IN_WARMUP, a real fault -> must NOT be swallowed as 404
    getRawTransaction.mockRejectedValue(loading);
    await expect($fetchTxByTxid(TXID)).rejects.toThrow('Loading block index...');
  });
});
