import { OrdpoolTransactionFlags } from 'ordpool-parser';

import { getTransactionFlags } from './transaction.utils';
import { COUNTERPARTY_MPMA_TX, PLAIN_P2PKH_TX } from './transaction.utils.fixtures';

/**
 * Regression test for the "frontend tx-detail page never invoked the
 * ordpool parser" bug. The contract: getTransactionFlags MUST OR ordpool
 * artifact bits into the returned flags when given a tx that the parser
 * recognises -- mirroring the backend's common.ts::Common.getTransactionFlags
 * which calls `analyseTransaction(tx, flags)` at the end of its computation.
 *
 * Background (so this test isn't deleted later "as redundant"):
 *
 * The first implementation of frontend/backend integration used a side-channel
 * pattern: the parser mutated tx._ordpoolFlags as a side effect, and
 * getTransactionFlags read that field back. The architecture was later
 * refactored to a clean functional contract -- analyseTransaction(tx, flags)
 * takes input flags, returns merged flags, no side-channel needed. The
 * backend was updated. The frontend's getTransactionFlags was NOT updated
 * for ~a month, so any tx that arrived without server-pre-classified flags
 * (i.e. anything fetched via the tx-detail Esplora proxy at /api/tx/<id>)
 * had its ordpool artifact bits silently dropped. The Counterparty mpma
 * tx 4a412b0a...4788e is the canonical regression case.
 */
// jsdom test environment doesn't expose structuredClone; this works fine
// for plain-data fixtures (no Date / Map / Set / Uint8Array inside).
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

describe('getTransactionFlags (ordpool integration)', () => {

  it('ORs ordpool_counterparty into flags for a real Counterparty mpma tx', async () => {
    // Clone the fixture so we don't accidentally mutate it across test
    // re-runs (the parser internally sets tx._ordpoolFlags as a side effect
    // for the OTS pre-enrichment path, and we want each test to start fresh).
    const tx = deepClone(COUNTERPARTY_MPMA_TX);

    const flags = await getTransactionFlags(tx, null, null, tx.status.block_height, 'mainnet');

    expect(flags & OrdpoolTransactionFlags.ordpool_counterparty).toBe(OrdpoolTransactionFlags.ordpool_counterparty);
  });

  it('returns no ordpool bits for a plain p2pkh tx', async () => {
    const tx = deepClone(PLAIN_P2PKH_TX);

    const flags = await getTransactionFlags(tx, null, null, tx.status.block_height, 'mainnet');

    // Mask: every ordpool bit lives at position 48 or above. A plain tx must
    // not light any of them up.
    const ORDPOOL_BIT_MASK = ((1n << 32n) - 1n) << 48n;
    expect(flags & ORDPOOL_BIT_MASK).toBe(0n);
  });

  it('returns the same value across two calls (no parser-mutation leaking across calls)', async () => {
    // The parser DOES still mutate tx._ordpoolFlags internally (used by the
    // OTS pre-enrichment path). Calling getTransactionFlags twice on the
    // SAME tx object must still produce the same flags both times -- not
    // double-OR something, not pick up stale leftovers from the previous run.
    const tx = deepClone(COUNTERPARTY_MPMA_TX);

    const first = await getTransactionFlags(tx, null, null, tx.status.block_height, 'mainnet');
    const second = await getTransactionFlags(tx, null, null, tx.status.block_height, 'mainnet');

    expect(second).toBe(first);
  });

  it('does not read or rely on tx._ordpoolFlags side-channel', async () => {
    // The OLD bug was: getTransactionFlags only inspected tx._ordpoolFlags,
    // which was populated by the backend's side-effect pattern. On the
    // tx-detail page the field was never set, so the chip never fired.
    //
    // Guard: explicitly clear _ordpoolFlags BEFORE calling the function.
    // If the function only reads the side-channel (the old broken code),
    // this test would return 0 for the counterparty bit. The new code calls
    // the parser directly and computes the flag from the witness.
    const tx = deepClone(COUNTERPARTY_MPMA_TX);
    (tx as any)._ordpoolFlags = undefined;

    const flags = await getTransactionFlags(tx, null, null, tx.status.block_height, 'mainnet');

    expect(flags & OrdpoolTransactionFlags.ordpool_counterparty).toBe(OrdpoolTransactionFlags.ordpool_counterparty);
  });
});

