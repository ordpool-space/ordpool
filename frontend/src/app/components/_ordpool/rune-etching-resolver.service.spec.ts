jest.mock('ordpool-sdk', () => ({
  resolveRuneEtchingTxid: jest.fn(),
}));

import { resolveRuneEtchingTxid } from 'ordpool-sdk';
import { RuneEtchingResolverService } from './rune-etching-resolver.service';

const mockResolve = resolveRuneEtchingTxid as jest.MockedFunction<typeof resolveRuneEtchingTxid>;
// A macrotask runs after the promise microtasks in ensureResolved's then/finally.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const TXID = (c: string) => c.repeat(64);

describe('RuneEtchingResolverService', () => {
  let svc: RuneEtchingResolverService;

  beforeEach(() => {
    mockResolve.mockReset();
    svc = new RuneEtchingResolverService();
  });

  it('caches a positive answer under the rune name, keyed to the given ord base', async () => {
    mockResolve.mockResolvedValue(TXID('a'));
    svc.ensureResolved('ANARCHY', 'http://ord');
    await flush();
    expect(svc.resolved().get('ANARCHY')).toBe(TXID('a'));
    expect(mockResolve).toHaveBeenCalledWith('ANARCHY', { ordBaseUrl: 'http://ord' });
  });

  it('NEVER caches a null answer (reserved rune / all-zero etching), and a later call retries', async () => {
    mockResolve.mockResolvedValueOnce(null);
    svc.ensureResolved('UNCOMMON', 'http://ord');
    await flush();
    expect(svc.resolved().has('UNCOMMON')).toBe(false);

    mockResolve.mockResolvedValueOnce(TXID('b'));
    svc.ensureResolved('UNCOMMON', 'http://ord');
    await flush();
    expect(svc.resolved().get('UNCOMMON')).toBe(TXID('b'));
    expect(mockResolve).toHaveBeenCalledTimes(2);
  });

  it('never caches a rejected lookup, and a later call retries', async () => {
    mockResolve.mockRejectedValueOnce(new Error('network'));
    svc.ensureResolved('R', 'http://ord');
    await flush();
    expect(svc.resolved().has('R')).toBe(false);

    mockResolve.mockResolvedValueOnce(TXID('c'));
    svc.ensureResolved('R', 'http://ord');
    await flush();
    expect(svc.resolved().get('R')).toBe(TXID('c'));
  });

  it('dedupes concurrent lookups for the same name', () => {
    mockResolve.mockReturnValue(new Promise(() => {})); // never settles
    svc.ensureResolved('R', 'http://ord');
    svc.ensureResolved('R', 'http://ord');
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it('skips a name already resolved', async () => {
    mockResolve.mockResolvedValue(TXID('d'));
    svc.ensureResolved('R', 'http://ord');
    await flush();
    svc.ensureResolved('R', 'http://ord');
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it('resolves independent names without one blocking the other', async () => {
    let releaseA!: (v: string) => void;
    mockResolve.mockImplementation((name: string) =>
      name === 'A'
        ? new Promise<string>((r) => { releaseA = r; })
        : Promise.resolve(TXID('e')));
    svc.ensureResolved('A', 'http://ord'); // hangs
    svc.ensureResolved('B', 'http://ord'); // settles now
    await flush();
    expect(svc.resolved().get('B')).toBe(TXID('e')); // B not blocked by A
    expect(svc.resolved().has('A')).toBe(false);

    releaseA(TXID('f'));
    await flush();
    expect(svc.resolved().get('A')).toBe(TXID('f'));
  });
});
