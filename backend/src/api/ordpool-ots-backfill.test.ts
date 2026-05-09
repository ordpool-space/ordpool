import { ElectrsTxLite, OrdpoolOtsBackfill, extractMerkleRoot, looksLikeCalendarCommit } from './ordpool-ots-backfill';
import ordpoolOtsRepository from '../repositories/OrdpoolOtsRepository';
import ordpoolOtsTxidSet from './ordpool-ots-txid-set';

jest.mock('../repositories/OrdpoolOtsRepository', () => ({
  __esModule: true,
  default: {
    upsertConfirmed: jest.fn().mockResolvedValue(undefined),
    upsertPending: jest.fn().mockResolvedValue(undefined),
    getAllTxids: jest.fn().mockResolvedValue([]),
  },
}));

const repoMock = ordpoolOtsRepository as jest.Mocked<typeof ordpoolOtsRepository>;

const MERKLE_A = 'a'.repeat(64);
const MERKLE_B = 'b'.repeat(64);

function makeCalendarTx(over: Partial<ElectrsTxLite> = {}): ElectrsTxLite {
  return {
    txid: 'aabb',
    vin: [{ txid: 'parent_txid' }],
    vout: [
      { value: 50000, scriptpubkey: '0014' + '0'.repeat(40), scriptpubkey_type: 'v0_p2wpkh' },
      { value: 0,     scriptpubkey: '6a20' + MERKLE_A, scriptpubkey_type: 'op_return' },
    ],
    status: { confirmed: true, block_hash: '0'.repeat(64), block_height: 800000, block_time: 1700000000 },
    fee: 159,
    weight: 600,
    ...over,
  };
}

function makeNonCalendarTx(over: Partial<ElectrsTxLite> = {}): ElectrsTxLite {
  return {
    txid: 'ffff',
    vin: [{ txid: 'unrelated' }, { txid: 'unrelated2' }],   // 2 inputs -- not calendar shape
    vout: [{ value: 100000, scriptpubkey: '76a914...', scriptpubkey_type: 'p2pkh' }],
    status: { confirmed: true, block_hash: '0'.repeat(64), block_height: 700000, block_time: 1690000000 },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ordpoolOtsTxidSet.reset();
});

describe('looksLikeCalendarCommit', () => {

  it('accepts the canonical 1-in 2-out shape with OP_RETURN+32 in vout[1]', () => {
    expect(looksLikeCalendarCommit(makeCalendarTx())).toBe(true);
  });

  it('rejects 2-input txs', () => {
    expect(looksLikeCalendarCommit(makeCalendarTx({
      vin: [{ txid: 'a' }, { txid: 'b' }],
    }))).toBe(false);
  });

  it('rejects when vout[1] is not OP_RETURN+32', () => {
    expect(looksLikeCalendarCommit(makeCalendarTx({
      vout: [
        { value: 50000, scriptpubkey: '0014' + '0'.repeat(40) },
        { value: 0,     scriptpubkey: '6a14' + '0'.repeat(40) },  // OP_PUSHBYTES_20, not 32
      ],
    }))).toBe(false);
  });

  it('rejects when vout[1] has nonzero value', () => {
    expect(looksLikeCalendarCommit(makeCalendarTx({
      vout: [
        { value: 50000, scriptpubkey: '0014' + '0'.repeat(40) },
        { value: 1,     scriptpubkey: '6a20' + MERKLE_A },
      ],
    }))).toBe(false);
  });

  it('rejects 3-output txs even when vout[1] looks right', () => {
    expect(looksLikeCalendarCommit(makeCalendarTx({
      vout: [
        { value: 50000, scriptpubkey: '0014' + '0'.repeat(40) },
        { value: 0,     scriptpubkey: '6a20' + MERKLE_A },
        { value: 50000, scriptpubkey: '0014' + '1'.repeat(40) },
      ],
    }))).toBe(false);
  });
});

describe('extractMerkleRoot', () => {

  it('strips the OP_RETURN+OP_PUSHBYTES_32 prefix', () => {
    expect(extractMerkleRoot(makeCalendarTx())).toBe(MERKLE_A);
  });
});

