import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import { IEsploraApi } from '../../bitcoin/esplora-api.interface';
import memPool from '../../mempool';

/**
 * Resolve a txid to an Esplora-shape transaction, preferring the in-memory
 * mempool entry and falling back to bitcoind RPC. Returns undefined when the
 * tx is neither in the mempool nor on chain (esplora HTTP 404 or Core RPC
 * code -5), and rethrows any other RPC error.
 *
 * `skipConversion=false` is critical: with skipConversion=true the bitcoind
 * RPC shape (vin[].txinwitness, scriptSig as object) is left un-converted,
 * so the parser reads vin[].witness and returns nothing, and a /preview or
 * /content lookup that reaches the RPC fetch path yields no inscription.
 * Mempool entries are already stored in Esplora shape, so the mempool branch
 * is unaffected.
 */
export async function $fetchTxByTxid(txId: string): Promise<IEsploraApi.Transaction | undefined> {
  const mempool = memPool.getMempool();
  const inMempool = mempool[txId] as IEsploraApi.Transaction | undefined;
  if (inMempool) {
    return inMempool;
  }

  try {
    return await bitcoinApi.$getRawTransaction(txId, false, false, false);
  } catch (error: any) {
    // Not found on either backend means the tx is neither in the mempool nor on
    // chain: esplora answers HTTP 404; bitcoind Core RPC getrawtransaction
    // rejects with code -5 (RPC_INVALID_ADDRESS_OR_KEY, "No such mempool or
    // blockchain transaction"). Both map to undefined so callers return 404. Any
    // other error (RPC down, timeout, txindex mid-rebuild) is a genuine fault.
    if (error?.response?.status === 404 || error?.code === -5) {
      return undefined;
    }
    throw error;
  }
}
