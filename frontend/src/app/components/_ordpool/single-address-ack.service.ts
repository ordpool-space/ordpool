import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/**
 * Per-WALLET acknowledgement of the single-address custody caveat
 * (wallet-ux-round3 §7.6).
 *
 * The prominent caveat on the mint / inscribe screens collapses once the
 * person has acknowledged it, and stays collapsed for that wallet for the
 * rest of the session and across reloads. The compact indicator on the header
 * pill is NOT governed by this: the condition has not gone away, so it stays
 * visible regardless of acknowledgement.
 *
 * Keyed on the wallet TYPE, never the address. A fresh address in a
 * single-address wallet is still a single address, so an acknowledgement that
 * cleared on an address change would vanish exactly when the person believes
 * they have fixed something and has not (§7.6).
 *
 * Persisted in localStorage so a reload does not re-show a caveat the person
 * has already read. Every access is guarded: storage can throw (private mode,
 * blocked site data) or return nothing, and the service degrades to
 * in-memory-only rather than failing.
 */
@Injectable({ providedIn: 'root' })
export class SingleAddressAckService {

  private static readonly STORAGE_KEY = 'ordpool.singleAddressAck';

  private readonly ackedSubject = new BehaviorSubject<ReadonlySet<string>>(this.load());

  /** The set of acknowledged wallet types, as an observable for the templates. */
  readonly acknowledged$: Observable<ReadonlySet<string>> = this.ackedSubject.asObservable();

  /** Whether the given wallet type has acknowledged the caveat. */
  isAcknowledged(walletType: string | null | undefined): boolean {
    return !!walletType && this.ackedSubject.value.has(walletType);
  }

  /** Record that the given wallet type has acknowledged the caveat. */
  acknowledge(walletType: string | null | undefined): void {
    if (!walletType || this.ackedSubject.value.has(walletType)) {
      return;
    }
    const next = new Set(this.ackedSubject.value);
    next.add(walletType);
    this.ackedSubject.next(next);
    this.persist(next);
  }

  private load(): ReadonlySet<string> {
    try {
      const raw = localStorage.getItem(SingleAddressAckService.STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
    } catch {
      return new Set();
    }
  }

  private persist(acked: ReadonlySet<string>): void {
    try {
      localStorage.setItem(SingleAddressAckService.STORAGE_KEY, JSON.stringify([...acked]));
    } catch {
      // Storage unavailable (private mode, blocked site data): in-memory ack
      // still works for this session; it just won't survive a reload.
    }
  }
}
