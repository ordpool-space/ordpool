import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/*
Test cases:
- Single browser, multiple stamps queued: each gets its own row.
- Refresh page: rows re-hydrate from localStorage.
- localStorage corrupted (manual edit): we recover by resetting to empty.
*/

const STORAGE_KEY = 'ordpool:ots:pending';
const SCHEMA_VERSION = 1;

export const OTS_CALENDARS: ReadonlyArray<string> = [
  'https://alice.btc.calendar.opentimestamps.org',
  'https://bob.btc.calendar.opentimestamps.org',
  'https://finney.calendar.eternitywall.com',
];

export type OtsStampStatus = 'queued' | 'ready' | 'failed';
export type OtsCalendarResult = 'pending' | 'published' | 'error' | 'never-checked';

export interface OtsLocalCalendar {
  uri: string;
  pendingBase64: string;            // bytes the calendar returned at /digest
  upgradedBase64: string | null;    // bytes the calendar returned at /timestamp/<hash> once published
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

const HEADER_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);
const VERSION_BYTE = 0x01;
const SHA256_FILE_HASH_TAG = 0x08;

/**
 * Assemble a complete v1 .ots file from a sha256 file digest and N calendar
 * subtrees. Each subtree is a calendar's reply body (raw bytes from /digest
 * or /timestamp/<hash>). Multiple subtrees become siblings under the root,
 * separated by 0xff continuation bytes (last subtree has no leading 0xff).
 *
 * Why we do this every download instead of pre-storing the assembled file:
 * subtrees may upgrade from pending to bitcoin-anchored independently, and
 * we want every download to include the freshest data.
 */
export function assembleOtsFile(fileHash: Uint8Array, subtrees: Uint8Array[]): Uint8Array {
  if (subtrees.length === 0) throw new Error('assembleOtsFile: at least one subtree required');
  let total = HEADER_MAGIC.length + 1 + 1 + fileHash.length;
  for (let i = 0; i < subtrees.length; i++) {
    total += subtrees[i].length + (i < subtrees.length - 1 ? 1 : 0);
  }
  const out = new Uint8Array(total);
  let p = 0;
  out.set(HEADER_MAGIC, p); p += HEADER_MAGIC.length;
  out[p++] = VERSION_BYTE;
  out[p++] = SHA256_FILE_HASH_TAG;
  out.set(fileHash, p); p += fileHash.length;
  for (let i = 0; i < subtrees.length; i++) {
    if (i < subtrees.length - 1) out[p++] = 0xff;
    out.set(subtrees[i], p); p += subtrees[i].length;
  }
  return out;
}

/** Get the freshest bytes for a calendar: upgraded if available, else pending. */
export function bestCalendarBytes(c: OtsLocalCalendar): Uint8Array {
  return base64ToBytes(c.upgradedBase64 ?? c.pendingBase64);
}
