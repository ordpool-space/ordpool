jest.mock('ordpool-sdk', () => ({
  lookupRuneEtching: jest.fn(),
}));

import { lookupRuneEtching } from 'ordpool-sdk';
import { RuneEtchingResolverService } from './rune-etching-resolver.service';

const mockLookup = lookupRuneEtching as jest.MockedFunction<typeof lookupRuneEtching>;
// A macrotask runs after the promise microtasks in ensureResolved's then/finally.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const TXID = (c: string) => c.repeat(64);

describe('RuneEtchingResolverService', () => {
  let svc: RuneEtchingResolverService;

  beforeEach(() => {
    mockLookup.mockReset();
    svc = new RuneEtchingResolverService();
  });

  it('caches an etched txid (renders a link)', async () => {
    mockLookup.mockResolvedValue({ kind: 'etched', txid: TXID('a') });
    svc.ensureResolved('ANARCHY', 'http://ord');
    await flush();
    expect(svc.resolved().get('ANARCHY')).toBe(TXID('a'));
    expect(mockLookup).toHaveBeenCalledWith('ANARCHY', { ordBaseUrl: 'http://ord' });
  });

  it('caches NOT-ETCHED permanently as null and never re-asks (the UNCOMMON•GOODS case)', async () => {
    mockLookup.mockResolvedValue({ kind: 'not-etched' });
    svc.ensureResolved('UNCOMMON', 'http://ord');
    await flush();
    expect(svc.resolved().has('UNCOMMON')).toBe(true);
    expect(svc.resolved().get('UNCOMMON')).toBeNull();
    // A later scan must NOT re-ask a permanent answer.
    svc.ensureResolved('UNCOMMON', 'http://ord');
    await flush();
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache unknown (rune may be etched later), and re-asks on a later scan', async () => {
    mockLookup.mockResolvedValueOnce({ kind: 'unknown' });
    svc.ensureResolved('NEWRUNE', 'http://ord');
    await flush();
    expect(svc.resolved().has('NEWRUNE')).toBe(false);
    // Etched in a later block: the re-ask now resolves to a link.
    mockLookup.mockResolvedValueOnce({ kind: 'etched', txid: TXID('b') });
    svc.ensureResolved('NEWRUNE', 'http://ord');
    await flush();
    expect(svc.resolved().get('NEWRUNE')).toBe(TXID('b'));
    expect(mockLookup).toHaveBeenCalledTimes(2);
  });

  it('does NOT cache unavailable (a failure), and retries', async () => {
    mockLookup.mockResolvedValueOnce({ kind: 'unavailable' });
    svc.ensureResolved('R', 'http://ord');
    await flush();
    expect(svc.resolved().has('R')).toBe(false);
    mockLookup.mockResolvedValueOnce({ kind: 'etched', txid: TXID('c') });
    svc.ensureResolved('R', 'http://ord');
    await flush();
    expect(svc.resolved().get('R')).toBe(TXID('c'));
  });

  it('does not cache a thrown lookup, and retries', async () => {
    mockLookup.mockRejectedValueOnce(new Error('boom'));
    svc.ensureResolved('R', 'http://ord');
    await flush();
    expect(svc.resolved().has('R')).toBe(false);
    mockLookup.mockResolvedValueOnce({ kind: 'etched', txid: TXID('d') });
    svc.ensureResolved('R', 'http://ord');
    await flush();
    expect(svc.resolved().get('R')).toBe(TXID('d'));
  });

  it('dedupes concurrent lookups for the same name', () => {
    mockLookup.mockReturnValue(new Promise(() => {})); // never settles
    svc.ensureResolved('R', 'http://ord');
    svc.ensureResolved('R', 'http://ord');
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it('resolves independent names without one blocking the other', async () => {
    let releaseA!: (v: { kind: 'etched'; txid: string }) => void;
    mockLookup.mockImplementation((name: string) =>
      name === 'A'
        ? new Promise((r) => { releaseA = r; })
        : Promise.resolve({ kind: 'etched', txid: TXID('e') }));
    svc.ensureResolved('A', 'http://ord'); // hangs
    svc.ensureResolved('B', 'http://ord'); // settles now
    await flush();
    expect(svc.resolved().get('B')).toBe(TXID('e'));
    expect(svc.resolved().has('A')).toBe(false);
    releaseA({ kind: 'etched', txid: TXID('f') });
    await flush();
    expect(svc.resolved().get('A')).toBe(TXID('f'));
  });
});
