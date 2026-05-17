import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReadableStream } from 'stream/web';

import { OtsVerifyComponent } from './ots-verify.component';
import { OtsCalendarPickerService } from './ots-calendar-picker.service';

/*
Covers the discriminated-union Status state machine in ots-verify.component.ts:

  idle
   |--(1 plain file dropped)--> file-only
   |--(>1 .ots dropped)-------> error("Drop one .ots receipt at a time.")
   |--(multi-chain .ots)------> error("non-Bitcoin chains")
   |--(pending-only .ots)-----> verified (fileMatch: null)
   |--(.ots + original file)--> verified (fileMatch.matchesReceipt: true)
   |
  verified
   |--(matching original dropped)----> verified + fileMatch.matchesReceipt: true
   |--(wrong original dropped)-------> verified + fileMatch.matchesReceipt: false
   |--(.ots dropped to file-zone)----> error("wants ORIGINAL FILE")
   |--(reset() called)---------------> idle

All transitions tested without network: fixtures are inlined as base64,
the calendar-picker is stubbed to skip the /stamp-calendars fetch, and we
deliberately use pending-only receipts (no Bitcoin attestations, so
checkAttestation never fires).
*/

// --- inlined fixtures (small, real on-disk OTS bytes from ordpool-parser/testdata) ---

/** ots_incomplete.txt.ots: pending-only receipt for "The timestamp on this file is incomplete...\n",
 *  single PendingAttestation pointing at alice.btc.calendar.opentimestamps.org. */
const INCOMPLETE_OTS_B64 =
  'AE9wZW5UaW1lc3RhbXBzAABQcm9vZgC/ieLohOiSlAEIBcT2FqjlMQ0Z2TjP12mGTX9MzcLKi0ebEK+DVksJevnwEOdUv5OAan66poDve9ARS/QI8BC1c+iFDP2eY9HwQ/u2/CUOCPEEV8+lxPAIb7GsjU5OsOcAg9/jDS75DI4uLWh0dHBzOi8vYWxpY2UuYnRjLmNhbGVuZGFyLm9wZW50aW1lc3RhbXBzLm9yZw==';

/** ots_incomplete.txt: the actual 63-byte original file that incomplete.txt.ots receipt is for. */
const INCOMPLETE_FILE_B64 =
  'VGhlIHRpbWVzdGFtcCBvbiB0aGlzIGZpbGUgaXMgaW5jb21wbGV0ZSwgYW5kIGNhbiBiZSB1cGdyYWRlZC4K';

/** ots_different-blockchains.txt.ots: multi-chain receipt with KECCAK256 ops (Ethereum).
 *  Parser throws when it hits the unimplemented op; component must catch and surface
 *  the educational error message. */
const MULTICHAIN_OTS_B64 =
  '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';

function b64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Build a File-shaped object the component will actually be able to read in
 *  jsdom. jsdom@20's Blob has gaps (slice().arrayBuffer() throws, Blob.stream()
 *  isn't a real WHATWG ReadableStream). We satisfy the exact methods
 *  ots-verify reaches for: .name, .slice(begin, end).arrayBuffer(),
 *  .arrayBuffer(), .stream() (consumed by sha256Stream's getReader path).
 *  Backed by the underlying Uint8Array; no global mutation. */
function makeFile(name: string, bytes: Uint8Array): File {
  const asBlob = (slice: Uint8Array): Blob => ({
    size: slice.length,
    type: '',
    arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
    text:        async () => new TextDecoder().decode(slice),
    slice:       (a = 0, b = slice.length) => asBlob(slice.slice(a, b)),
    stream: (): ReadableStream<Uint8Array> => {
      let emitted = false;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (emitted) { controller.close(); return; }
          emitted = true;
          controller.enqueue(slice);
        },
      }) as unknown as ReadableStream<Uint8Array>;
    },
  } as unknown as Blob);

  return {
    name,
    ...asBlob(bytes),
  } as unknown as File;
}

function makeCdr(): jest.Mocked<ChangeDetectorRef> {
  return { markForCheck: jest.fn() } as unknown as jest.Mocked<ChangeDetectorRef>;
}

function makePicker(): jest.Mocked<OtsCalendarPickerService> {
  return {
    // Pending-only receipts mean verifyOts only calls picker.pick() for
    // nickname lookup, never the network. Return a single entry so the
    // size > 0 branch is satisfied.
    pick: jest.fn().mockResolvedValue([
      { nickname: 'alice', url: 'https://alice.btc.calendar.opentimestamps.org' },
    ]),
  } as unknown as jest.Mocked<OtsCalendarPickerService>;
}

