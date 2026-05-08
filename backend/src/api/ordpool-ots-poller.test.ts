import ordpoolOtsPoller, { CalendarResponse, KNOWN_CALENDARS } from './ordpool-ots-poller';
import ordpoolOtsTxidSet from './ordpool-ots-txid-set';
import ordpoolOtsRepository from '../repositories/OrdpoolOtsRepository';

jest.mock('../repositories/OrdpoolOtsRepository', () => ({
  __esModule: true,
  default: {
    upsertPending: jest.fn().mockResolvedValue(undefined),
    upsertConfirmed: jest.fn().mockResolvedValue(undefined),
    getByTxid: jest.fn().mockResolvedValue(null),
    getAllTxids: jest.fn().mockResolvedValue([]),
  },
}));

const repoMock = ordpoolOtsRepository as jest.Mocked<typeof ordpoolOtsRepository>;

/** Helper: build a stub fetch that returns a fixed response per calendar URL. */
function stubFetch(byUrl: Record<string, CalendarResponse | { status: number }>): typeof fetch {
  return (async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const r = byUrl[url];
    if (!r) throw new Error(`unexpected URL: ${url}`);
    if ('status' in r) {
      return { ok: false, status: r.status, json: async () => ({}) } as any;
    }
    return { ok: true, status: 200, json: async () => r } as any;
  }) as any;
}

const TIP = '7f909ce454f6c88a6f6721e2e4527ac0a76ca6460a0f0bbdf94978aeae58081e';
const TXID_CONF = '8d8ce7ac7b68335a040243f31e7e3a2ba8fb82166ca569e7c8b80361b90e8b9f';
const TXID_PENDING = '914a3f3575a1da92035a57bd758da8588fd11776927ab880915f97e66612f773';
const TXID_OTHER = '054cc18a8162887917a1e6e5c60389bb4b6647167e6936d231466d7b2710f413';

const ALICE = KNOWN_CALENDARS.find(c => c.name === 'alice')!;
const BOB = KNOWN_CALENDARS.find(c => c.name === 'bob')!;
const FINNEY = KNOWN_CALENDARS.find(c => c.name === 'finney')!;
const CATALLAXY = KNOWN_CALENDARS.find(c => c.name === 'catallaxy')!;

function emptyResponse(): CalendarResponse {
  return { tip: TIP, transactions: [], most_recent_tx: 'None' };
}

beforeEach(() => {
  jest.clearAllMocks();
  ordpoolOtsTxidSet.reset();
  // Default: every calendar returns an empty response so per-test stubs can override one.
  ordpoolOtsPoller.setFetch(stubFetch({
    [ALICE.url]: emptyResponse(),
    [BOB.url]: emptyResponse(),
    [FINNEY.url]: emptyResponse(),
    [CATALLAXY.url]: emptyResponse(),
  }));
});

