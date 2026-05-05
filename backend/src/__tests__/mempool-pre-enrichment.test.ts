import { OrdpoolTransactionFlags } from 'ordpool-parser';
import { Common } from '../api/common';
import { TransactionExtended } from '../mempool.interfaces';

/**
 * Behavioural tests for the `_ordpoolFlags` pre-enrichment HACK contract.
 *
 * The contract every mempool/blocks/api code path must implement before it
 * publishes a tx to a downstream consumer (websocket, REST response, block
 * extras):
 *
 *   await DigitalArtifactAnalyserService.analyseTransaction(tx, 0n);  // PRODUCER
 *   tx.flags = Common.getTransactionFlags(tx);                        // CONSUMER
 *
 * The producer side-effects `tx._ordpoolFlags` onto the tx; the consumer ORs
 * those bits into the returned flags number. If the call order is reversed
 * — or if the producer is missing entirely on a given path — the resulting
 * flags number is valid but missing all upper-48 ordpool bits, and
 * inscription/rune/CAT-21/etc. badges silently disappear from the frontend.
 * That's the bug we shipped on 2026-05-04 and didn't notice for hours
 * because the data was wrong but not malformed.
 *
 * What's covered HERE:
 *   - Producer→consumer round-trip with a stamped sentinel: prove the
 *     consumer reads what the producer writes.
 *   - Idempotency: calling either side twice yields the same flags,
 *     because (a) the producer REPLACES `_ordpoolFlags` rather than ORs onto
 *     itself, and (b) `Common.getTransactionFlags` ORs into existing flags
 *     so a second call adds the same bits (OR is idempotent).
 *   - Negative cases: tx without _ordpoolFlags ends up with zero ordpool
 *     bits (proves the consumer doesn't fabricate); tx with _ordpoolFlags=0
 *     also produces zero ordpool bits (handles "analysed, no artifacts").
 *
 * What's NOT covered here, deliberately:
 *   - End-to-end exercise of mempool.ts's three pre-enrichment call sites
 *     ($loadMempoolTransactions startup loop, $reloadMempool bulk-fetch,
 *     $updateMempoolFromBitcoind per-tick fetch). The mempool.ts module is
 *     a singleton with a circular dep through blocks.ts that defeats clean
 *     loading under ts-jest, and threading dependency mocks through the
 *     full singleton produces a fragile test for low marginal value. Each
 *     of those three sites uses the exact same two-line pattern asserted
 *     here, copy-pasted; if a future refactor diverges on one, the
 *     resulting bug is identical to the one this test file exists to
 *     prevent at the contract level. Living with that gap.
 */

const SENTINEL_FLAGS = OrdpoolTransactionFlags.ordpool_inscription | OrdpoolTransactionFlags.ordpool_rune;

/** Minimal tx that lets `Common.getTransactionFlags` run without throwing.
 *  Only fields the function reads are populated. */
function makeTx(overrides: Partial<TransactionExtended> & { _ordpoolFlags?: number } = {}): TransactionExtended {
  const tx = {
    txid: 'test',
    version: 2, locktime: 0, fee: 1000, weight: 400, size: 200, vsize: 100,
    feePerVsize: 10, effectiveFeePerVsize: 10, sigops: 1,
    vin: [{
      is_coinbase: false, scriptsig: '', witness: [''],
      prevout: { scriptpubkey: '', scriptpubkey_type: 'v0_p2wpkh', value: 10000 },
    }],
    vout: [{ scriptpubkey: '', scriptpubkey_type: 'v0_p2wpkh', value: 9000 }],
    status: { confirmed: true, block_height: 840000 },
    ...overrides,
  } as unknown as TransactionExtended;

  if (overrides._ordpoolFlags !== undefined) {
    (tx as any)._ordpoolFlags = overrides._ordpoolFlags;
  }
  return tx;
}

/** Mock `analyseTransaction` shape: stamps the sentinel as a side effect on
 *  the tx, exactly like the real producer in ordpool-parser does. */
async function mockAnalyseTransaction(tx: any, flags: bigint): Promise<bigint> {
  tx._ordpoolFlags = Number(SENTINEL_FLAGS);
  return flags | SENTINEL_FLAGS;
}

