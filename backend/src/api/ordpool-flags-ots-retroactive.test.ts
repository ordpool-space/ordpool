import { OrdpoolTransactionFlags } from 'ordpool-parser';
import { Common } from './common';
import { TransactionExtended } from '../mempool.interfaces';
import ordpoolOtsTxidSet from './ordpool-ots-txid-set';

/**
 * Regression suite for the OTS eventual-consistency contract.
 *
 * Background. Every ordpool flag except `ordpool_ots` is parser-derived
 * (extractable from witness bytes), so it's static once the tx is known
 * and the early-return optimisation in `Common.getTransactionFlags` is
 * safe. `ordpool_ots` is the exception: the OTS poller hydrates
 * `ordpoolOtsTxidSet` asynchronously, so the answer to "is this tx an
 * OTS commit?" is eventually consistent. A tx classified at mempool
 * ingest BEFORE the poller observed its calendar batch must still pick
 * up the bit on later re-classifications -- otherwise the misclassification
 * persists into the block summary, the WebSocket pushes, the frontend,
 * the entire downstream pipeline.
 *
 * The patch that makes these tests green: move the `addOtsFlag` block
 * ABOVE the `if (tx.flags) return Number(flags)` early-return in
 * `Common.getTransactionFlags`. This file pins that invariant.
 */

const OTS_BIT = OrdpoolTransactionFlags.ordpool_ots;
const ATOMICAL_BIT = OrdpoolTransactionFlags.ordpool_atomical;
const INSCRIPTION_BIT = OrdpoolTransactionFlags.ordpool_inscription;

function hasBit(flags: number, bit: bigint): boolean {
  return (BigInt(flags) & bit) === bit;
}

/** Minimal TransactionExtended shape that getTransactionFlags accepts without
 *  recomputing static bits. The seed `flags` value is what mempool / blocks
 *  paths persist after the first classification; we vary it per test. */
function makeTx(txid: string, opts: Partial<TransactionExtended> = {}): TransactionExtended {
  return {
    txid,
    flags: 0,
    vin: [],
    vout: [],
    ancestors: undefined,
    descendants: undefined,
    replacement: undefined,
    ...opts,
  } as unknown as TransactionExtended;
}

beforeEach(() => {
  ordpoolOtsTxidSet.reset();
});