describe('OrdpoolOtsBackfill.walkBackward', () => {

  type StubError = { __httpError: number };
  function stubFetch(byUrl: Record<string, ElectrsTxLite | StubError>): typeof fetch {
    return (async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const r = byUrl[url];
      if (!r) throw new Error(`unexpected URL: ${url}`);
      // Discriminate error markers via a unique key -- ElectrsTxLite naturally
      // has a `.status` field (block info), so we can't use 'status' in r.
      if ('__httpError' in r) {
        return { ok: false, status: r.__httpError, json: async () => ({}) } as any;
      }
      return { ok: true, status: 200, json: async () => r } as any;
    }) as any;
  }

  const ESPLORA = 'http://electrs.test';

  it('walks 3 calendar txs, records each, stops on shape-mismatch', async () => {
    const tx3 = makeCalendarTx({ txid: 'tx3', vin: [{ txid: 'tx2' }], vout: [
      { value: 50000, scriptpubkey: '0014' + '3'.repeat(40) },
      { value: 0,     scriptpubkey: '6a20' + 'c'.repeat(64) },
    ], status: { confirmed: true, block_hash: '3'.repeat(64), block_height: 800003, block_time: 1700300000 } });
    const tx2 = makeCalendarTx({ txid: 'tx2', vin: [{ txid: 'tx1' }], vout: [
      { value: 50000, scriptpubkey: '0014' + '2'.repeat(40) },
      { value: 0,     scriptpubkey: '6a20' + MERKLE_B },
    ], status: { confirmed: true, block_hash: '2'.repeat(64), block_height: 800002, block_time: 1700200000 } });
    const tx1 = makeCalendarTx({ txid: 'tx1', vin: [{ txid: 'genesis_funding' }], vout: [
      { value: 50000, scriptpubkey: '0014' + '1'.repeat(40) },
      { value: 0,     scriptpubkey: '6a20' + MERKLE_A },
    ], status: { confirmed: true, block_hash: '1'.repeat(64), block_height: 800001, block_time: 1700100000 } });
    const genesis = makeNonCalendarTx({ txid: 'genesis_funding' });

    const backfill = new OrdpoolOtsBackfill(ESPLORA);
    backfill.setFetch(stubFetch({
      [`${ESPLORA}/tx/tx3`]: tx3,
      [`${ESPLORA}/tx/tx2`]: tx2,
      [`${ESPLORA}/tx/tx1`]: tx1,
      [`${ESPLORA}/tx/genesis_funding`]: genesis,
    }));

    const stats = await backfill.walkBackward('alice', 'tx3');
    expect(stats.txsWalked).toBe(4);  // tx3, tx2, tx1, genesis
    expect(stats.txsRecorded).toBe(3); // genesis bails on shape-mismatch
    expect(stats.stoppedReason).toBe('shape-mismatch');
    expect(repoMock.upsertConfirmed).toHaveBeenCalledTimes(3);

    const recordedTxids = repoMock.upsertConfirmed.mock.calls.map(c => c[0].txid);
    expect(recordedTxids.sort()).toEqual(['tx1', 'tx2', 'tx3']);
  });

  it('idempotent re-run: short-circuits on already-seen', async () => {
    ordpoolOtsTxidSet.add('tx3');
    const backfill = new OrdpoolOtsBackfill(ESPLORA);
    backfill.setFetch(stubFetch({}));  // never called

    const stats = await backfill.walkBackward('alice', 'tx3');
    expect(stats.txsWalked).toBe(0);
    expect(stats.txsRecorded).toBe(0);
    expect(stats.stoppedReason).toBe('already-seen');
    expect(repoMock.upsertConfirmed).not.toHaveBeenCalled();
  });

  it('stops on fetch error without recording a partial', async () => {
    const backfill = new OrdpoolOtsBackfill(ESPLORA);
    backfill.setFetch(stubFetch({
      [`${ESPLORA}/tx/tx3`]: { __httpError: 500 },
    }));

    const stats = await backfill.walkBackward('alice', 'tx3');
    expect(stats.txsRecorded).toBe(0);
    expect(stats.stoppedReason).toBe('fetch-error');
  });

  it('respects maxDepth (kill switch)', async () => {
    // Build a 10-deep chain. With maxDepth=5 we expect the walk to stop
    // at iteration 5 with stoppedReason='limit' even though the chain
    // goes deeper.
    const stubs: Record<string, ElectrsTxLite> = {};
    for (let i = 9; i >= 0; i--) {
      stubs[`${ESPLORA}/tx/tx${i}`] = makeCalendarTx({
        txid: `tx${i}`,
        vin: [{ txid: i > 0 ? `tx${i - 1}` : 'genesis' }],
      });
    }
    const backfill = new OrdpoolOtsBackfill(ESPLORA);
    backfill.setFetch(stubFetch(stubs));

    const stats = await backfill.walkBackward('alice', 'tx9', 5);
    expect(stats.txsWalked).toBe(5);
    expect(stats.stoppedReason).toBe('limit');
  });

  it('records confirmed tx with normalized fee + computed feerate', async () => {
    const tx = makeCalendarTx({ txid: 'tx', vin: [{ txid: 'parent' }], fee: 240, weight: 600 });
    const parent = makeNonCalendarTx({ txid: 'parent' });
    const backfill = new OrdpoolOtsBackfill(ESPLORA);
    backfill.setFetch(stubFetch({
      [`${ESPLORA}/tx/tx`]: tx,
      [`${ESPLORA}/tx/parent`]: parent,
    }));

    await backfill.walkBackward('alice', 'tx');
    expect(repoMock.upsertConfirmed).toHaveBeenCalledWith(expect.objectContaining({
      txid: 'tx',
      calendar: 'alice',
      merkleRoot: MERKLE_A,
      fee: 240,
      feerate: '1.60',  // 240 / (600/4) = 240 / 150 = 1.6
    }));
  });
});

describe('OrdpoolOtsBackfill.getSeedTxid', () => {

  it('returns the OLDEST tx in transactions[] (the last array entry)', async () => {
    const backfill = new OrdpoolOtsBackfill('http://e.test');
    backfill.setFetch((async () => ({
      ok: true, status: 200,
      json: async () => ({
        transactions: [
          { txid: 'newest' },
          { txid: 'middle' },
          { txid: 'oldest' },
        ],
      }),
    })) as any);
    expect(await backfill.getSeedTxid('http://cal.test/')).toBe('oldest');
  });

  it('returns null when transactions[] is empty', async () => {
    const backfill = new OrdpoolOtsBackfill('http://e.test');
    backfill.setFetch((async () => ({
      ok: true, status: 200,
      json: async () => ({ transactions: [] }),
    })) as any);
    expect(await backfill.getSeedTxid('http://cal.test/')).toBeNull();
  });

  it('returns null on HTTP error', async () => {
    const backfill = new OrdpoolOtsBackfill('http://e.test');
    backfill.setFetch((async () => ({ ok: false, status: 503 })) as any);
    expect(await backfill.getSeedTxid('http://cal.test/')).toBeNull();
  });
});
