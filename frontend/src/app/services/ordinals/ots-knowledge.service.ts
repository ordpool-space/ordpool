import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable, Subject } from 'rxjs';

import { Transaction } from '../../interfaces/electrs.interface';
import { StateService } from '../state.service';
import { OrdpoolApiService } from './ordpool-api.service';

/**
 * "Is this tx an OpenTimestamps calendar batch commit?" oracle for the
 * frontend. Returns a tristate `Promise<boolean | null>`:
 *
 *   - `true`  -- definitely an OTS commit
 *   - `false` -- definitely NOT an OTS commit
 *   - `null`  -- unknown (probe failed; caller should treat as "no badge"
 *                but distinct from a confirmed negative)
 *
 * Encapsulates the three-source decision logic for the `ordpool_ots`
 * bit that the rest of the parser flags can't reach:
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
 *      `GET /api/v1/ordpool/ots/tx/:txid` and treat `row !== null` as
 *      the boolean answer. Cache the answer. Probe failure resolves to
 *      `null`, not `false`.
 *
 * ### Cache semantics
 *
 * - `true` answers are **monotonic** -- once a tx is known to be an OTS
 *   commit, that's permanent. Cached forever (process lifetime).
 * - `false` answers are **NOT monotonic** -- the backend poller may
 *   later learn about the calendar batch and flip the answer to `true`.
 *   Cached for 60 s to match the backend's `Cache-Control: max-age=60`,
 *   which itself matches the poller cycle.
 * - `null` answers are **NOT cached** -- a transient probe failure
 *   should not poison the cache; the next call retries.
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
  private stateService = inject(StateService);

  /** txid -> { value, expiry-ms-since-epoch (null = forever) }. */
  private cache = new Map<string, { value: boolean; expiry: number | null }>();

  /** In-flight probes, keyed by txid. Lets concurrent callers share a
   *  single HTTP request: the first call kicks off the fetch, the rest
   *  await the same Promise. Cleared once the Promise settles. */
  private inFlight = new Map<string, Promise<boolean | null>>();

  /** TTL for `false` cache entries. Matches the backend's max-age=60 on
   *  the negative-result branch of /ots/tx and the OTS poller's cycle. */
  private static readonly FALSE_TTL_MS = 60_000;

  /** Fan-out for the backend's `otsCommitFlipped` WS push. Components
   *  rendering transaction flags (transaction.component, tracker.component,
   *  transaction-raw.component) subscribe to this and recompute when
   *  the emitted txid matches the one they're rendering. */
  private flippedSubject$ = new Subject<string>();
  readonly flipped$: Observable<string> = this.flippedSubject$.asObservable();

  constructor() {
    // Drop the cache when the network changes (mainnet <-> signet/testnet).
    // The OTS poller is per-network on the backend; cached answers from one
    // network are meaningless on another, and a txid collision (rare but
    // possible) would otherwise return a stale answer.
    this.stateService.networkChanged$.subscribe(() => this.clearCache());

    // The WS push from the backend (`{otsCommitFlipped: <txid>}`) lands
    // here via StateService. Update cache to a permanent `true` and
    // fan out to components.
    this.stateService.otsCommitFlipped$.subscribe((txid) => this.recordFlip(txid));
  }

  /** Mark a txid as a known OTS commit and notify any subscribers. The
   *  backend's WS broadcaster fires this whenever the OTS poller adds a
   *  new txid to its in-memory set. `true` is monotonic, so we cache
   *  permanently (`expiry: null`). Direct callers (tests, dev tooling)
   *  can also use this to seed the cache without an HTTP round-trip. */
  recordFlip(txid: string): void {
    this.cache.set(txid, { value: true, expiry: null });
    this.inFlight.delete(txid);
    this.flippedSubject$.next(txid);
  }

  /**
   * Resolve "is this tx an OTS calendar commit?" Returns a tristate
   * `Promise<boolean | null>` -- `null` is genuinely "we don't know"
   * (probe failed). Will not throw.
   *
   * @param tx the transaction; we read `txid`, `isOtsCommit` (the
   *           server-attached tristate), and `vout[].scriptpubkey_type`
   *           (for the OP_RETURN fast path).
   */
  async isOtsCommit(tx: Transaction): Promise<boolean | null> {
    // (1) Server attached the answer on this strip-wire surface.
    if (tx.isOtsCommit === true) return true;
    if (tx.isOtsCommit === false) return false;

    // (2) OP_RETURN fast path. If the tx has no OP_RETURN outputs at
    // all, it cannot be an OTS commit by construction. Answer false
    // without any network round-trip.
    if (!this.hasOpReturn(tx)) return false;

    // (3) Lazy backend probe, cached. Returns null on probe failure.
    return this.isOtsCommitByTxid(tx.txid);
  }

  /** Lower-level variant: skip the tx-shape sniffing and ask the backend
   *  directly. Exposed for tests and for callers that hold only a txid.
   *  Returns `null` on probe failure (transient backend / network issue);
   *  caller treats `null` as "no OTS badge" but distinct from a confirmed
   *  negative. */
  async isOtsCommitByTxid(txid: string): Promise<boolean | null> {
    const cached = this.cache.get(txid);
    if (cached) {
      if (cached.expiry === null || cached.expiry > Date.now()) {
        return cached.value;
      }
      this.cache.delete(txid);
    }

    // Coalesce concurrent callers onto a single in-flight HTTP request.
    const existing = this.inFlight.get(txid);
    if (existing) return existing;

    const probe: Promise<boolean | null> = (async () => {
      try {
        const row = await firstValueFrom(this.api.getOtsTx$(txid));
        const result = row !== null;
        this.cache.set(txid, {
          value: result,
          // true is monotonic (forever); false gets a TTL.
          expiry: result ? null : Date.now() + OtsKnowledgeService.FALSE_TTL_MS,
        });
        return result;
      } catch {
        // Probe failed -- backend down, network blip, whatever. Return
        // null (genuinely unknown) without caching the failure. The next
        // call retries. The consumer treats null as "no OTS badge" but
        // distinct from a confirmed `false`.
        return null;
      } finally {
        this.inFlight.delete(txid);
      }
    })();
    this.inFlight.set(txid, probe);
    return probe;
  }

  /** Test-only: reset cache state between specs. */
  clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  /**
   * "No OP_RETURN -> not an OTS commit" — pinned against the current
   * OpenTimestamps wire format: calendars publish their Merkle root in
   * a `OP_RETURN OP_PUSHBYTES_32 <32 bytes>` output of the calendar's
   * batch transaction. This is true for every OTS calendar known to
   * date (alice/bob/finney/eternitywall) and matches the OTS spec.
   *
   * If a future calendar variant ever publishes the Merkle root via
   * Taproot annex, key-path commitment, P2WSH script, or any other
   * non-OP_RETURN channel, this fast-path becomes a false-negative
   * gate: every tx of that variant would silently never get the OTS
   * badge, regardless of what the lazy backend probe would say. Revisit
   * if/when the OTS protocol extends.
   */
  private hasOpReturn(tx: Transaction): boolean {
    for (const vout of tx.vout ?? []) {
      if (vout.scriptpubkey_type === 'op_return') return true;
    }
    return false;
  }
}
