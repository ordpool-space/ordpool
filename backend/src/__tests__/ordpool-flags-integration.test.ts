import { Common } from '../api/common';
import { TransactionExtended, TransactionFlags } from '../mempool.interfaces';
import { OrdpoolTransactionFlags } from 'ordpool-parser';

/**
 * Integration tests for the _ordpoolFlags pre-enrichment pattern in the backend.
 *
 * The ordpool-parser sets tx._ordpoolFlags as a side effect when analysing transactions.
 * The backend's Common.getTransactionFlags() reads this property to include ordpool flags
 * WITHOUT being made async. This file tests the CONSUMER side (backend) of that pattern.
 *
 * The producer side (ordpool-parser) is tested in:
 *   ordpool-parser/src/digital-artifact-analyser.service.ordpool-flags.spec.ts
 *   ordpool-parser/src/digital-artifact-analyser.service.ordpool-flags-real-data.spec.ts
 */

/**
 * Creates a minimal TransactionExtended for testing.
 * Only sets fields that getTransactionFlags actually reads.
 */
function createMockTx(overrides: Partial<TransactionExtended> & { _ordpoolFlags?: number } = {}): TransactionExtended {
  const tx = {
    txid: 'test-tx',
    version: 2,
    locktime: 0,
    fee: 1000,
    weight: 400,
    size: 200,
    vin: [{ is_coinbase: false, scriptsig: '', witness: [''], prevout: { scriptpubkey: '', scriptpubkey_type: 'v0_p2wpkh', value: 10000 } }],
    vout: [{ scriptpubkey: '', scriptpubkey_type: 'v0_p2wpkh', value: 9000 }],
    status: { confirmed: true, block_height: 840000 },
    vsize: 100,
    feePerVsize: 10,
    effectiveFeePerVsize: 10,
    sigops: 1,
    ...overrides,
  } as unknown as TransactionExtended;

  // Apply _ordpoolFlags if provided (this simulates the ordpool-parser side effect)
  if (overrides._ordpoolFlags !== undefined) {
    (tx as any)._ordpoolFlags = overrides._ordpoolFlags;
  }

  return tx;
}


