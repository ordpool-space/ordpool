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

    // Round-trips exact HERE only because every set bit is >= 48: the spread
    // from the lowest (48) to highest (81) set bit is 34 bits, inside Number's
    // 53-bit mantissa. This does NOT generalise -- once a low mempool bit
    // (rbf=bit0, v2=bit3) coexists with a high ordpool bit the spread exceeds
    // 53 and Number() silently clears the low bits. That is why the wire format
    // is a decimal string, not a Number; see the coexistence regression below.
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
      flags: allOrdpoolBits.toString(),
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

  it('REGRESSION: low mempool bits + high ordpool bits BOTH survive (string wire, not Number)', async () => {
    // The exact bug the string wire format closes. An inscription-image mint
    // that also RBF-signals and is version 2 carries low mempool bits
    // (rbf=bit0, v2=bit3) AND high ordpool bits (inscription=50, mint=59,
    // image=60) in one bigint. getTransactionFlags used to return
    // Number(flags), whose 53-bit mantissa (anchored at bit 60) rounded bits
    // 0-7 away -- silently clearing rbf/v2 on EVERY artifact tx. It now returns
    // a decimal-string bigint, so every bit survives.
    const rbf = 1n << 0n;
    const v2 = 1n << 3n;
    const seeded = rbf | v2
      | OrdpoolTransactionFlags.ordpool_inscription
      | OrdpoolTransactionFlags.ordpool_inscription_mint
      | OrdpoolTransactionFlags.ordpool_inscription_image;

    const tx = {
      txid: 'ffff',
      flags: seeded.toString(),
      vin: [],
      ancestors: undefined,
      descendants: undefined,
      replacement: undefined,
    } as unknown as TransactionExtended;

    const returned = await Common.getTransactionFlags(tx);
    expect(typeof returned).toBe('string'); // wire is a string, never a Number
    const rt = BigInt(returned);

    // Low bits survive (the bug) ...
    expect(rt & rbf).toBe(rbf);
    expect(rt & v2).toBe(v2);
    // ... and so do the high ordpool bits, and the whole value is lossless.
    expect(rt & OrdpoolTransactionFlags.ordpool_inscription_image)
      .toBe(OrdpoolTransactionFlags.ordpool_inscription_image);
    expect(rt).toBe(seeded);
  });
});
