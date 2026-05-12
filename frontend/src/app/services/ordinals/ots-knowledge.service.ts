import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Transaction } from '../../interfaces/electrs.interface';
import { OrdpoolApiService } from './ordpool-api.service';

/**
 * "Is this tx an OpenTimestamps calendar batch commit?" oracle for the
 * frontend. Encapsulates the three-source decision logic for the
 * `ordpool_ots` bit that the rest of the parser flags can't reach:
 *
 *   1. **Server attached the answer.** When a strip-wire surface
 *      (REST `/api/v1/tx/:txId`, WS track-tx) returns a tx, the backend
 *      sets `tx.isOtsCommit: true | false`. Trust it -- no work to do.
 *
 *   2. **No OP_RETURN -> definitely not.** An OTS calendar commit is
 *      structurally `OP_RETURN OP_PUSHBYTES_32 <merkle root>` -- the
 *      calendar publishes its Merkle root in an OP_RETURN output.
 *      Without one, the tx CANNOT be an OTS commit. Fast path: answer
 *      synchronously, no backend round-trip.
 *
 *   3. **Lazy backend probe.** For txs WITH OP_RETURN that arrived
 *      without `isOtsCommit` set (third-party API consumers, dev tools,
 *      future wire paths the strip-fill hook hasn't covered), call
 *      `GET /api/v1/ordpool/ots/is-commit/:txid`. Cache the answer.
 *
 * ### Cache semantics
 *
 * - `true` answers are **monotonic** -- once a tx is known to be an OTS
 *   commit, that's permanent. Cached forever (process lifetime).
 * - `false` answers are **NOT monotonic** -- the backend poller may
 *   later learn about the calendar batch and flip the answer to `true`.
 *   Cached for 60 s to match the backend's `Cache-Control: max-age=60`,
 *   which itself matches the poller cycle.
 *
 * The cache is in-memory, per-page-session. It is intentionally not
 * persisted to `sessionStorage`; the OP_RETURN fast-path makes the vast
 * majority of "is this OTS?" questions answerable client-side for free,
 * so the cost of refetching the rare ones on page reload is negligible.
 *
 * See ORDPOOL-FLAGS-ARCHITECTURE.md §4 for the full design rationale.
 */
@Injectable({ providedIn: 'root' })
export class OtsKnowledgeService {

  private api = inject(OrdpoolApiService);

  /** txid -> { value, expiry-ms-since-epoch (null = forever) }. */
  private cache = new Map<string, { value: boolean; expiry: number | null }>();

  /** TTL for `false` cache entries. Matches the backend's max-age=60 on
   *  the is-commit endpoint and the OTS poller's nominal cycle. */
  private static readonly FALSE_TTL_MS = 60_000;

  /**
   * Resolve "is this tx an OTS calendar commit?" Returns a Promise<boolean>.
   * Will not throw -- failures of the lazy probe degrade gracefully to
   * `false` (the conservative default: don't show an OTS badge we can't
   * prove).
   *
   * @param tx the transaction; we read `txid`, `isOtsCommit` (the
   *           server-attached tristate), and `vout[].scriptpubkey_type`
   *           (for the OP_RETURN fast path).
   */
  async isOtsCommit(tx: Transaction): Promise<boolean> {
    // (1) Server attached the answer on this strip-wire surface.
    if (tx.isOtsCommit === true) return true;
    if (tx.isOtsCommit === false) return false;

    // (2) OP_RETURN fast path. If the tx has no OP_RETURN outputs at
    // all, it cannot be an OTS commit by construction. Answer false
    // without any network round-trip.
    if (!this.hasOpReturn(tx)) return false;

    // (3) Lazy backend probe, cached.
    return this.isOtsCommitByTxid(tx.txid);
  }

  /** Lower-level variant: skip the tx-shape sniffing and ask the backend
   *  directly. Exposed for tests and for callers that hold only a txid. */
  async isOtsCommitByTxid(txid: string): Promise<boolean> {
    const cached = this.cache.get(txid);
    if (cached) {
      if (cached.expiry === null || cached.expiry > Date.now()) {
        return cached.value;
      }
      this.cache.delete(txid);
    }

    try {
      const { result } = await firstValueFrom(this.api.isOtsCommit$(txid));
      this.cache.set(txid, {
        value: result,
        // true is monotonic (forever); false gets a TTL.
        expiry: result ? null : Date.now() + OtsKnowledgeService.FALSE_TTL_MS,
      });
      return result;
    } catch {
      // Probe failed -- backend down, network blip, whatever. Return
      // false (no OTS badge) without caching the failure.
      return false;
    }
  }

  /** Test-only: reset cache state between specs. */
  clearCache(): void {
    this.cache.clear();
  }

  private hasOpReturn(tx: Transaction): boolean {
    for (const vout of tx.vout ?? []) {
      if (vout.scriptpubkey_type === 'op_return') return true;
    }
    return false;
  }
}