describe('OrdpoolOtsPoller.tick()', () => {

  it('records every confirmed tx from the transactions[] array as upsertConfirmed', async () => {
    ordpoolOtsPoller.setFetch(stubFetch({
      [ALICE.url]: {
        tip: TIP,
        transactions: [{
          txid: TXID_CONF,
          confirmations: 3,
          blockhash: '0'.repeat(64),
          blockheight: 948192,
          blocktime: 1778100000,
          fee: -159,                       // calendar serves negative; poller normalises to positive
          feerate: '0.68',
        }],
        most_recent_tx: 'None',
      },
      [BOB.url]: emptyResponse(),
      [FINNEY.url]: emptyResponse(),
      [CATALLAXY.url]: emptyResponse(),
    }));

    const results = await ordpoolOtsPoller.tick();

    expect(repoMock.upsertConfirmed).toHaveBeenCalledTimes(1);
    expect(repoMock.upsertConfirmed).toHaveBeenCalledWith(expect.objectContaining({
      txid: TXID_CONF,
      calendar: 'alice',
      merkleRoot: TIP,
      blockheight: 948192,
      fee: 159,           // normalised (positive)
      feerate: '0.68',
    }));
    expect(repoMock.upsertPending).not.toHaveBeenCalled();
    expect(ordpoolOtsTxidSet.has(TXID_CONF)).toBe(true);
    const alice = results.find(r => r.calendar === 'alice')!;
    expect(alice.newConfirmed).toBe(1);
    expect(alice.newPending).toBe(0);
  });

  it('records most_recent_tx as a pending row', async () => {
    ordpoolOtsPoller.setFetch(stubFetch({
      [ALICE.url]: { tip: TIP, transactions: [], most_recent_tx: TXID_PENDING },
      [BOB.url]: emptyResponse(),
      [FINNEY.url]: emptyResponse(),
      [CATALLAXY.url]: emptyResponse(),
    }));

    const results = await ordpoolOtsPoller.tick();

    expect(repoMock.upsertPending).toHaveBeenCalledTimes(1);
    expect(repoMock.upsertPending).toHaveBeenCalledWith({
      txid: TXID_PENDING, calendar: 'alice', merkleRoot: TIP,
    });
    expect(ordpoolOtsTxidSet.has(TXID_PENDING)).toBe(true);
    const alice = results.find(r => r.calendar === 'alice')!;
    expect(alice.newPending).toBe(1);
  });

  it('upgrades a pending row to confirmed when it appears in transactions[]', async () => {
    // Seed: tx is in the set as pending (confirmedAt null).
    ordpoolOtsTxidSet.add(TXID_PENDING);
    repoMock.getByTxid.mockResolvedValueOnce({
      txid: TXID_PENDING,
      calendar: 'alice',
      merkleRoot: TIP,
      firstSeenAt: new Date(),
      confirmedAt: null,
      blockhash: null,
      blockheight: null,
      blocktime: null,
      fee: null,
      feerate: null,
    });

    ordpoolOtsPoller.setFetch(stubFetch({
      [ALICE.url]: {
        tip: TIP,
        transactions: [{
          txid: TXID_PENDING,
          confirmations: 1,
          blockhash: '1'.repeat(64),
          blockheight: 948300,
          blocktime: 1778200000,
          fee: -212,
          feerate: '0.91',
        }],
        most_recent_tx: 'None',
      },
      [BOB.url]: emptyResponse(),
      [FINNEY.url]: emptyResponse(),
      [CATALLAXY.url]: emptyResponse(),
    }));

    const results = await ordpoolOtsPoller.tick();

    expect(repoMock.upsertConfirmed).toHaveBeenCalledTimes(1);
    expect(repoMock.upsertConfirmed).toHaveBeenCalledWith(expect.objectContaining({
      txid: TXID_PENDING,
      blockheight: 948300,
      fee: 212,
    }));
    const alice = results.find(r => r.calendar === 'alice')!;
    expect(alice.upgraded).toBe(1);
    expect(alice.newConfirmed).toBe(0);
    expect(alice.newPending).toBe(0);
  });

  it('most_recent_tx that is already in the set is a no-op', async () => {
    ordpoolOtsTxidSet.add(TXID_PENDING);
    ordpoolOtsPoller.setFetch(stubFetch({
      [ALICE.url]: { tip: TIP, transactions: [], most_recent_tx: TXID_PENDING },
      [BOB.url]: emptyResponse(),
      [FINNEY.url]: emptyResponse(),
      [CATALLAXY.url]: emptyResponse(),
    }));

    await ordpoolOtsPoller.tick();
    expect(repoMock.upsertPending).not.toHaveBeenCalled();
  });

  it('most_recent_tx === "None" is a no-op', async () => {
    ordpoolOtsPoller.setFetch(stubFetch({
      [ALICE.url]: { tip: TIP, transactions: [], most_recent_tx: 'None' },
      [BOB.url]: emptyResponse(),
      [FINNEY.url]: emptyResponse(),
      [CATALLAXY.url]: emptyResponse(),
    }));
    await ordpoolOtsPoller.tick();
    expect(repoMock.upsertPending).not.toHaveBeenCalled();
  });

  it('previously-seen confirmed txid in transactions[] is a no-op', async () => {
    ordpoolOtsTxidSet.add(TXID_CONF);
    repoMock.getByTxid.mockResolvedValueOnce({
      txid: TXID_CONF,
      calendar: 'alice',
      merkleRoot: TIP,
      firstSeenAt: new Date(),
      confirmedAt: new Date(),    // already confirmed
      blockhash: '0'.repeat(64),
      blockheight: 948192,
      blocktime: 1778100000,
      fee: 159,
      feerate: '0.68',
    });

    ordpoolOtsPoller.setFetch(stubFetch({
      [ALICE.url]: {
        tip: TIP,
        transactions: [{
          txid: TXID_CONF,
          confirmations: 100,
          blockhash: '0'.repeat(64),
          blockheight: 948192,
          blocktime: 1778100000,
          fee: -159,
          feerate: '0.68',
        }],
        most_recent_tx: 'None',
      },
      [BOB.url]: emptyResponse(),
      [FINNEY.url]: emptyResponse(),
      [CATALLAXY.url]: emptyResponse(),
    }));

    await ordpoolOtsPoller.tick();
    // No write: existing row is already confirmed, no upgrade needed.
    expect(repoMock.upsertConfirmed).not.toHaveBeenCalled();
    expect(repoMock.upsertPending).not.toHaveBeenCalled();
  });

  it('HTTP error on one calendar does not poison the others', async () => {
    ordpoolOtsPoller.setFetch(stubFetch({
      [ALICE.url]: { status: 500 } as any,
      [BOB.url]: {
        tip: TIP,
        transactions: [{
          txid: TXID_OTHER,
          confirmations: 5,
          blockhash: '2'.repeat(64),
          blockheight: 948500,
          blocktime: 1778200000,
          fee: -75,
          feerate: '0.32',
        }],
        most_recent_tx: 'None',
      },
      [FINNEY.url]: emptyResponse(),
      [CATALLAXY.url]: emptyResponse(),
    }));

    const results = await ordpoolOtsPoller.tick();
    const alice = results.find(r => r.calendar === 'alice')!;
    const bob = results.find(r => r.calendar === 'bob')!;
    expect(alice.ok).toBe(false);
    expect(alice.errorMessage).toMatch(/HTTP 500/);
    expect(bob.ok).toBe(true);
    expect(bob.newConfirmed).toBe(1);
    expect(repoMock.upsertConfirmed).toHaveBeenCalledTimes(1);
    expect(repoMock.upsertConfirmed).toHaveBeenCalledWith(expect.objectContaining({ calendar: 'bob' }));
  });

  it('overlapping ticks: second tick is a no-op while the first runs', async () => {
    let resolveFirst!: (v: CalendarResponse) => void;
    const slow = new Promise<CalendarResponse>(r => { resolveFirst = r; });
    ordpoolOtsPoller.setFetch((async (url: string) => {
      if (url === ALICE.url) {
        const body = await slow;
        return { ok: true, status: 200, json: async () => body } as any;
      }
      return { ok: true, status: 200, json: async () => emptyResponse() } as any;
    }) as any);

    const first = ordpoolOtsPoller.tick();
    const second = await ordpoolOtsPoller.tick(); // should return [] because inFlight
    expect(second).toEqual([]);

    resolveFirst(emptyResponse());
    await first;
  });

  it('feerate as number is stringified before insert', async () => {
    ordpoolOtsPoller.setFetch(stubFetch({
      [ALICE.url]: {
        tip: TIP,
        transactions: [{
          txid: TXID_CONF,
          confirmations: 3,
          blockhash: '0'.repeat(64),
          blockheight: 948192,
          blocktime: 1778100000,
          fee: -159,
          feerate: 1.42,                    // numeric, not string
        }],
        most_recent_tx: 'None',
      },
      [BOB.url]: emptyResponse(),
      [FINNEY.url]: emptyResponse(),
      [CATALLAXY.url]: emptyResponse(),
    }));

    await ordpoolOtsPoller.tick();
    expect(repoMock.upsertConfirmed).toHaveBeenCalledWith(expect.objectContaining({ feerate: '1.42' }));
  });
});
