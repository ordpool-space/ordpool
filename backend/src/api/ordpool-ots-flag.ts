import { OrdpoolTransactionFlags } from 'ordpool-parser';
import ordpoolOtsTxidSet from './ordpool-ots-txid-set';

/**
 * Pre-enrichment helper that ORs the ordpool_ots flag into tx._ordpoolFlags
 * when the tx's txid is in the in-memory OrdpoolOtsTxidSet (populated from
 * the ordpool_stats_ots satellite table on backend boot, kept fresh by
 * OrdpoolOtsPoller).
 *
 * Mirrors the existing parser-side _ordpoolFlags HACK pattern: the parser
 * pre-enriches with witness/output-derived bits, then this function ORs
 * the indexer-derived bit, then upstream's sync Common.getTransactionFlags
 * reads tx._ordpoolFlags. Two pre-enrichment steps, one read.
 *
 * O(1) per tx (hash-set lookup). Does NOT do an SQL round-trip per tx --
 * the set is already in memory.
 */
export function addOtsFlag(tx: { txid: string; _ordpoolFlags?: number }): void {
  if (!ordpoolOtsTxidSet.has(tx.txid)) return;
  // BigInt arithmetic: JS bitwise OR truncates to int32 and would zero out
  // every ordpool bit (they all live above bit 47). The OR happens in
  // BigInt space; Number() back is exact for any combination of ordpool
  // bits (the spread bits 48-81 fits inside Number's 53-bit mantissa
  // when all set bits are within that window). Same pattern the parser
  // uses in DigitalArtifactAnalyserService.analyseTransaction.
  const existing = BigInt(tx._ordpoolFlags ?? 0);
  tx._ordpoolFlags = Number(existing | OrdpoolTransactionFlags.ordpool_ots);
}

/**
 * Bulk variant for the block path. Same semantics; saves the per-call
 * function-invocation overhead when iterating thousands of txs.
 */
export function addOtsFlagBatch(txs: Array<{ txid: string; _ordpoolFlags?: number }>): void {
  for (const tx of txs) addOtsFlag(tx);
}