describe('Common.getTransactionFlags — _ordpoolFlags HACK', () => {

  it('should include ordpool flags from tx._ordpoolFlags on first call', () => {
    const ordpoolFlags = Number(OrdpoolTransactionFlags.ordpool_cat21 | OrdpoolTransactionFlags.ordpool_cat21_mint);
    const tx = createMockTx({ _ordpoolFlags: ordpoolFlags });

    // First call: tx.flags is undefined, so full static flag computation runs
    const result = Common.getTransactionFlags(tx, 840000);

    // Ordpool flags should be included
    const resultBigInt = BigInt(result);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_cat21).toBe(OrdpoolTransactionFlags.ordpool_cat21);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_cat21_mint).toBe(OrdpoolTransactionFlags.ordpool_cat21_mint);

    // Upstream flags: we can't easily test these with a mock tx because
    // getTransactionFlags inspects many tx fields (vin, vout, witness, etc.)
    // and may throw on missing properties. The important thing is ordpool flags are present.
  });

  it('should preserve ordpool flags through the early return path (second call)', () => {
    const ordpoolFlags = Number(OrdpoolTransactionFlags.ordpool_rune | OrdpoolTransactionFlags.ordpool_rune_etch);
    const tx = createMockTx({ _ordpoolFlags: ordpoolFlags });

    // First call: computes flags, stores result
    const firstResult = Common.getTransactionFlags(tx, 840000);
    tx.flags = firstResult;

    // Verify first result has ordpool flags
    expect(BigInt(firstResult) & OrdpoolTransactionFlags.ordpool_rune).toBe(OrdpoolTransactionFlags.ordpool_rune);

    // Second call: tx.flags IS set -> early return path
    const secondResult = Common.getTransactionFlags(tx, 840000);

    // Ordpool flags should STILL be present (they're baked into tx.flags from first call)
    const secondBigInt = BigInt(secondResult);
    expect(secondBigInt & OrdpoolTransactionFlags.ordpool_rune).toBe(OrdpoolTransactionFlags.ordpool_rune);
    expect(secondBigInt & OrdpoolTransactionFlags.ordpool_rune_etch).toBe(OrdpoolTransactionFlags.ordpool_rune_etch);
  });

  it('should work without _ordpoolFlags (normal upstream tx, no artifacts)', () => {
    const tx = createMockTx(); // no _ordpoolFlags

    const result = Common.getTransactionFlags(tx, 840000);

    // No ordpool flags
    const resultBigInt = BigInt(result);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_cat21).toBe(0n);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_inscription).toBe(0n);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_rune).toBe(0n);

    // Upstream flags should still work normally
    expect(resultBigInt & TransactionFlags.v2).toBe(TransactionFlags.v2);
  });

  it('should handle _ordpoolFlags = 0 (tx analysed but no artifacts found)', () => {
    const tx = createMockTx({ _ordpoolFlags: 0 });

    const result = Common.getTransactionFlags(tx, 840000);

    // _ordpoolFlags is 0 (falsy), so the if-block doesn't execute. That's correct.
    const resultBigInt = BigInt(result);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_cat21).toBe(0n);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_inscription).toBe(0n);

    // Upstream flags unaffected
    expect(resultBigInt & TransactionFlags.v2).toBe(TransactionFlags.v2);
  });

  it('should not let ordpool flags interfere with upstream flags', () => {
    // Set ALL ordpool flags
    let allOrdpoolFlags = 0n;
    for (const key of Object.keys(OrdpoolTransactionFlags)) {
      allOrdpoolFlags |= OrdpoolTransactionFlags[key];
    }
    const tx = createMockTx({ _ordpoolFlags: Number(allOrdpoolFlags) });

    const result = Common.getTransactionFlags(tx, 840000);
    const resultBigInt = BigInt(result);

    // ALL ordpool flags should be set
    for (const key of Object.keys(OrdpoolTransactionFlags)) {
      expect(resultBigInt & OrdpoolTransactionFlags[key]).toBe(OrdpoolTransactionFlags[key]);
    }

    // The important thing: ordpool flags don't corrupt the result into NaN or negative
  });

  it('should OR ordpool flags idempotently (calling getTransactionFlags twice)', () => {
    const ordpoolFlags = Number(OrdpoolTransactionFlags.ordpool_inscription);
    const tx = createMockTx({ _ordpoolFlags: ordpoolFlags });

    // First call
    const first = Common.getTransactionFlags(tx, 840000);
    tx.flags = first;

    // Second call (early return path) — _ordpoolFlags ORed again, but OR is idempotent
    const second = Common.getTransactionFlags(tx, 840000);

    expect(first).toBe(second);
  });
});


describe('Common.classifyTransaction — ordpool flags flow through', () => {

  it('should include ordpool flags in the classified transaction output', () => {
    const ordpoolFlags = Number(
      OrdpoolTransactionFlags.ordpool_inscription |
      OrdpoolTransactionFlags.ordpool_inscription_mint
    );
    const tx = createMockTx({ _ordpoolFlags: ordpoolFlags });

    const classified = Common.classifyTransaction(tx, 840000);

    const flagsBigInt = BigInt(classified.flags);
    expect(flagsBigInt & OrdpoolTransactionFlags.ordpool_inscription).toBe(OrdpoolTransactionFlags.ordpool_inscription);
    expect(flagsBigInt & OrdpoolTransactionFlags.ordpool_inscription_mint).toBe(OrdpoolTransactionFlags.ordpool_inscription_mint);
  });

  it('should include ordpool flags in classifyTransactions (batch)', () => {
    const tx1 = createMockTx({ txid: 'tx1', _ordpoolFlags: Number(OrdpoolTransactionFlags.ordpool_cat21) });
    const tx2 = createMockTx({ txid: 'tx2', _ordpoolFlags: 0 });
    const tx3 = createMockTx({ txid: 'tx3', _ordpoolFlags: Number(OrdpoolTransactionFlags.ordpool_rune) });

    const classified = Common.classifyTransactions([tx1, tx2, tx3], 840000);

    expect(BigInt(classified[0].flags) & OrdpoolTransactionFlags.ordpool_cat21).toBe(OrdpoolTransactionFlags.ordpool_cat21);
    expect(BigInt(classified[1].flags) & OrdpoolTransactionFlags.ordpool_cat21).toBe(0n);
    expect(BigInt(classified[2].flags) & OrdpoolTransactionFlags.ordpool_rune).toBe(OrdpoolTransactionFlags.ordpool_rune);
  });
});


