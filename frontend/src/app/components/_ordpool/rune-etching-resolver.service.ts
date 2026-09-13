import { Injectable, signal } from '@angular/core';
import { resolveRuneEtchingTxid } from 'ordpool-sdk';

/**
 * Resolves a rune NAME to the txid that etched it, for the "Assets on this
 * UTXO" panel's rune links. ord's `/output/` carries only rune names and
 * balances, not the etching, so the etching is fetched per name from our ord
 * (`resolveRuneEtchingTxid` → `/rune/<name>`).
 *
 * Contract that keeps the danger panel honest:
 * - Positive answers are cached: an etching is immutable, so once known it
 *   never changes.
 * - A null answer is NEVER cached. `resolveRuneEtchingTxid` returns null for a
 *   reserved rune whose etching is all-zero (UNCOMMON•GOODS) and for a
 *   transient lookup failure; caching null would strand the row unlinked until
 *   the app reloads. Leaving it out lets a later render retry.
 * - Lookups run independently (each `ensureResolved` is its own request), so
 *   one slow or failing name never holds up another rune's row.
 *
 * A name with no cached etching renders as plain text (no link) — never a
 * link to an all-zero txid, which the SPA would answer 200 for and show a
 * silent not-found.
 */
@Injectable({ providedIn: 'root' })
export class RuneEtchingResolverService {
  private readonly etchings = signal<ReadonlyMap<string, string>>(new Map());
  private readonly inflight = new Set<string>();

  /** Rune name → etching txid, for names resolved to a real (non-zero) etching. */
  readonly resolved = this.etchings.asReadonly();

  /**
   * Start resolving `name` once. Idempotent: a name already resolved or in
   * flight is skipped, so calling this on every change-detection pass is safe.
   * The signal write on success happens in a microtask, never synchronously
   * during a render.
   */
  ensureResolved(name: string, ordBaseUrl: string): void {
    if (this.inflight.has(name) || this.etchings().has(name)) {
      return;
    }
    this.inflight.add(name);
    resolveRuneEtchingTxid(name, { ordBaseUrl })
      .then((txid) => {
        if (txid) {
          const next = new Map(this.etchings());
          next.set(name, txid);
          this.etchings.set(next);
        }
      })
      .catch(() => {
        // Leave unresolved so a later render retries; never cache the failure.
      })
      .finally(() => {
        this.inflight.delete(name);
      });
  }
}
