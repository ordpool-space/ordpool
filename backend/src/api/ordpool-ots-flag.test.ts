import { OrdpoolTransactionFlags } from 'ordpool-parser';
import { addOtsFlag, addOtsFlagBatch } from './ordpool-ots-flag';
import ordpoolOtsTxidSet from './ordpool-ots-txid-set';

const OTS_BIT = OrdpoolTransactionFlags.ordpool_ots;
const INSCRIPTION_BIT = OrdpoolTransactionFlags.ordpool_inscription;

/** BigInt-backed bit-test: JS bitwise truncates to int32 so bits >47 zero out. */
function hasBit(flags: number | undefined, bit: bigint): boolean {
  return (BigInt(flags ?? 0) & bit) === bit;
}

beforeEach(() => {
  ordpoolOtsTxidSet.reset();
});

describe('addOtsFlag', () => {

  it('sets the ordpool_ots bit when the txid is in the set', () => {
    ordpoolOtsTxidSet.add('aabb');
    const tx = { txid: 'aabb', _ordpoolFlags: 0 };
    addOtsFlag(tx);
    expect(hasBit(tx._ordpoolFlags, OTS_BIT)).toBe(true);
  });

  it('does NOT touch _ordpoolFlags when the txid is not in the set', () => {
    const before = Number(INSCRIPTION_BIT);
    const tx = { txid: 'aabb', _ordpoolFlags: before };
    addOtsFlag(tx);
    expect(tx._ordpoolFlags).toBe(before);
  });

  it('preserves existing flags when ORing in the ots bit', () => {
    ordpoolOtsTxidSet.add('aabb');
    const tx = { txid: 'aabb', _ordpoolFlags: Number(INSCRIPTION_BIT) };
    addOtsFlag(tx);
    expect(hasBit(tx._ordpoolFlags, INSCRIPTION_BIT)).toBe(true);
    expect(hasBit(tx._ordpoolFlags, OTS_BIT)).toBe(true);
  });

  it('treats undefined _ordpoolFlags as 0', () => {
    ordpoolOtsTxidSet.add('aabb');
    const tx: { txid: string; _ordpoolFlags?: number } = { txid: 'aabb' };
    addOtsFlag(tx);
    expect(hasBit(tx._ordpoolFlags, OTS_BIT)).toBe(true);
  });

  it('is idempotent: calling twice does not change the result', () => {
    ordpoolOtsTxidSet.add('aabb');
    const tx = { txid: 'aabb', _ordpoolFlags: 0 };
    addOtsFlag(tx);
    const after1 = tx._ordpoolFlags;
    addOtsFlag(tx);
    expect(tx._ordpoolFlags).toBe(after1);
  });

  it('combined with other ordpool bits: round-trip Number<->BigInt is exact', () => {
    ordpoolOtsTxidSet.add('aabb');
    // Pre-existing parser-derived bits: every ordpool top-level type flag set.
    const start =
      OrdpoolTransactionFlags.ordpool_atomical |
      OrdpoolTransactionFlags.ordpool_inscription |
      OrdpoolTransactionFlags.ordpool_rune |
      OrdpoolTransactionFlags.ordpool_brc20 |
      OrdpoolTransactionFlags.ordpool_inscription_mint;
    const tx = { txid: 'aabb', _ordpoolFlags: Number(start) };
    addOtsFlag(tx);
    expect(BigInt(tx._ordpoolFlags!)).toBe(start | OTS_BIT);
  });
});

describe('addOtsFlagBatch', () => {

  it('flags only the txs whose txids are in the set', () => {
    ordpoolOtsTxidSet.add('aaaa');
    ordpoolOtsTxidSet.add('cccc');
    const txs = [
      { txid: 'aaaa', _ordpoolFlags: 0 },
      { txid: 'bbbb', _ordpoolFlags: 0 },
      { txid: 'cccc', _ordpoolFlags: Number(INSCRIPTION_BIT) },
    ];
    addOtsFlagBatch(txs);
    expect(hasBit(txs[0]._ordpoolFlags, OTS_BIT)).toBe(true);
    expect(hasBit(txs[1]._ordpoolFlags, OTS_BIT)).toBe(false);
    expect(hasBit(txs[2]._ordpoolFlags, OTS_BIT)).toBe(true);
    expect(hasBit(txs[2]._ordpoolFlags, INSCRIPTION_BIT)).toBe(true);
  });

  it('handles empty input', () => {
    expect(() => addOtsFlagBatch([])).not.toThrow();
  });
});
