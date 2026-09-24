import { Injectable, signal } from '@angular/core';
import { lookupRuneEtching } from 'ordpool-sdk';

/**
 * Resolves a rune NAME to the txid that etched it, for the "Assets on this
 * UTXO" panel's rune links. ord's `/output/` carries only rune names and
 * balances, not the etching, so the etching is fetched per name from our ord
 * (`lookupRuneEtching` → `/rune/<name>`).
 *
 * The resolver keeps only PERMANENT answers, which is what makes the caching
 * safe (per FAMILY_UX.md's coin-safety rule). `lookupRuneEtching` says which of
 * four cases a name is in:
 * - `etched`      → the etching txid; permanent, cache forever (renders a link).
 * - `not-etched`  → the rune is reserved, never etched (UNCOMMON•GOODS, the
 *                   commonest on a coin); permanent, cache as "no link" forever
 *                   so it is asked exactly ONCE and never re-asked (renders
 *                   plain text). This is the whole reason to use the four-case
 *                   lookup over the collapsed one.
 * - `unknown`     → ord has no entry YET; the rune can be etched in a later
 *                   block. NOT cached, so a later scan re-asks (renders text).
 * - `unavailable` → not an answer (a lookup failure or an unparseable body).
 *                   NEVER cached, so a later scan retries; caching it would
 *                   freeze one ord hiccup into a permanently dead row.
 *
 * A name with no cached entry (unknown / unavailable / not yet looked up)
 * renders as plain text, never a link to an all-zero txid the SPA would answer
 * 200 for and show a silent not-found.
 */
@Injectable({ providedIn: 'root' })
export class RuneEtchingResolverService {
  // txid → link; null → permanently no link (not-etched). A name ABSENT from
  // the map is unresolved-or-transient and will be re-asked on the next scan.
  private readonly etchings = signal<ReadonlyMap<string, string | null>>(new Map());
  private readonly inflight = new Set<string>();

  /** Rune name → etching txid (link) or null (permanently no link). */
  readonly resolved = this.etchings.asReadonly();

  /**
   * Start resolving `name` once. Idempotent, and skips any name with a PERMANENT
   * answer already recorded (etched or not-etched), so UNCOMMON•GOODS is asked
   * exactly once ever. Only `unknown`/`unavailable` names (absent from the map)
   * are re-asked, which is correct: those answers can change. The signal write
   * happens in a microtask, never synchronously during a render.
   */
  ensureResolved(name: string, ordBaseUrl: string): void {
    if (this.inflight.has(name) || this.etchings().has(name)) {
      return;
    }
    this.inflight.add(name);
    lookupRuneEtching(name, { ordBaseUrl })
      .then((result) => {
        // Record only permanent answers. unknown / unavailable are left absent
        // so a later scan re-asks.
        if (result.kind === 'etched') {
          this.write(name, result.txid);
        } else if (result.kind === 'not-etched') {
          this.write(name, null);
        }
      })
      .catch(() => {
        // Treat an unexpected throw as unavailable: leave absent, retry later.
      })
      .finally(() => {
        this.inflight.delete(name);
      });
  }

  private write(name: string, value: string | null): void {
    const next = new Map(this.etchings());
    next.set(name, value);
    this.etchings.set(next);
  }
}
