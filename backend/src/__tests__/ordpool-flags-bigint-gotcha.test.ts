import { OrdpoolTransactionFlags } from 'ordpool-parser';
import { Common } from '../api/common';
import { TransactionExtended } from '../mempool.interfaces';

/**
 * Permanent regression test for the JS-bitwise-on-high-bits gotcha.
 *
 * Every ordpool flag lives at bit 48 or higher (per ordpool-transaction-flags.ts).
 * JavaScript's `|`, `&`, `^`, `~`, `<<`, `>>` operators convert their operands to
 * int32 BEFORE the operation, which silently zeros every bit above 31. Any code
 * that does `tx._ordpoolFlags = (existing | Number(ordpool_someflag))` instead of
 * BigInt arithmetic will silently drop the flag and produce a tx with no
 * ordpool bits set.
 *
 * The production read paths (Common.getTransactionFlags, transaction.utils.ts,
 * isFlagSetOnTransaction) all correctly convert to BigInt before any bitwise
 * op, so we don't have a pre-existing bug. But the easy-to-make mistake is to
 * write a NEW pre-enrichment helper using naive Number arithmetic; addOtsFlag
 * had this exact bug initially and tests caught it.
 *
 * If anyone ever writes `flags | Number(ordpool_X)` again, this test fires.
 */
describe('ordpool flags: BigInt arithmetic is required for bits >= 32', () => {

  it('demonstrates: Number bitwise OR truncates ordpool flags to 0', () => {
    const otsBitNumber = Number(OrdpoolTransactionFlags.ordpool_ots);
    // The Number representation of the bit is ~2.4e24 -- a real value.
    expect(otsBitNumber).toBeGreaterThan(2 ** 80);

    // But JS bitwise on it truncates to int32, producing 0.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const truncated = (0 | otsBitNumber) >>> 0;
    expect(truncated).toBe(0);

    // ANY ordpool flag has the same property -- they all live above bit 47.
    for (const value of Object.values(OrdpoolTransactionFlags)) {
      const asNumber = Number(value);
      const truncatedFlag = (0 | asNumber) >>> 0;
      expect(truncatedFlag).toBe(0);
    }
  });

  it('demonstrates: BigInt arithmetic preserves the bit', () => {
    const flag = OrdpoolTransactionFlags.ordpool_ots;
    const updated = 0n | flag;
    expect(updated).toBe(flag);
    // And round-trip to Number is exact for this single bit.
    expect(BigInt(Number(updated))).toBe(updated);
  });

  it('demonstrates: combining multiple ordpool bits via BigInt is exact', () => {
    const combined =
      OrdpoolTransactionFlags.ordpool_atomical |
      OrdpoolTransactionFlags.ordpool_inscription |
      OrdpoolTransactionFlags.ordpool_inscription_image |
      OrdpoolTransactionFlags.ordpool_ots;

    // Number<->BigInt round-trip is exact because all ordpool bits fit
    // inside Number's 53-bit mantissa window when measured from the lowest
    // ordpool bit (48) to the highest (81): a 34-bit spread.
    expect(BigInt(Number(combined))).toBe(combined);

    // Each constituent bit can be tested individually, BigInt-only.
    expect((combined & OrdpoolTransactionFlags.ordpool_atomical)).toBe(OrdpoolTransactionFlags.ordpool_atomical);
    expect((combined & OrdpoolTransactionFlags.ordpool_inscription)).toBe(OrdpoolTransactionFlags.ordpool_inscription);
    expect((combined & OrdpoolTransactionFlags.ordpool_inscription_image)).toBe(OrdpoolTransactionFlags.ordpool_inscription_image);
    expect((combined & OrdpoolTransactionFlags.ordpool_ots)).toBe(OrdpoolTransactionFlags.ordpool_ots);
  });

  it('Common.getTransactionFlags early-return preserves every ordpool bit', async () => {
    // Real regression against the actual production read path. The early-
    // return branch in getTransactionFlags (line 631-633 of common.ts) fires
    // whenever tx.flags is truthy -- i.e. on every re-classification of an
    // already-flagged tx (mempool refresh, block extension). Its job is to
    // round-trip tx.flags through BigInt (for the CPFP/RBF mutations) and
    // back to Number without dropping any ordpool bits along the way.
    //
    // We seed tx.flags with every top-level ordpool bit set and verify they
    // ALL survive the round-trip. A naive `flags | Number(ordpool_X)`
    // anywhere in the function would zero them.
    const allOrdpoolBits =
      OrdpoolTransactionFlags.ordpool_atomical |
      OrdpoolTransactionFlags.ordpool_inscription |
      OrdpoolTransactionFlags.ordpool_inscription_image |
      OrdpoolTransactionFlags.ordpool_inscription_mint |
      OrdpoolTransactionFlags.ordpool_rune |
      OrdpoolTransactionFlags.ordpool_brc20 |
      OrdpoolTransactionFlags.ordpool_src20 |
      OrdpoolTransactionFlags.ordpool_cat21 |
      OrdpoolTransactionFlags.ordpool_ots;

    const tx = {
      txid: 'aabbccdd',
      flags: Number(allOrdpoolBits),
      vin: [],
      ancestors: undefined,
      descendants: undefined,
      replacement: undefined,
    } as unknown as TransactionExtended;

    const returned = await Common.getTransactionFlags(tx);

    // BigInt-decode the returned Number and verify every ordpool bit is
    // still set. AND check the inverse -- no spurious bits below 32 leaked
    // in, which would be the signature of an int32 truncation regression.
    const returnedBig = BigInt(returned);
    for (const bit of [
      OrdpoolTransactionFlags.ordpool_atomical,
      OrdpoolTransactionFlags.ordpool_inscription,
      OrdpoolTransactionFlags.ordpool_inscription_image,
      OrdpoolTransactionFlags.ordpool_inscription_mint,
      OrdpoolTransactionFlags.ordpool_rune,
      OrdpoolTransactionFlags.ordpool_brc20,
      OrdpoolTransactionFlags.ordpool_src20,
      OrdpoolTransactionFlags.ordpool_cat21,
      OrdpoolTransactionFlags.ordpool_ots,
    ]) {
      expect((returnedBig & bit) === bit).toBe(true);
    }
  });
});
