import { TestBed } from '@angular/core/testing';
import { assembleOtsFile } from 'ordpool-parser';

import {
  OtsStoreService,
  OtsLocalCalendar,
  OtsLocalStamp,
  OTS_FALLBACK_CALENDARS,
  bestCalendarBytes,
  bytesToBase64,
  base64ToBytes,
  hexEncode,
} from './ots-store.service';

const HEADER_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

/** A minimal calendar reply: one append op + a pending attestation. */
function fakeCalendarBody(uri: string): Uint8Array {
  // append (0xf0) + varuint(8) + 8 bytes
  const ops = new Uint8Array([0xf0, 0x08, 1, 2, 3, 4, 5, 6, 7, 8]);
  // attestation: 0x00 + 8-byte pending tag + varuint payload-len + payload
  // payload = varuint(uri-bytes-len) + uri bytes
  const uriBytes = new TextEncoder().encode(uri);
  const PENDING_TAG = new Uint8Array([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
  // Two layers of varbytes: outer = sub-stream containing [varuint(uri-len) + uri]
  // The inner reads via OtsReader.readVarbytes which itself reads a varuint.
  // For our needs (testing slice/assemble), the exact attestation bytes only
  // matter as a 0x00 marker we can find; the pending-attestation parsing logic
  // is exercised in ordpool-parser's own spec.
  const out = new Uint8Array(1 + 8 + 1 + 1 + uriBytes.length + ops.length);
  out.set(ops, 0);
  let p = ops.length;
  out[p++] = 0x00;
  out.set(PENDING_TAG, p); p += 8;
  out[p++] = uriBytes.length + 1;     // outer varbytes length
  out[p++] = uriBytes.length;         // inner varbytes length
  out.set(uriBytes, p);
  return out;
}

describe('OtsStoreService - bytes helpers', () => {

  describe('bytesToBase64 / base64ToBytes round-trip', () => {
    it('encodes and decodes binary cleanly across all byte values', () => {
      const original = new Uint8Array(256);
      for (let i = 0; i < 256; i++) original[i] = i;
      const round = base64ToBytes(bytesToBase64(original));
      expect(round.length).toBe(original.length);
      for (let i = 0; i < 256; i++) expect(round[i]).toBe(i);
    });

    it('handles empty input', () => {
      expect(bytesToBase64(new Uint8Array(0))).toBe('');
      expect(base64ToBytes('')).toEqual(new Uint8Array(0));
    });
  });

  describe('hexEncode', () => {
    it('lower-cases, zero-pads single-digit bytes', () => {
      expect(hexEncode(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
    });
  });

  describe('assembleOtsFile', () => {
    const fileHash = new Uint8Array(32).fill(0xab);   // 32-byte sha256

    it('throws on empty subtree array', () => {
      expect(() => assembleOtsFile(fileHash, [])).toThrow();
    });

    it('emits a valid header for a single-branch .ots', () => {
      const body = fakeCalendarBody('https://alice.example.org');
      const out = assembleOtsFile(fileHash, [body]);
      // header (31) + 1 (version) + 1 (sha256 op) + 32 (digest) + body
      expect(out.length).toBe(31 + 1 + 1 + 32 + body.length);
      expect(out.slice(0, 31)).toEqual(HEADER_MAGIC);
      expect(out[31]).toBe(0x01);                       // major version
      expect(out[32]).toBe(0x08);                       // sha256 file-hash op
      expect(out.slice(33, 33 + 32)).toEqual(fileHash);
      expect(out.slice(65)).toEqual(body);
    });

    it('inserts 0xff between siblings, not before the last one', () => {
      const a = fakeCalendarBody('https://alice.example.org');
      const b = fakeCalendarBody('https://bob.example.org');
      const c = fakeCalendarBody('https://finney.example.org');
      const out = assembleOtsFile(fileHash, [a, b, c]);
      // expected layout: header + ver + tag + hash + 0xff + a + 0xff + b + c
      const expectedLen = 31 + 1 + 1 + 32 + 1 + a.length + 1 + b.length + c.length;
      expect(out.length).toBe(expectedLen);
      expect(out[65]).toBe(0xff);
      expect(out[65 + 1 + a.length]).toBe(0xff);
      // tail = c, no trailing 0xff
      expect(out.slice(out.length - c.length)).toEqual(c);
    });
  });

  describe('OTS_FALLBACK_CALENDARS (config regression guard)', () => {
    it('catallaxy is configured at its CANONICAL URL (not the ots.btc alias)', () => {
      // Pre-2026-05-17 history: catallaxy was configured as
      // https://ots.btc.catallaxy.com. Both subdomains accept /digest
      // and return identical receipts -- but the receipt always embeds
      // the canonical https://btc.calendar.catallaxy.com as its
      // pending-attestation URI. Our submit code does strict equality
      // between cal.url and the embedded URI, so the alias config
      // caused every catallaxy stamp to be marked "error" in the UI
      // even though the calendar happily accepted it.
      //
      // Fixed in commit 115e33a32 by switching the config to the
      // canonical URL. This assertion pins it.
      const catallaxy = OTS_FALLBACK_CALENDARS.find(c => c.nickname === 'catallaxy');
      expect(catallaxy).toBeDefined();
      expect(catallaxy!.url).toBe('https://btc.calendar.catallaxy.com');
      // And not the historical alias, just to be explicit:
      expect(catallaxy!.url).not.toBe('https://ots.btc.catallaxy.com');
    });

    it('all fallback URLs use https and have no trailing slash', () => {
      for (const c of OTS_FALLBACK_CALENDARS) {
        expect(c.url).toMatch(/^https:\/\//);
        expect(c.url).not.toMatch(/\/$/);
        expect(c.nickname).toBeTruthy();
      }
    });
  });

  describe('bestCalendarBytes (splice on upgrade)', () => {
    it('returns pending body unchanged when no upgrade present', () => {
      const body = fakeCalendarBody('https://alice.example.org');
      const c: OtsLocalCalendar = {
        nickname: 'alice', uri: 'https://alice.example.org',
        pendingBase64: bytesToBase64(body),
        commitmentHex: 'deadbeef',
        upgradedBase64: null,
        lastCheckedAt: 0, lastResult: 'pending', errorMessage: null,
      };
      expect(bestCalendarBytes(c)).toEqual(body);
    });

    it('drops the PendingAttestation portion and appends the upgrade body', () => {
      const pending = fakeCalendarBody('https://alice.example.org');
      const upgrade = new Uint8Array([0x08, 0x00, 0xfe, 0xfe]);   // arbitrary continuation bytes
      const c: OtsLocalCalendar = {
        nickname: 'alice', uri: 'https://alice.example.org',
        pendingBase64: bytesToBase64(pending),
        commitmentHex: 'deadbeef',
        upgradedBase64: bytesToBase64(upgrade),
        lastCheckedAt: 0, lastResult: 'published', errorMessage: null,
      };
      const out = bestCalendarBytes(c);
      // pending starts with `[op1 = 0xf0, len, data...]` (10 bytes), then 0x00.
      // sliceOpsBeforeAttestation should have stopped right before the 0x00.
      expect(out.length).toBe(10 + upgrade.length);
      expect(out.slice(0, 10)).toEqual(pending.slice(0, 10));
      expect(out.slice(10)).toEqual(upgrade);
    });
  });
});

describe('OtsStoreService - persistence', () => {
  let svc: OtsStoreService;

  function makeStamp(over: Partial<OtsLocalStamp> = {}): OtsLocalStamp {
    return {
      id: 'test-id-1',
      filename: 'doc.txt',
      fileHashAlgo: 'sha256',
      fileHashHex: 'aa'.repeat(32),
      submittedAt: 1700000000000,
      calendars: [],
      status: 'queued',
      readyAt: null,
      downloadedAt: null,
      downloadCount: 0,
      ...over,
    };
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [OtsStoreService] });
    svc = TestBed.inject(OtsStoreService);
  });

  it('starts empty when localStorage has nothing', () => {
    expect(svc.snapshot()).toEqual([]);
    expect(svc.localStorageAvailable).toBe(true);
  });

  it('add() persists to localStorage and updates the stream', (done) => {
    const stamp = makeStamp();
    svc.stamps$().subscribe(s => {
      if (s.length === 1) {
        expect(s[0].id).toBe('test-id-1');
        const raw = localStorage.getItem('ordpool:ots:pending');
        expect(raw).toContain('test-id-1');
        done();
      }
    });
    svc.add(stamp);
  });

  it('update() mutates an existing stamp; missing id is a no-op', () => {
    svc.add(makeStamp({ id: 'a' }));
    svc.update('a', s => ({ ...s, downloadCount: 7 }));
    expect(svc.snapshot()[0].downloadCount).toBe(7);
    svc.update('does-not-exist', s => ({ ...s, downloadCount: 99 }));   // no-op
    expect(svc.snapshot().length).toBe(1);
    expect(svc.snapshot()[0].downloadCount).toBe(7);
  });

  it('remove() drops a stamp by id', () => {
    svc.add(makeStamp({ id: 'a' }));
    svc.add(makeStamp({ id: 'b' }));
    svc.remove('a');
    expect(svc.snapshot().map(s => s.id)).toEqual(['b']);
  });

  it('canClear() gates by status + downloadCount', () => {
    const queued = makeStamp({ status: 'queued', downloadCount: 0 });
    const readyUndl = makeStamp({ status: 'ready', downloadCount: 0 });
    const readyDl = makeStamp({ status: 'ready', downloadCount: 1 });
    const failed = makeStamp({ status: 'failed' });
    expect(svc.canClear(queued)).toBe(false);
    expect(svc.canClear(readyUndl)).toBe(false);
    expect(svc.canClear(readyDl)).toBe(true);
    expect(svc.canClear(failed)).toBe(true);
  });

  it('rehydrates a corrupt JSON blob to empty (does not throw)', () => {
    localStorage.setItem('ordpool:ots:pending', '{ broken json');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [OtsStoreService] });
    const fresh = TestBed.inject(OtsStoreService);
    expect(fresh.snapshot()).toEqual([]);
  });

  it('rehydrates a wrong-schema blob (no version) to empty', () => {
    localStorage.setItem('ordpool:ots:pending', JSON.stringify({ stamps: [makeStamp()] }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [OtsStoreService] });
    const fresh = TestBed.inject(OtsStoreService);
    expect(fresh.snapshot()).toEqual([]);
  });
});