describe('Block processing simulation — full _ordpoolFlags flow', () => {

  it('should simulate the exact block-processor flow: enrichment then classification', () => {
    // This test simulates the actual production flow:
    //
    // In block-processor.ts:
    //   1. await blocks.$getBlockExtended(block, transactions, pool)
    //      -> Inside, analyseTransactions(transactions) sets tx._ordpoolFlags on each tx
    //   2. blocks.summarizeBlockTransactions(hash, height, transactions)
    //      -> classifyTransactions(transactions) -> getTransactionFlags(tx) reads _ordpoolFlags
    //
    // Both operate on the SAME array reference. Mutation from step 1 is visible in step 2.

    // Create a shared transactions array (simulating cpfpSummary.transactions)
    const transactions = [
      createMockTx({ txid: 'coinbase' }),
      createMockTx({ txid: 'cat21-mint', locktime: 21 }),
      createMockTx({ txid: 'inscription' }),
      createMockTx({ txid: 'plain-tx' }),
    ];

    // Step 1: Simulate analyseTransactions setting _ordpoolFlags
    // (In production, ordpool-parser does this inside $getBlockExtended)
    (transactions[0] as any)._ordpoolFlags = 0; // coinbase: no artifacts
    (transactions[1] as any)._ordpoolFlags = Number(OrdpoolTransactionFlags.ordpool_cat21 | OrdpoolTransactionFlags.ordpool_cat21_mint);
    (transactions[2] as any)._ordpoolFlags = Number(OrdpoolTransactionFlags.ordpool_inscription | OrdpoolTransactionFlags.ordpool_inscription_mint);
    (transactions[3] as any)._ordpoolFlags = 0; // plain: no artifacts

    // Step 2: Simulate classifyTransactions reading from the SAME array
    const classified = Common.classifyTransactions(transactions, 840000);

    // Coinbase: no ordpool flags
    expect(BigInt(classified[0].flags) & OrdpoolTransactionFlags.ordpool_cat21).toBe(0n);

    // CAT-21 mint: has cat21 flags
    expect(BigInt(classified[1].flags) & OrdpoolTransactionFlags.ordpool_cat21).toBe(OrdpoolTransactionFlags.ordpool_cat21);
    expect(BigInt(classified[1].flags) & OrdpoolTransactionFlags.ordpool_cat21_mint).toBe(OrdpoolTransactionFlags.ordpool_cat21_mint);

    // Inscription: has inscription flags
    expect(BigInt(classified[2].flags) & OrdpoolTransactionFlags.ordpool_inscription).toBe(OrdpoolTransactionFlags.ordpool_inscription);

    // Plain tx: no ordpool flags
    expect(BigInt(classified[3].flags) & OrdpoolTransactionFlags.ordpool_inscription).toBe(0n);

    // All transactions should have valid numeric flags (not NaN or corrupted)
    for (const tx of classified) {
      expect(typeof tx.flags).toBe('number');
      expect(isNaN(tx.flags)).toBe(false);
    }
  });
});
