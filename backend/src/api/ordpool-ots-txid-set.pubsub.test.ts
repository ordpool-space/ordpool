import ordpoolOtsTxidSet from './ordpool-ots-txid-set';

jest.mock('../logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), err: jest.fn() },
}));

beforeEach(() => {
  ordpoolOtsTxidSet.reset();
});

describe('OrdpoolOtsTxidSet — pub-sub (foundation for WS re-push on OTS flip)', () => {

  it('add(txid) returns true for a new addition', () => {
    expect(ordpoolOtsTxidSet.add('aabb')).toBe(true);
  });

  it('add(txid) returns false when the txid is already present', () => {
    ordpoolOtsTxidSet.add('aabb');
    expect(ordpoolOtsTxidSet.add('aabb')).toBe(false);
  });

  it('subscribe(cb) fires on a new addition', () => {
    const cb = jest.fn();
    ordpoolOtsTxidSet.subscribe(cb);
    ordpoolOtsTxidSet.add('aabb');
    expect(cb).toHaveBeenCalledWith('aabb');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('subscribe(cb) does NOT fire when the txid is already present', () => {
    ordpoolOtsTxidSet.add('aabb');
    const cb = jest.fn();
    ordpoolOtsTxidSet.subscribe(cb);
    expect(ordpoolOtsTxidSet.add('aabb')).toBe(false);
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires multiple subscribers in registration order', () => {
    const calls: string[] = [];
    ordpoolOtsTxidSet.subscribe(t => calls.push(`a:${t}`));
    ordpoolOtsTxidSet.subscribe(t => calls.push(`b:${t}`));
    ordpoolOtsTxidSet.add('xxxx');
    expect(calls).toEqual(['a:xxxx', 'b:xxxx']);
  });

  it('returned unsubscribe function removes only that subscriber', () => {
    const cbA = jest.fn();
    const cbB = jest.fn();
    const unsubA = ordpoolOtsTxidSet.subscribe(cbA);
    ordpoolOtsTxidSet.subscribe(cbB);
    unsubA();
    ordpoolOtsTxidSet.add('xxxx');
    expect(cbA).not.toHaveBeenCalled();
    expect(cbB).toHaveBeenCalledWith('xxxx');
  });

  it('a throwing subscriber does not break the others or the add()', () => {
    const cbA = jest.fn(() => { throw new Error('boom'); });
    const cbB = jest.fn();
    ordpoolOtsTxidSet.subscribe(cbA);
    ordpoolOtsTxidSet.subscribe(cbB);
    expect(() => ordpoolOtsTxidSet.add('yyyy')).not.toThrow();
    expect(cbA).toHaveBeenCalled();
    expect(cbB).toHaveBeenCalledWith('yyyy');
    expect(ordpoolOtsTxidSet.has('yyyy')).toBe(true);
  });

  it('bootstrap does NOT fire subscribers (raw native Set.add path)', async () => {
    // Mock the repo to feed bootstrap a fixed set of txids.
    const cb = jest.fn();
    ordpoolOtsTxidSet.subscribe(cb);

    // The set has its own reference to ordpoolOtsRepository; bypass by
    // poking the internal set directly via a manual add() loop -- but
    // ONLY because bootstrap's behaviour-to-test is exactly that it
    // does NOT call add(). We simulate the "many txids loaded from DB
    // during bootstrap" path by checking the production code branch.
    //
    // Actually simpler: use the real bootstrap with a mocked repo.
    const repo = require('../repositories/OrdpoolOtsRepository').default;
    const original = repo.getAllTxids;
    repo.getAllTxids = jest.fn().mockResolvedValue(['boot1', 'boot2', 'boot3']);
    try {
      await ordpoolOtsTxidSet.bootstrap();
    } finally {
      repo.getAllTxids = original;
    }

    expect(ordpoolOtsTxidSet.size()).toBe(3);
    expect(ordpoolOtsTxidSet.has('boot1')).toBe(true);
    expect(cb).not.toHaveBeenCalled();  // <- the load-bearing assertion
  });

  it('reset() clears subscribers too', () => {
    const cb = jest.fn();
    ordpoolOtsTxidSet.subscribe(cb);
    ordpoolOtsTxidSet.reset();
    ordpoolOtsTxidSet.add('xxxx');
    expect(cb).not.toHaveBeenCalled();
  });
});
