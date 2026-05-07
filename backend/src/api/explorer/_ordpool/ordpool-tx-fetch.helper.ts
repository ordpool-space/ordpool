import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import { IEsploraApi } from '../../bitcoin/esplora-api.interface';
import memPool from '../../mempool';

/**
 * Resolve a txid to an Esplora-shape transaction, preferring the in-memory
 * mempool entry and falling back to bitcoind RPC. Returns undefined when the
 * tx is neither in the mempool nor on chain (404), and rethrows any other
 * RPC error.
 *
 * `skipConversion=false` is critical: with skipConversion=true the bitcoind
 * RPC shape (vin[].txinwitness, scriptSig as object) is left un-converted,
 * the parser reads vin[].witness and silently returns nothing. Every
 * /preview / /content lookup that fell through to the RPC fetch path used
 * to 404 because of this. Mempool entries are already stored in Esplora
 * shape, so the mempool branch is unaffected.
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
    if (error.response && error.response.status === 404) {
      return undefined;
    }
    throw error;
  }
}
