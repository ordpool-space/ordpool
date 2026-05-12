import * as WebSocket from 'ws';

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

/** Minimal duck-typed shape for a WebSocket client we want to send to.
 *  Lets tests build fixtures without instantiating real `ws` sockets. */
export interface OtsBroadcastClient {
  readyState: number;
  send: (s: string) => void;
  'track-tx'?: string;
  'track-txs'?: string[];
}

/** Minimal duck-typed shape for a WebSocket server: anything with an
 *  iterable `clients` collection. */
export interface OtsBroadcastServer {
  clients: Iterable<OtsBroadcastClient>;
}

/**
 * Push `{otsCommitFlipped: <txid>}` to every connected client across
 * the given servers that is tracking `txid` via `track-tx` or
 * `track-txs`. Skips clients whose socket is not OPEN. Send failures
 * are swallowed silently (a degraded socket should not block the rest
 * of the broadcast).
 *
 * Extracted from websocket-handler.broadcastOtsCommitFlipped so the
 * broadcast logic is unit-testable without dragging in the full
 * upstream dependency chain (blocks, pools-parser, mining...). The
 * caller wires it to the OTS poller via
 * `ordpoolOtsTxidSet.subscribe(...)`.
 */
export function broadcastOtsCommitFlippedToClients(
  servers: OtsBroadcastServer[],
  txid: string,
): void {
  for (const server of servers) {
    for (const client of server.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const tracking = client['track-tx'] === txid
        || (Array.isArray(client['track-txs']) && client['track-txs'].includes(txid));
      if (!tracking) continue;
      try {
        client.send(JSON.stringify({ otsCommitFlipped: txid }));
      } catch {
        /* swallow -- one degraded socket must not block the rest */
      }
    }
  }
}