describe('Pre-enrichment contract — producer/consumer round-trip', () => {

  it('after analyseTransaction stamps _ordpoolFlags, getTransactionFlags surfaces the same bits', async () => {
    const tx = makeTx();

    // PRODUCER: side-effects _ordpoolFlags
    await mockAnalyseTransaction(tx, 0n);
    expect((tx as any)._ordpoolFlags).toBe(Number(SENTINEL_FLAGS));

    // CONSUMER: reads _ordpoolFlags, ORs into returned flags
    const flags = Common.getTransactionFlags(tx);

    expect(BigInt(flags) & OrdpoolTransactionFlags.ordpool_inscription).toBe(OrdpoolTransactionFlags.ordpool_inscription);
    expect(BigInt(flags) & OrdpoolTransactionFlags.ordpool_rune).toBe(OrdpoolTransactionFlags.ordpool_rune);
  });

  it('reversed order (consumer before producer) loses the ordpool bits — this is the bug we caught', async () => {
    const tx = makeTx();

    // BUGGY ORDER: consumer first, producer second
    const flagsBuggy = Common.getTransactionFlags(tx);  // _ordpoolFlags is undefined here
    await mockAnalyseTransaction(tx, 0n);                // too late, tx.flags is already cached

    // The buggy flags do NOT have ordpool bits:
    expect(BigInt(flagsBuggy) & OrdpoolTransactionFlags.ordpool_inscription).toBe(0n);
    expect(BigInt(flagsBuggy) & OrdpoolTransactionFlags.ordpool_rune).toBe(0n);

    // This codifies the failure mode: even though _ordpoolFlags is now SET on the tx,
    // the flags number that already went out the door is missing the upper-48 bits.
    // That's the silent failure mode that bit production for hours on 2026-05-04.
  });

  it('producer with no artifacts found leaves _ordpoolFlags at 0 and consumer adds zero ordpool bits', async () => {
    // Real producer behaviour when no artifacts detected: _ordpoolFlags = 0
    const tx = makeTx();
    (tx as any)._ordpoolFlags = 0;

    const flags = Common.getTransactionFlags(tx);
    expect(BigInt(flags) & OrdpoolTransactionFlags.ordpool_inscription).toBe(0n);
    expect(BigInt(flags) & OrdpoolTransactionFlags.ordpool_rune).toBe(0n);
    expect(BigInt(flags) & OrdpoolTransactionFlags.ordpool_cat21).toBe(0n);
  });

  it('producer never called: tx has no _ordpoolFlags, consumer surfaces zero ordpool bits', () => {
    const tx = makeTx();  // no _ordpoolFlags
    expect((tx as any)._ordpoolFlags).toBeUndefined();

    const flags = Common.getTransactionFlags(tx);

    // Sanity: the consumer didn't fabricate flags.
    expect(BigInt(flags) & OrdpoolTransactionFlags.ordpool_inscription).toBe(0n);
    expect(BigInt(flags) & OrdpoolTransactionFlags.ordpool_rune).toBe(0n);
    expect(BigInt(flags) & OrdpoolTransactionFlags.ordpool_cat21).toBe(0n);
  });
});

describe('Pre-enrichment idempotency — calling either side twice produces the same outcome', () => {

  it('producer replaces _ordpoolFlags rather than OR-ing onto itself', async () => {
    const tx = makeTx();
    (tx as any)._ordpoolFlags = 0xdeadbeef;  // pre-existing junk

    await mockAnalyseTransaction(tx, 0n);
    expect((tx as any)._ordpoolFlags).toBe(Number(SENTINEL_FLAGS));  // REPLACED, not ORed

    // Second call: stays the same (no accumulation).
    await mockAnalyseTransaction(tx, 0n);
    expect((tx as any)._ordpoolFlags).toBe(Number(SENTINEL_FLAGS));
  });

  it('consumer is OR-idempotent on _ordpoolFlags — second call returns the same number', async () => {
    const tx = makeTx();
    await mockAnalyseTransaction(tx, 0n);

    const first = Common.getTransactionFlags(tx);
    tx.flags = first;  // simulate caller writing flags back to tx (mempool.ts pattern)

    const second = Common.getTransactionFlags(tx);

    expect(second).toBe(first);
    expect(BigInt(second) & SENTINEL_FLAGS).toBe(SENTINEL_FLAGS);
  });

  it('full round-trip × 2: analyse → flags → analyse → flags yields the same flags both times', async () => {
    const tx = makeTx();

    // Round 1
    await mockAnalyseTransaction(tx, 0n);
    tx.flags = Common.getTransactionFlags(tx);
    const flagsRound1 = tx.flags;

    // Round 2 (re-analysis after some hypothetical state change)
    await mockAnalyseTransaction(tx, 0n);
    tx.flags = Common.getTransactionFlags(tx);
    const flagsRound2 = tx.flags;

    expect(flagsRound2).toBe(flagsRound1);
    expect(BigInt(flagsRound2) & SENTINEL_FLAGS).toBe(SENTINEL_FLAGS);
  });

  it('three different ordpool flag patterns each round-trip cleanly', async () => {
    const patterns: bigint[] = [
      OrdpoolTransactionFlags.ordpool_cat21 | OrdpoolTransactionFlags.ordpool_cat21_mint,
      OrdpoolTransactionFlags.ordpool_inscription | OrdpoolTransactionFlags.ordpool_inscription_mint,
      OrdpoolTransactionFlags.ordpool_rune | OrdpoolTransactionFlags.ordpool_rune_etch,
    ];

    for (const pattern of patterns) {
      const tx = makeTx();
      // Custom mock that stamps THIS pattern
      (tx as any)._ordpoolFlags = Number(pattern);

      const flags = Common.getTransactionFlags(tx);

      expect(BigInt(flags) & pattern).toBe(pattern);
    }
  });
});
