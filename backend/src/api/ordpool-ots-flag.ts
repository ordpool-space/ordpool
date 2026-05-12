import { OrdpoolTransactionFlags } from 'ordpool-parser';
import ordpoolOtsTxidSet from './ordpool-ots-txid-set';

/**
 * Returns the `ordpool_ots` bit (as a bigint) when the given txid is in
 * the in-memory `ordpoolOtsTxidSet`, otherwise `0n`. The caller OR's
 * the result into its running flags bigint:
 *
 *     flags |= getOtsFlag(tx.txid);
 *
 * Pure -- no mutation, no `_ordpoolFlags` side-channel. O(1) per call
 * (one `Set.has()` against the in-memory set hydrated by the OTS poller).
 *
 * See ORDPOOL-FLAGS-ARCHITECTURE.md §2.2 for the call-site context.
 */
export function getOtsFlag(txid: string): bigint {
  return ordpoolOtsTxidSet.has(txid) ? OrdpoolTransactionFlags.ordpool_ots : 0n;
}

/**
 * Strip-wire helper: writes the tristate `isOtsCommit` onto a tx object
 * before it ships over a strip surface (REST `/api/v1/tx/:txId`, WS
 * track-tx, WS track-txs). The frontend's OtsKnowledgeService consumes
 * the field, sparing it the lazy backend probe.
 *
 *   - `true`  -- this txid is in `ordpoolOtsTxidSet`.
 *   - `false` -- it's not.
 *
 * Mutates the passed object in place and also returns it for fluent
 * chaining. O(1) per call.
 *
 * See ORDPOOL-FLAGS-ARCHITECTURE.md §4.
 */
export function attachIsOtsCommit<T extends { txid: string; isOtsCommit?: boolean | null }>(tx: T): T {
  tx.isOtsCommit = ordpoolOtsTxidSet.has(tx.txid);
  return tx;
}

/**
 * Variant for the WS track-txs (plural) initial-subscribe payload. The
 * `TxTrackingInfo` shape has no `txid` field (the txid is the key in
 * the outer map), so we attach by txid argument instead of by tx-object
 * field. O(1).
 */
export function setIsOtsCommitByTxid<T extends { isOtsCommit?: boolean | null }>(
  txid: string,
  info: T,
): T {
  info.isOtsCommit = ordpoolOtsTxidSet.has(txid);
  return info;
}
