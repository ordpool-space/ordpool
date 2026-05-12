import { OrdpoolTransactionFlags } from 'ordpool-parser';
import { attachIsOtsCommit, getOtsFlag, setIsOtsCommitByTxid } from './ordpool-ots-flag';
import ordpoolOtsTxidSet from './ordpool-ots-txid-set';

const OTS_BIT = OrdpoolTransactionFlags.ordpool_ots;
const INSCRIPTION_BIT = OrdpoolTransactionFlags.ordpool_inscription;

beforeEach(() => {
  ordpoolOtsTxidSet.reset();
});

describe('getOtsFlag', () => {

  it('returns the OTS bit (bigint) when the txid is in the set', () => {
    ordpoolOtsTxidSet.add('aabb');
    expect(getOtsFlag('aabb')).toBe(OTS_BIT);
  });

  it('returns 0n when the txid is NOT in the set', () => {
    expect(getOtsFlag('aabb')).toBe(0n);
  });

  it('returns 0n for the empty set', () => {
    // No add() call -- set is empty after reset() in beforeEach.
    expect(getOtsFlag('whatever')).toBe(0n);
  });

  it('is idempotent: two calls produce the same bigint, no state change', () => {
    ordpoolOtsTxidSet.add('aabb');
    const first = getOtsFlag('aabb');
    const second = getOtsFlag('aabb');
    expect(first).toBe(OTS_BIT);
    expect(second).toBe(OTS_BIT);
    expect(first).toBe(second);
  });

  it('returns a bigint (not a Number)', () => {
    ordpoolOtsTxidSet.add('aabb');
    const result = getOtsFlag('aabb');
    // typeof check pins the contract -- a Number would silently truncate
    // to int32 when callers do `|`, zeroing out bit 81.
    expect(typeof result).toBe('bigint');
  });

  it('OR-into-existing-flags preserves other bits', () => {
    ordpoolOtsTxidSet.add('aabb');
    const seed = INSCRIPTION_BIT;
    const combined = seed | getOtsFlag('aabb');
    expect((combined & INSCRIPTION_BIT)).toBe(INSCRIPTION_BIT);
    expect((combined & OTS_BIT)).toBe(OTS_BIT);
  });

  it('OR-into-existing-flags with OTS already set is idempotent', () => {
    // Regression for the audit gap: the previous test never seeded
    // OTS_BIT before re-applying. Pinning the OR semantics on the
    // bit-being-tested.
    ordpoolOtsTxidSet.add('aabb');
    const seed = OTS_BIT;
    const combined = seed | getOtsFlag('aabb');
    expect(combined).toBe(OTS_BIT);
  });

  it('distinguishes between txids in the set and txids not in the set', () => {
    ordpoolOtsTxidSet.add('aaaa');
    ordpoolOtsTxidSet.add('cccc');
    expect(getOtsFlag('aaaa')).toBe(OTS_BIT);
    expect(getOtsFlag('bbbb')).toBe(0n);
    expect(getOtsFlag('cccc')).toBe(OTS_BIT);
  });
});

describe('attachIsOtsCommit — strip-wire helper for tx objects', () => {

  it('sets tx.isOtsCommit = true when the txid is in the set', () => {
    ordpoolOtsTxidSet.add('aabb');
    const tx = { txid: 'aabb' } as { txid: string; isOtsCommit?: boolean | null };
    attachIsOtsCommit(tx);
    expect(tx.isOtsCommit).toBe(true);
  });

  it('sets tx.isOtsCommit = false when the txid is NOT in the set', () => {
    const tx = { txid: 'aabb' } as { txid: string; isOtsCommit?: boolean | null };
    attachIsOtsCommit(tx);
    expect(tx.isOtsCommit).toBe(false);
  });

  it('overwrites a previously-set isOtsCommit (last writer wins)', () => {
    ordpoolOtsTxidSet.add('aabb');
    const tx = { txid: 'aabb', isOtsCommit: null } as { txid: string; isOtsCommit?: boolean | null };
    attachIsOtsCommit(tx);
    expect(tx.isOtsCommit).toBe(true);
  });

  it('returns the same tx object for fluent chaining', () => {
    const tx = { txid: 'aabb' } as { txid: string; isOtsCommit?: boolean | null };
    const result = attachIsOtsCommit(tx);
    expect(result).toBe(tx);
  });

  it('does not touch other fields on the tx', () => {
    const tx = { txid: 'aabb', fee: 1000, vin: [], vout: [{ scriptpubkey_type: 'op_return' }] } as any;
    attachIsOtsCommit(tx);
    expect(tx.txid).toBe('aabb');
    expect(tx.fee).toBe(1000);
    expect(tx.vin).toEqual([]);
    expect(tx.vout).toEqual([{ scriptpubkey_type: 'op_return' }]);
  });
});

describe('setIsOtsCommitByTxid — strip-wire helper for tracking-info objects', () => {

  it('sets info.isOtsCommit = true when the txid is in the set', () => {
    ordpoolOtsTxidSet.add('aabb');
    const info: { isOtsCommit?: boolean | null } = {};
    setIsOtsCommitByTxid('aabb', info);
    expect(info.isOtsCommit).toBe(true);
  });

  it('sets info.isOtsCommit = false when the txid is NOT in the set', () => {
    const info: { isOtsCommit?: boolean | null } = {};
    setIsOtsCommitByTxid('aabb', info);
    expect(info.isOtsCommit).toBe(false);
  });

  it('returns the same info object for fluent chaining', () => {
    const info: { isOtsCommit?: boolean | null } = {};
    expect(setIsOtsCommitByTxid('aabb', info)).toBe(info);
  });

  it('does not touch other fields on the info', () => {
    const info: any = { replacedBy: 'parent', confirmed: false };
    setIsOtsCommitByTxid('aabb', info);
    expect(info.replacedBy).toBe('parent');
    expect(info.confirmed).toBe(false);
  });
});
