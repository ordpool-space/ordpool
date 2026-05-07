import { DigitalArtifactAnalyserService, OrdpoolTransactionFlags } from 'ordpool-parser';

import { Common } from '../api/common';
import { TransactionExtended, TransactionFlags } from '../mempool.interfaces';

// Integration tests for the deep-wired async pattern: Common.getTransactionFlags
// awaits ordpool-parser inline. These tests verify the BACKEND consumer side —
// the parser's artifact detection is covered by ordpool-parser's own real-data
// tests. Here we mock the parser to control its return value and prove that:
//   1. getTransactionFlags awaits the parser and ORs its result into the flags
//   2. classifyTransaction / classifyTransactions propagate that all the way to TransactionClassified
//   3. parser failures don't crash the pipeline (logged + skipped)

function createMockTx(overrides: Partial<TransactionExtended> = {}): TransactionExtended {
  return {
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
}

describe('Common.getTransactionFlags — async parser integration', () => {

  let parseSpy: jest.SpyInstance;

  beforeEach(() => {
    parseSpy = jest.spyOn(DigitalArtifactAnalyserService, 'analyseTransaction');
  });

  afterEach(() => {
    parseSpy.mockRestore();
  });

  it('awaits the parser and ORs ordpool flags into the result', async () => {
    const ordpool = OrdpoolTransactionFlags.ordpool_cat21 | OrdpoolTransactionFlags.ordpool_cat21_mint;
    parseSpy.mockImplementation(async (_tx, flags: bigint) => flags | ordpool);

    const result = await Common.getTransactionFlags(createMockTx(), 840000);
    const resultBigInt = BigInt(result);

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_cat21).toBe(OrdpoolTransactionFlags.ordpool_cat21);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_cat21_mint).toBe(OrdpoolTransactionFlags.ordpool_cat21_mint);
  });

  it('skips the parser on the early-return path so we don\'t re-parse a tx whose flags are baked in', async () => {
    const ordpool = OrdpoolTransactionFlags.ordpool_rune | OrdpoolTransactionFlags.ordpool_rune_etch;
    parseSpy.mockImplementation(async (_tx, flags: bigint) => flags | ordpool);

    const tx = createMockTx();
    // First call: tx.flags is undefined → full classification + parser runs once.
    tx.flags = await Common.getTransactionFlags(tx, 840000);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(BigInt(tx.flags) & OrdpoolTransactionFlags.ordpool_rune).toBe(OrdpoolTransactionFlags.ordpool_rune);

    // Second call: tx.flags is set → early-return; parser is NOT called again.
    // Ordpool bits stay because they're already baked into tx.flags from the first call.
    const second = await Common.getTransactionFlags(tx, 840000);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(BigInt(second) & OrdpoolTransactionFlags.ordpool_rune).toBe(OrdpoolTransactionFlags.ordpool_rune);
    expect(BigInt(second) & OrdpoolTransactionFlags.ordpool_rune_etch).toBe(OrdpoolTransactionFlags.ordpool_rune_etch);
  });

  it('returns upstream-only flags when the parser sees no artifacts', async () => {
    parseSpy.mockImplementation(async (_tx, flags: bigint) => flags);

    const result = await Common.getTransactionFlags(createMockTx(), 840000);
    const resultBigInt = BigInt(result);

    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_cat21).toBe(0n);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_inscription).toBe(0n);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_rune).toBe(0n);
    // Upstream flags still computed (mock tx is v2 with v0_p2wpkh prevout)
    expect(resultBigInt & TransactionFlags.v2).toBe(TransactionFlags.v2);
  });

  it('does not corrupt the result when the parser sets every ordpool flag', async () => {
    let allOrdpool = 0n;
    for (const key of Object.keys(OrdpoolTransactionFlags)) {
      allOrdpool |= OrdpoolTransactionFlags[key];
    }
    parseSpy.mockImplementation(async (_tx, flags: bigint) => flags | allOrdpool);

    const result = await Common.getTransactionFlags(createMockTx(), 840000);
    const resultBigInt = BigInt(result);

    // ALL ordpool flags should be readable on the round-tripped Number
    for (const key of Object.keys(OrdpoolTransactionFlags)) {
      expect(resultBigInt & OrdpoolTransactionFlags[key]).toBe(OrdpoolTransactionFlags[key]);
    }
    expect(typeof result).toBe('number');
    expect(isNaN(result)).toBe(false);
  });

  it('continues when the parser throws (no crash, no flags set)', async () => {
    parseSpy.mockImplementation(async () => { throw new Error('boom'); });

    const result = await Common.getTransactionFlags(createMockTx(), 840000);
    const resultBigInt = BigInt(result);

    // The parser threw; getTransactionFlags caught + logged; the upstream-only
    // flags still come back valid (no NaN, no ordpool bits leaked through).
    expect(typeof result).toBe('number');
    expect(isNaN(result)).toBe(false);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_cat21).toBe(0n);
    expect(resultBigInt & OrdpoolTransactionFlags.ordpool_inscription).toBe(0n);
  });
});