describe('OTS flag — eventual-consistency invariant via Common.getTransactionFlags', () => {

  // ---- (1) first-classification baseline ----

  it('first classification: poller does NOT know the tx -> no OTS bit', async () => {
    const tx = makeTx('aaaa', { flags: 0 });
    const result = await Common.getTransactionFlags(tx);
    expect(hasBit(result, OTS_BIT)).toBe(false);
  });

  it('first classification: poller knows the tx -> OTS bit is set', async () => {
    ordpoolOtsTxidSet.add('bbbb');
    const tx = makeTx('bbbb', { flags: 0 });
    const result = await Common.getTransactionFlags(tx);
    expect(hasBit(result, OTS_BIT)).toBe(true);
  });

  // ---- (2) the eventual-consistency hole (the bug the patch closes) ----

  it('re-classification: tx classified before poller saw it -> still picks up the bit', async () => {
    // Step 1: tx ingested at mempool. tx.flags written without OTS bit.
    const tx = makeTx('cccc', { flags: Number(ATOMICAL_BIT) });
    let result = await Common.getTransactionFlags(tx);
    tx.flags = result;
    expect(hasBit(result, OTS_BIT)).toBe(false);
    expect(hasBit(result, ATOMICAL_BIT)).toBe(true);

    // Step 2: poller later observes calendar Y publishing tx cccc.
    ordpoolOtsTxidSet.add('cccc');

    // Step 3: tx is re-classified (mempool refresh, block confirmation,
    // historical-block rebuild -- doesn't matter which call site). The
    // OTS bit MUST appear now. Before the patch this was the silent-drop
    // case where the early-return at common.ts:631-633 skipped addOtsFlag.
    result = await Common.getTransactionFlags(tx);
    expect(hasBit(result, OTS_BIT)).toBe(true);
    expect(hasBit(result, ATOMICAL_BIT)).toBe(true);   // parser-derived bits preserved
  });

  // ---- (3) idempotence + no double-OR ----

  it('re-classification: tx already has OTS bit + poller still knows -> still has OTS bit', async () => {
    ordpoolOtsTxidSet.add('dddd');
    const tx = makeTx('dddd', { flags: Number(OTS_BIT | INSCRIPTION_BIT) });
    const result = await Common.getTransactionFlags(tx);
    expect(hasBit(result, OTS_BIT)).toBe(true);
    expect(hasBit(result, INSCRIPTION_BIT)).toBe(true);
  });

  it('re-classification: tx already has OTS bit + poller forgot it -> bit STAYS (once anchored, always anchored)', async () => {
    // Pathological scenario: the poller's txid-set forgot a txid we'd
    // previously confirmed as OTS. Real-world this would only happen on a
    // bug or after a manual DB scrub. The contract: tx.flags is the source
    // of truth, and we never DOWNGRADE flags during re-classification.
    // (addOtsFlag is OR-only; the flag, once set in tx.flags, survives.)
    // This protects historical block summaries from being silently rewritten.
    const tx = makeTx('eeee', { flags: Number(OTS_BIT) });
    const result = await Common.getTransactionFlags(tx);
    expect(hasBit(result, OTS_BIT)).toBe(true);
  });

  // ---- (4) variable-bits (CPFP/RBF) update path preserves OTS ----

  it('CPFP refresh: ancestors added later does NOT clobber the OTS bit', async () => {
    ordpoolOtsTxidSet.add('ffff');
    const tx = makeTx('ffff', {
      flags: Number(OTS_BIT | INSCRIPTION_BIT),
      ancestors: [{ txid: 'parent', weight: 1, fee: 100 }] as any,
    });
    const result = await Common.getTransactionFlags(tx);
    expect(hasBit(result, OTS_BIT)).toBe(true);
    expect(hasBit(result, INSCRIPTION_BIT)).toBe(true);
  });

  it('replacement flag added later does NOT clobber the OTS bit', async () => {
    ordpoolOtsTxidSet.add('gggg');
    const tx = makeTx('gggg', {
      flags: Number(OTS_BIT),
      replacement: true,
    });
    const result = await Common.getTransactionFlags(tx);
    expect(hasBit(result, OTS_BIT)).toBe(true);
  });

  // ---- (5) interaction with parser-derived flags via the slow path ----

  it('first classification (no tx.flags) -- slow path: poller adds OTS on top of analyser bits', async () => {
    ordpoolOtsTxidSet.add('hhhh');
    // No tx.flags seed -> slow path through analyseTransaction. The witness
    // is empty so analyseTransaction won't add any artifact bits, but the
    // OTS pre-enrichment still fires.
    const tx = makeTx('hhhh', { flags: 0, vin: [], vout: [] });
    const result = await Common.getTransactionFlags(tx);
    expect(hasBit(result, OTS_BIT)).toBe(true);
  });

  it('slow path: poller does NOT know the tx -> no OTS bit even after analyseTransaction', async () => {
    const tx = makeTx('iiii', { flags: 0, vin: [], vout: [] });
    const result = await Common.getTransactionFlags(tx);
    expect(hasBit(result, OTS_BIT)).toBe(false);
  });

  // ---- (6) integration with the documented call-site pattern ----

  it('mempool refresh scenario end-to-end: initial classify (poller blind) -> refresh (poller knows) -> OTS bit appears', async () => {
    // Step 1: cold start. Mempool ingests tx jjjj. Poller hasn't bootstrapped
    // anything yet.
    const tx = makeTx('jjjj', { flags: 0 });
    let result = await Common.getTransactionFlags(tx);
    tx.flags = result;                                      // persist as $setMempool would
    expect(hasBit(result, OTS_BIT)).toBe(false);

    // Step 2: poller's first cycle observes calendar Y publishing jjjj.
    ordpoolOtsTxidSet.add('jjjj');

    // Step 3: mempool refresh tick re-classifies all cached txs.
    result = await Common.getTransactionFlags(tx);
    expect(hasBit(result, OTS_BIT)).toBe(true);
  });
});