/** TestBed-based wiring -- the component uses `inject()` for DI which
 *  requires an active injection context, so plain `new` doesn't work.
 *  We configure a minimal module with just the deps we care about
 *  stubbing; we're testing the class as a state machine, not the template. */
function makeComponent() {
  const cdr = makeCdr();
  const picker = makePicker();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      OtsVerifyComponent,
      { provide: ChangeDetectorRef,         useValue: cdr },
      { provide: OtsCalendarPickerService,  useValue: picker },
    ],
  });
  const comp = TestBed.inject(OtsVerifyComponent);
  return { comp, cdr, picker };
}

// --- the state-machine tests ---

describe('OtsVerifyComponent — state machine', () => {

  // Scoped crypto.subtle injection: jsdom@20's window.crypto has
  // randomUUID but no .subtle. The OTS parser uses crypto.subtle.digest
  // for SHA-256/SHA-1 internally, so without this the parse() throws
  // before the component can even reach the verified branch.
  // We borrow Node's webcrypto, install it for this describe block only,
  // and restore the original after. No global mutation outside this file.
  let originalCrypto: Crypto | undefined;
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { webcrypto } = require('crypto') as { webcrypto: Crypto };
    originalCrypto = (globalThis as { crypto?: Crypto }).crypto;
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  });
  afterAll(() => {
    if (originalCrypto !== undefined) {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
    }
  });

  it('starts in the idle state', () => {
    const { comp } = makeComponent();
    expect(comp.status.kind).toBe('idle');
  });

  it('idle -> file-only: a single plain file with no .ots', async () => {
    const { comp } = makeComponent();
    const file = makeFile('hello.txt', new TextEncoder().encode('hello, world'));
    await (comp as unknown as { handleFiles(f: File[]): Promise<void> }).handleFiles([file]);
    expect(comp.status.kind).toBe('file-only');
  });

  it('idle -> error: dropping more than one .ots at a time', async () => {
    const { comp } = makeComponent();
    const a = makeFile('a.ots', b64ToUint8Array(INCOMPLETE_OTS_B64));
    const b = makeFile('b.ots', b64ToUint8Array(INCOMPLETE_OTS_B64));
    await (comp as unknown as { handleFiles(f: File[]): Promise<void> }).handleFiles([a, b]);
    expect(comp.status.kind).toBe('error');
    if (comp.status.kind === 'error') {
      expect(comp.status.message).toContain('one .ots');
    }
  });

  it('idle -> error: multi-chain receipt (Ethereum / Litecoin ops)', async () => {
    const { comp } = makeComponent();
    const ots = makeFile('multi.ots', b64ToUint8Array(MULTICHAIN_OTS_B64));
    await (comp as unknown as { handleFiles(f: File[]): Promise<void> }).handleFiles([ots]);
    expect(comp.status.kind).toBe('error');
    if (comp.status.kind === 'error') {
      // The component rewrites parser's KECCAK256 / RIPEMD160 / "not yet
      // implemented" raw error into a user-facing educational message.
      expect(comp.status.message.toLowerCase()).toContain('ethereum');
    }
  });

  it('idle -> verified: pending-only .ots receipt parses, no Bitcoin attestations', async () => {
    const { comp, picker } = makeComponent();
    const ots = makeFile('incomplete.txt.ots', b64ToUint8Array(INCOMPLETE_OTS_B64));
    await (comp as unknown as { handleFiles(f: File[]): Promise<void> }).handleFiles([ots]);

    expect(comp.status.kind).toBe('verified');
    expect(picker.pick).toHaveBeenCalled();   // nickname lookup happened
    if (comp.status.kind === 'verified') {
      expect(comp.status.receipt.fileHashAlgo).toBe('sha256');
      expect(comp.status.receipt.bitcoinAttestations.length).toBe(0);
      expect(comp.status.receipt.pendingCalendars.length).toBeGreaterThan(0);
      expect(comp.status.fileMatch).toBeNull();
    }
  });

  it('idle -> verified+fileMatch (true): .ots and matching original file dropped together', async () => {
    const { comp } = makeComponent();
    const ots = makeFile('incomplete.txt.ots', b64ToUint8Array(INCOMPLETE_OTS_B64));
    const file = makeFile('incomplete.txt', b64ToUint8Array(INCOMPLETE_FILE_B64));
    await (comp as unknown as { handleFiles(f: File[]): Promise<void> }).handleFiles([ots, file]);

    expect(comp.status.kind).toBe('verified');
    if (comp.status.kind === 'verified') {
      expect(comp.status.fileMatch).not.toBeNull();
      expect(comp.status.fileMatch!.matchesReceipt).toBe(true);
      expect(comp.status.fileMatch!.filename).toBe('incomplete.txt');
    }
  });

  it('idle -> verified+fileMatch (false): .ots dropped with the wrong original', async () => {
    const { comp } = makeComponent();
    const ots = makeFile('incomplete.txt.ots', b64ToUint8Array(INCOMPLETE_OTS_B64));
    const wrong = makeFile('totally-wrong.txt', new TextEncoder().encode('not the file the receipt is for'));
    await (comp as unknown as { handleFiles(f: File[]): Promise<void> }).handleFiles([ots, wrong]);

    expect(comp.status.kind).toBe('verified');
    if (comp.status.kind === 'verified') {
      expect(comp.status.fileMatch).not.toBeNull();
      expect(comp.status.fileMatch!.matchesReceipt).toBe(false);
    }
  });

  it('verified -> verified+fileMatch: dropping the original file after a .ots-only verify', async () => {
    const { comp } = makeComponent();
    const ots = makeFile('incomplete.txt.ots', b64ToUint8Array(INCOMPLETE_OTS_B64));
    await (comp as unknown as { handleFiles(f: File[]): Promise<void> }).handleFiles([ots]);
    expect(comp.status.kind).toBe('verified');

    // Now drop the original file into the match sub-zone.
    const file = makeFile('incomplete.txt', b64ToUint8Array(INCOMPLETE_FILE_B64));
    await (comp as unknown as { matchAgainstReceipt(f: File): Promise<void> }).matchAgainstReceipt(file);

    expect(comp.status.kind).toBe('verified');
    if (comp.status.kind === 'verified') {
      expect(comp.status.fileMatch).not.toBeNull();
      expect(comp.status.fileMatch!.matchesReceipt).toBe(true);
    }
  });

  it('verified -> verified+fileMatch: dropping the original file into the MAIN zone after verify', async () => {
    // Real-world UX: after the .ots verifies and shows the verdict, users
    // tend to drop the original file into the same main dropzone they
    // used for the receipt -- not the secondary sub-zone. Component must
    // route through to the match path instead of flashing "looks like a
    // regular file" (which historically happened before this regression
    // was caught on prod).
    const { comp } = makeComponent();
    const ots = makeFile('incomplete.txt.ots', b64ToUint8Array(INCOMPLETE_OTS_B64));
    await (comp as unknown as { handleFiles(f: File[]): Promise<void> }).handleFiles([ots]);
    expect(comp.status.kind).toBe('verified');

    // Now drop the original file into the MAIN zone (handleFiles), not
    // the sub-zone (matchAgainstReceipt).
    const file = makeFile('incomplete.txt', b64ToUint8Array(INCOMPLETE_FILE_B64));
    await (comp as unknown as { handleFiles(f: File[]): Promise<void> }).handleFiles([file]);

    expect(comp.status.kind).toBe('verified');
    if (comp.status.kind === 'verified') {
      expect(comp.status.fileMatch).not.toBeNull();
      expect(comp.status.fileMatch!.matchesReceipt).toBe(true);
    }
  });

  it('verified -> error: dropping a .ots into the file-match sub-zone', async () => {
    const { comp } = makeComponent();
    const ots = makeFile('incomplete.txt.ots', b64ToUint8Array(INCOMPLETE_OTS_B64));
    await (comp as unknown as { handleFiles(f: File[]): Promise<void> }).handleFiles([ots]);
    expect(comp.status.kind).toBe('verified');

    // User mistakenly drops another .ots into the sub-zone that expects the
    // original file. Component must refuse with the educational error.
    const wrongDrop = makeFile('other.ots', b64ToUint8Array(INCOMPLETE_OTS_B64));
    await (comp as unknown as { matchAgainstReceipt(f: File): Promise<void> }).matchAgainstReceipt(wrongDrop);

    expect(comp.status.kind).toBe('error');
    if (comp.status.kind === 'error') {
      expect(comp.status.message).toMatch(/ORIGINAL FILE/i);
    }
  });

  it('reset() returns to idle and clears the cached receipt', async () => {
    const { comp } = makeComponent();
    const ots = makeFile('incomplete.txt.ots', b64ToUint8Array(INCOMPLETE_OTS_B64));
    await (comp as unknown as { handleFiles(f: File[]): Promise<void> }).handleFiles([ots]);
    expect(comp.status.kind).toBe('verified');

    comp.reset();
    expect(comp.status.kind).toBe('idle');

    // A subsequent matchAgainstReceipt call is now a no-op (the cached
    // receipt was cleared). Status must NOT flip back to verified.
    const file = makeFile('incomplete.txt', b64ToUint8Array(INCOMPLETE_FILE_B64));
    await (comp as unknown as { matchAgainstReceipt(f: File): Promise<void> }).matchAgainstReceipt(file);
    expect(comp.status.kind).toBe('idle');
  });
});