describe('Common.classifyTransaction — async ordpool flow', () => {

  let parseSpy: jest.SpyInstance;

  beforeEach(() => {
    parseSpy = jest.spyOn(DigitalArtifactAnalyserService, 'analyseTransaction');
  });

  afterEach(() => {
    parseSpy.mockRestore();
  });

  it('includes ordpool flags in TransactionClassified.flags', async () => {
    const ordpool = OrdpoolTransactionFlags.ordpool_inscription | OrdpoolTransactionFlags.ordpool_inscription_mint;
    parseSpy.mockImplementation(async (_tx, flags: bigint) => flags | ordpool);

    const classified = await Common.classifyTransaction(createMockTx(), 840000);

    const flagsBigInt = BigInt(classified.flags);
    expect(flagsBigInt & OrdpoolTransactionFlags.ordpool_inscription).toBe(OrdpoolTransactionFlags.ordpool_inscription);
    expect(flagsBigInt & OrdpoolTransactionFlags.ordpool_inscription_mint).toBe(OrdpoolTransactionFlags.ordpool_inscription_mint);
  });

  it('classifyTransactions runs the parser per-tx and returns parallel results', async () => {
    const flagsByTxid: Record<string, bigint> = {
      a: OrdpoolTransactionFlags.ordpool_cat21,
      b: 0n,
      c: OrdpoolTransactionFlags.ordpool_rune,
    };
    parseSpy.mockImplementation(async (tx: any, flags: bigint) => flags | flagsByTxid[tx.txid]);

    const txs = [
      createMockTx({ txid: 'a' }),
      createMockTx({ txid: 'b' }),
      createMockTx({ txid: 'c' }),
    ];
    const classified = await Common.classifyTransactions(txs, 840000);

    expect(classified.length).toBe(3);
    expect(BigInt(classified[0].flags) & OrdpoolTransactionFlags.ordpool_cat21).toBe(OrdpoolTransactionFlags.ordpool_cat21);
    expect(BigInt(classified[1].flags) & OrdpoolTransactionFlags.ordpool_cat21).toBe(0n);
    expect(BigInt(classified[1].flags) & OrdpoolTransactionFlags.ordpool_rune).toBe(0n);
    expect(BigInt(classified[2].flags) & OrdpoolTransactionFlags.ordpool_rune).toBe(OrdpoolTransactionFlags.ordpool_rune);
  });

  it('preserves all per-tx flags when classifying a heterogeneous block', async () => {
    parseSpy.mockImplementation(async (tx: any, flags: bigint) => {
      if (tx.txid === 'cat21-mint') {
        return flags | OrdpoolTransactionFlags.ordpool_cat21 | OrdpoolTransactionFlags.ordpool_cat21_mint;
      }
      if (tx.txid === 'inscription') {
        return flags | OrdpoolTransactionFlags.ordpool_inscription | OrdpoolTransactionFlags.ordpool_inscription_mint;
      }
      return flags;
    });

    const txs = [
      createMockTx({ txid: 'coinbase' }),
      createMockTx({ txid: 'cat21-mint', locktime: 21 }),
      createMockTx({ txid: 'inscription' }),
      createMockTx({ txid: 'plain-tx' }),
    ];
    const classified = await Common.classifyTransactions(txs, 840000);

    expect(BigInt(classified[0].flags) & OrdpoolTransactionFlags.ordpool_cat21).toBe(0n);
    expect(BigInt(classified[1].flags) & OrdpoolTransactionFlags.ordpool_cat21).toBe(OrdpoolTransactionFlags.ordpool_cat21);
    expect(BigInt(classified[1].flags) & OrdpoolTransactionFlags.ordpool_cat21_mint).toBe(OrdpoolTransactionFlags.ordpool_cat21_mint);
    expect(BigInt(classified[2].flags) & OrdpoolTransactionFlags.ordpool_inscription).toBe(OrdpoolTransactionFlags.ordpool_inscription);
    expect(BigInt(classified[3].flags) & OrdpoolTransactionFlags.ordpool_inscription).toBe(0n);

    for (const tx of classified) {
      expect(typeof tx.flags).toBe('number');
      expect(isNaN(tx.flags)).toBe(false);
    }
  });
});
