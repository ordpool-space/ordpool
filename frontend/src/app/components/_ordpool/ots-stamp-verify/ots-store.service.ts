import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { sliceOpsBeforeAttestation } from 'ordpool-parser';

/*
Test cases:
- Single browser, multiple stamps queued: each gets its own row.
- Refresh page: rows re-hydrate from localStorage.
- localStorage corrupted (manual edit): we recover by resetting to empty.
*/

const STORAGE_KEY = 'ordpool:ots:pending';
const SCHEMA_VERSION = 1;

/** One known OTS calendar -- shape matches the backend's
 *  /api/v1/ordpool/ots/stamp-calendars response (which mirrors
 *  ots-calendars.json on disk). 'nickname' is the display name AND the
 *  stable identifier; 'url' is the base URL we POST /digest against. */
export interface OtsKnownCalendar {
  nickname: string;
  url: string;
}

/**
 * Hardcoded fallback used at stamp time if /ots/stamp-calendars hasn't yet
 * been fetched (cold load) OR the fetch failed. Same set as
 * backend/.../ots-calendars.json. The live picker
 * (OtsCalendarPickerService) prefers whatever the backend serves; this is
 * just a safety net.
 */
export const OTS_FALLBACK_CALENDARS: ReadonlyArray<OtsKnownCalendar> = Object.freeze([
  Object.freeze({ nickname: 'alice',     url: 'https://alice.btc.calendar.opentimestamps.org' }),
  Object.freeze({ nickname: 'bob',       url: 'https://bob.btc.calendar.opentimestamps.org' }),
  Object.freeze({ nickname: 'finney',    url: 'https://finney.calendar.eternitywall.com' }),
  Object.freeze({ nickname: 'catallaxy', url: 'https://btc.calendar.catallaxy.com' }),
]);

export type OtsStampStatus = 'queued' | 'ready' | 'failed';
export type OtsCalendarResult = 'pending' | 'published' | 'error' | 'never-checked';

export interface OtsLocalCalendar {
  nickname: string;                 // display name; also the stable identifier
  uri: string;                      // base URL (kept as 'uri' for legacy localStorage entries; same as the picker's 'url')
  pendingBase64: string;            // bytes the calendar returned at /digest (ops + PendingAttestation)
  /**
   * Lookup key for /timestamp/<commitmentHex>. NOT the file hash.
   *
   * The OTS protocol commits the file hash via a calendar-specific chain
   * of (append/prepend/sha256) ops. The calendar stores the upgraded
   * timestamp keyed by the COMMITMENT (= msg at the PendingAttestation
   * node), not the file hash. Querying /timestamp/<file_hash> returns 404
   * forever even after the calendar publishes. We compute this once at
   * stamp time by parsing the calendar's /digest reply.
   */
  commitmentHex: string;
  upgradedBase64: string | null;    // bytes the calendar returned at /timestamp/<commitmentHex> once published
  lastCheckedAt: number;
  lastResult: OtsCalendarResult;
  errorMessage: string | null;
}

export interface OtsLocalStamp {
  id: string;
  filename: string;
  fileHashAlgo: 'sha256';
  fileHashHex: string;
  submittedAt: number;
  calendars: OtsLocalCalendar[];
  status: OtsStampStatus;
  readyAt: number | null;
  downloadedAt: number | null;
  downloadCount: number;
}

interface OtsLocalStore {
  version: number;
  stamps: OtsLocalStamp[];
}

@Injectable({ providedIn: 'root' })
export class OtsStoreService {

  /**
   * True when localStorage is writable. False in Safari private mode, when
   * a privacy extension blocks DOM Storage, or when running outside a
   * browser. Stamping requires this -- without it, pending stamps can't
   * survive a tab reload, the queue is empty on mount, and the user has
   * no way to come back to a job in progress.
   *
   * Verify works fine without localStorage (it's a one-shot operation).
   */
  readonly localStorageAvailable: boolean = OtsStoreService.detectLocalStorage();

  private static detectLocalStorage(): boolean {
    try {
      const probe = '__ordpool_ots_probe__';
      localStorage.setItem(probe, '1');
      const ok = localStorage.getItem(probe) === '1';
      localStorage.removeItem(probe);
      return ok;
    } catch {
      return false;
    }
  }

  private state$ = new BehaviorSubject<OtsLocalStamp[]>(this.load());

  /** Subscribers re-render whenever the queue mutates. */
  stamps$(): Observable<OtsLocalStamp[]> {
    return this.state$.asObservable();
  }

  snapshot(): OtsLocalStamp[] {
    return this.state$.getValue();
  }

  add(stamp: OtsLocalStamp): void {
    const next = [stamp, ...this.state$.getValue()];
    this.persist(next);
  }

  /**
   * Replace an existing stamp by id. If the id is not found, the call is a
   * no-op (the user may have cleared it in another tab; we don't re-create).
   */
  update(id: string, mutator: (s: OtsLocalStamp) => OtsLocalStamp): void {
    const cur = this.state$.getValue();
    const idx = cur.findIndex(s => s.id === id);
    if (idx === -1) return;
    const next = cur.slice();
    next[idx] = mutator(cur[idx]);
    this.persist(next);
  }

  remove(id: string): void {
    const next = this.state$.getValue().filter(s => s.id !== id);
    this.persist(next);
  }

  clearAll(): void {
    this.persist([]);
  }

  /** True if the stamp can be cleared safely (was downloaded at least once). */
  canClear(s: OtsLocalStamp): boolean {
    return s.status === 'failed' || (s.status === 'ready' && s.downloadCount > 0);
  }

  private persist(stamps: OtsLocalStamp[]): void {
    const blob: OtsLocalStore = { version: SCHEMA_VERSION, stamps };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    } catch {
      // Storage quota or disabled (private mode, restrictive policy). Best
      // effort: keep the in-memory state alive for this session.
    }
    this.state$.next(stamps);
  }

  private load(): OtsLocalStamp[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as OtsLocalStore;
      if (parsed?.version !== SCHEMA_VERSION || !Array.isArray(parsed.stamps)) {
        return [];
      }
      return parsed.stamps;
    } catch {
      return [];
    }
  }
}

// ---- byte/base64 helpers (used by anything that reads/writes calendar bodies) ----

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hexEncode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    const h = b[i].toString(16);
    s += h.length === 1 ? '0' + h : h;
  }
  return s;
}

// ---- .ots file assembly ----

/** Get the freshest bytes for a calendar's branch.
 *
 * If the calendar has been upgraded: returns [ops_to_commitment] + [upgrade_response].
 * The PendingAttestation is dropped (it's redundant once the BitcoinAttestation is in).
 *
 * If still pending: returns the original /digest body unchanged.
 */
export function bestCalendarBytes(c: OtsLocalCalendar): Uint8Array {
  const pending = base64ToBytes(c.pendingBase64);
  if (!c.upgradedBase64) return pending;
  const opsOnly = sliceOpsBeforeAttestation(pending);
  const upgrade = base64ToBytes(c.upgradedBase64);
  const out = new Uint8Array(opsOnly.length + upgrade.length);
  out.set(opsOnly, 0);
  out.set(upgrade, opsOnly.length);
  return out;
}