// Minimal stub mimicking the OtsKnowledgeService surface that
// transaction.utils.ts calls. Lets us drive the four tristate paths
// (server attached true, server attached false, server attached null,
// no server signal) without instantiating Angular DI.
function makeOtsStub(answers: { [txid: string]: boolean | null } = {}) {
  return {
    isOtsCommit: jest.fn(async (tx: any) => {
      if (tx.isOtsCommit === true) return true;
      if (tx.isOtsCommit === false) return false;
      const opReturn = (tx.vout ?? []).some((v: any) => v.scriptpubkey_type === 'op_return');
      if (!opReturn) return false;
      if (tx.txid in answers) return answers[tx.txid];
      return null;
    }),
  };
}

describe('getTransactionFlags + OtsKnowledgeService — cold load /tx/<ots-commit>', () => {

  it('strip-fill: server attaches isOtsCommit=true → flags carry ordpool_ots', async () => {
    // Mirrors the live REST surface: backend's bitcoin.routes.getTransaction
    // calls attachIsOtsCommit() before res.json(transaction). Frontend
    // receives tx with isOtsCommit=true, flags=undefined; getTransactionFlags
    // must light up the OTS bit.
    const tx: any = deepClone(PLAIN_P2PKH_TX);
    tx.isOtsCommit = true;

    const flags = await getTransactionFlags(tx, null, null, tx.status.block_height, 'mainnet', makeOtsStub() as any);

    expect(flags & OrdpoolTransactionFlags.ordpool_ots).toBe(OrdpoolTransactionFlags.ordpool_ots);
  });

  it('strip-fill: server attaches isOtsCommit=false → ordpool_ots stays off', async () => {
    const tx: any = deepClone(PLAIN_P2PKH_TX);
    tx.isOtsCommit = false;

    const flags = await getTransactionFlags(tx, null, null, tx.status.block_height, 'mainnet', makeOtsStub() as any);

    expect(flags & OrdpoolTransactionFlags.ordpool_ots).toBe(0n);
  });

  it('no server signal, no OP_RETURN → ordpool_ots stays off, no lazy probe called', async () => {
    const tx: any = deepClone(PLAIN_P2PKH_TX);   // PLAIN_P2PKH has no OP_RETURN
    // server didn't attach the field (undefined). isOtsCommit stub should
    // return false synchronously via OP_RETURN fast path; no answers map
    // consulted.
    const stub = makeOtsStub({ /* deliberately empty -- must not be hit */ });

    const flags = await getTransactionFlags(tx, null, null, tx.status.block_height, 'mainnet', stub as any);

    expect(flags & OrdpoolTransactionFlags.ordpool_ots).toBe(0n);
  });

  it('no server signal, lazy probe says null → ordpool_ots stays off (NOT confused with false)', async () => {
    // Tristate honesty check: a null answer from the probe means
    // "unknown", and the consumer must NOT apply the bit (consistent
    // with the strict `=== true` check inside getTransactionFlags).
    const tx: any = {
      ...deepClone(PLAIN_P2PKH_TX),
      // Synthetic OP_RETURN output that's well-formed enough to satisfy
      // the upstream static-flag walker (it reads scriptpubkey.length).
      vout: [{ scriptpubkey_type: 'op_return', scriptpubkey: '6a0102' } as any],
    };
    const stub = { isOtsCommit: jest.fn(async () => null) };

    const flags = await getTransactionFlags(tx, null, null, tx.status.block_height, 'mainnet', stub as any);

    expect(stub.isOtsCommit).toHaveBeenCalled();
    expect(flags & OrdpoolTransactionFlags.ordpool_ots).toBe(0n);
  });

  it('server-attached overrides client recomputation: isOtsCommit=true is trusted even for txs without OP_RETURN', async () => {
    // If the server told us this tx is an OTS commit, we trust it. The
    // client's "no OP_RETURN means definitely false" fast-path is a
    // fallback when the server didn't speak; it must NOT override an
    // authoritative server tristate.
    const tx: any = deepClone(PLAIN_P2PKH_TX);
    tx.isOtsCommit = true;
    // (the fixture has no OP_RETURN output)

    const flags = await getTransactionFlags(tx, null, null, tx.status.block_height, 'mainnet', makeOtsStub() as any);

    expect(flags & OrdpoolTransactionFlags.ordpool_ots).toBe(OrdpoolTransactionFlags.ordpool_ots);
  });
});
