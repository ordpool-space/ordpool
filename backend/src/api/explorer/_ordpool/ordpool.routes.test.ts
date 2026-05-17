import { Request, Response } from 'express';
import { getFirstInscriptionHeight } from 'ordpool-parser';

import blocks from '../../blocks';
import OrdpoolMissingStats from '../../ordpool-missing-stats';
import ordpoolBlocksRepository from '../../../repositories/OrdpoolBlocksRepository';
import ordpoolSkippedBlocksRepository from '../../../repositories/OrdpoolSkippedBlocksRepository';
import generalOrdpoolRoutes from './ordpool.routes';

// Factory mocks short-circuit the module-load chain so the suite boots
// without a real mempool-config.json. Auto-mocks would still load each
// module's source to discover its shape, and that load reads config at
// the top of database.ts / bitcoin-client.ts. Factory mocks bypass that.
jest.mock('../../blocks', () => ({
  __esModule: true,
  default: { getCurrentBlockHeight: jest.fn() },
}));
jest.mock('../../ordpool-missing-stats', () => ({
  __esModule: true,
  default: { getLastSuccessAt: jest.fn(), getBlocksPerMinute: jest.fn() },
}));
jest.mock('../../../repositories/OrdpoolBlocksRepository', () => ({
  __esModule: true,
  default: { getMaxStatsHeight: jest.fn(), getPendingStatsCount: jest.fn() },
}));
jest.mock('../../../repositories/OrdpoolSkippedBlocksRepository', () => ({
  __esModule: true,
  default: { getSkippedCount: jest.fn(), getSkippedHeights: jest.fn() },
}));
jest.mock('../../../repositories/OrdpoolOtsRepository', () => ({
  __esModule: true,
  default: {
    getByTxid: jest.fn(),
    getRecent: jest.fn(),
    getCalendarStats: jest.fn(),
    getByBlockheight: jest.fn(),
  },
}));
jest.mock('../../ordpool-ots-txid-set', () => ({
  __esModule: true,
  default: {
    has: jest.fn(),
  },
}));
jest.mock('./ordpool-inscriptions.api', () => ({ __esModule: true, default: {} }));
jest.mock('./ordpool-stamps.api', () => ({ __esModule: true, default: {} }));
jest.mock('./ordpool-atomicals.api', () => ({ __esModule: true, default: {} }));
jest.mock('./ordpool-statistics.api', () => ({ __esModule: true, default: {} }));
// ordpool-parser is left unmocked: getFirstInscriptionHeight is a pure
// constant lookup with no side effects, so we exercise the real one.
jest.mock('../../../config', () => ({
  __esModule: true,
  default: {
    MEMPOOL: { NETWORK: 'mainnet', API_URL_PREFIX: '/api/v1/' },
  },
}));

function makeRes() {
  const res: Partial<Response> = {};
  res.setHeader = jest.fn();
  res.status = jest.fn().mockImplementation(() => res);
  res.json = jest.fn().mockImplementation(() => res);
  res.send = jest.fn().mockImplementation(() => res);
  return res as Response;
}

async function call$getIndexerProgress() {
  const res = makeRes();
  await (generalOrdpoolRoutes as any).$getIndexerProgress({} as Request, res);
  return res as Response & { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock };
}

function jsonBody(res: Response): any {
  return (res.json as jest.Mock).mock.calls[0][0];
}

describe('$getIndexerProgress route handler', () => {

  beforeEach(() => {
    jest.resetAllMocks();
    // Sane defaults — each test overrides what it cares about.
    (ordpoolSkippedBlocksRepository.getSkippedCount as jest.Mock).mockResolvedValue(0);
    (ordpoolSkippedBlocksRepository.getSkippedHeights as jest.Mock).mockResolvedValue([]);
    (ordpoolBlocksRepository.getMaxStatsHeight as jest.Mock).mockResolvedValue(948000);
    (ordpoolBlocksRepository.getPendingStatsCount as jest.Mock).mockResolvedValue(0);
    (OrdpoolMissingStats.getLastSuccessAt as jest.Mock).mockReturnValue(null);
    (OrdpoolMissingStats.getBlocksPerMinute as jest.Mock).mockReturnValue(null);
    (blocks.getCurrentBlockHeight as jest.Mock).mockReturnValue(948000);
  });

  describe('caughtUp short-circuit (regression for the heartbeat-thrash bug)', () => {

    it('returns 200 ok:true when pendingCount is 0 and lastSuccessAt is null', async () => {
      // Post-process-restart steady state: no batches have run yet, so
      // lastSuccessAt is null. With nothing pending the indexer is fine.
      (ordpoolBlocksRepository.getPendingStatsCount as jest.Mock).mockResolvedValue(0);
      (OrdpoolMissingStats.getLastSuccessAt as jest.Mock).mockReturnValue(null);

      const res = await call$getIndexerProgress();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(jsonBody(res).ok).toBe(true);
      expect(jsonBody(res).pendingCount).toBe(0);
      expect(jsonBody(res).lastSuccessAt).toBe(null);
      expect(jsonBody(res).lagMinutes).toBe(null);
    });

    it('returns 200 ok:true when pendingCount is 0 even if lastSuccessAt is hours stale', async () => {
      // The exact failure mode that fired Healthchecks alerts: backfill
      // drained, lastSuccessAt froze in time (the live-block path doesn't
      // touch it), and ~30 min later the route flipped to 503.
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      (ordpoolBlocksRepository.getPendingStatsCount as jest.Mock).mockResolvedValue(0);
      (OrdpoolMissingStats.getLastSuccessAt as jest.Mock).mockReturnValue(oneHourAgo);

      const res = await call$getIndexerProgress();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(jsonBody(res).ok).toBe(true);
    });
  });

  describe('lag-based freshness when work is pending', () => {

    it('returns 503 ok:false when pendingCount > 0 and lastSuccessAt is null', async () => {
      // Process just restarted with backfill still pending: must not appear
      // healthy because the missing-stats indexer hasn't proven liveness yet.
      (ordpoolBlocksRepository.getPendingStatsCount as jest.Mock).mockResolvedValue(100);
      (OrdpoolMissingStats.getLastSuccessAt as jest.Mock).mockReturnValue(null);

      const res = await call$getIndexerProgress();

      expect(res.status).toHaveBeenCalledWith(503);
      expect(jsonBody(res).ok).toBe(false);
    });

    it('returns 200 ok:true when pendingCount > 0 and lastSuccessAt is within MAX_LAG_MINUTES', async () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      (ordpoolBlocksRepository.getPendingStatsCount as jest.Mock).mockResolvedValue(100);
      (OrdpoolMissingStats.getLastSuccessAt as jest.Mock).mockReturnValue(fiveMinutesAgo);

      const res = await call$getIndexerProgress();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(jsonBody(res).ok).toBe(true);
      expect(jsonBody(res).lagMinutes).toBe(5);
    });

    it('returns 503 ok:false when pendingCount > 0 and lastSuccessAt is past MAX_LAG_MINUTES', async () => {
      // The original poison-block alert scenario: indexer wedged on a single
      // block, no batches succeeding, work still pending -> alert fires.
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      (ordpoolBlocksRepository.getPendingStatsCount as jest.Mock).mockResolvedValue(100);
      (OrdpoolMissingStats.getLastSuccessAt as jest.Mock).mockReturnValue(oneHourAgo);

      const res = await call$getIndexerProgress();

      expect(res.status).toHaveBeenCalledWith(503);
      expect(jsonBody(res).ok).toBe(false);
      expect(jsonBody(res).lagMinutes).toBe(60);
    });

    it('treats the MAX_LAG_MINUTES boundary as inclusive (200 at exactly the limit)', async () => {
      // Route uses lagMs <= MAX_LAG_MINUTES * 60_000.
      const thirtyMinMinusOneSecond = new Date(Date.now() - (30 * 60 * 1000 - 1000));
      (ordpoolBlocksRepository.getPendingStatsCount as jest.Mock).mockResolvedValue(100);
      (OrdpoolMissingStats.getLastSuccessAt as jest.Mock).mockReturnValue(thirtyMinMinusOneSecond);

      const res = await call$getIndexerProgress();

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('payload structure', () => {

    it('exposes every progress field with the right values', async () => {
      (ordpoolSkippedBlocksRepository.getSkippedCount as jest.Mock).mockResolvedValue(3);
      (ordpoolSkippedBlocksRepository.getSkippedHeights as jest.Mock).mockResolvedValue([810965, 811074, 811543]);
      (ordpoolBlocksRepository.getMaxStatsHeight as jest.Mock).mockResolvedValue(948276);
      (ordpoolBlocksRepository.getPendingStatsCount as jest.Mock).mockResolvedValue(56261);
      (OrdpoolMissingStats.getBlocksPerMinute as jest.Mock).mockReturnValue(343.18);
      (blocks.getCurrentBlockHeight as jest.Mock).mockReturnValue(948280);

      const res = await call$getIndexerProgress();
      const body = jsonBody(res);

      expect(body.skippedCount).toBe(3);
      expect(body.skippedHeights).toEqual([810965, 811074, 811543]);
      expect(body.frontierHeight).toBe(948276);
      expect(body.tipHeight).toBe(948280);
      expect(body.pendingCount).toBe(56261);
      expect(body.blocksPerMinute).toBe(343.18);
      expect(body.maxLagMinutes).toBe(30);
      expect(body.firstStatsHeight).toBe(getFirstInscriptionHeight('mainnet'));
    });

    it('serialises lastSuccessAt as an ISO 8601 string', async () => {
      const t = new Date('2026-05-07T06:00:00.000Z');
      (OrdpoolMissingStats.getLastSuccessAt as jest.Mock).mockReturnValue(t);
      (ordpoolBlocksRepository.getPendingStatsCount as jest.Mock).mockResolvedValue(100);

      const res = await call$getIndexerProgress();

      expect(jsonBody(res).lastSuccessAt).toBe('2026-05-07T06:00:00.000Z');
    });

    it('sets Cache-Control: no-store so heartbeat polls always observe live state', async () => {
      const res = await call$getIndexerProgress();
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });
});

// Mock the calendars config so we know exactly which hostnames are
// whitelisted. The real config reads a JSON file; for tests we just
// declare two hosts and assert that anything else 400s.
jest.mock('./ots-calendars-config', () => ({
  __esModule: true,
  getOtsCalendars: jest.fn(),
  getOtsCalendarHosts: jest.fn(() => new Set([
    'alice.btc.calendar.opentimestamps.org',
    'bob.btc.calendar.opentimestamps.org',
  ])),
}));

describe('$proxyOtsDigest route handler (privacy shield for stamp submissions)', () => {

  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    // Re-arm the calendar-host whitelist because resetAllMocks clears it.
    const cfg = require('./ots-calendars-config');
    (cfg.getOtsCalendarHosts as jest.Mock).mockReturnValue(new Set([
      'alice.btc.calendar.opentimestamps.org',
      'bob.btc.calendar.opentimestamps.org',
    ]));
    fetchSpy = jest.spyOn(globalThis, 'fetch' as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  async function call$proxyOtsDigest(calendar: string, body: any) {
    const res = makeRes();
    await (generalOrdpoolRoutes as any).$proxyOtsDigest(
      { params: { calendar }, body } as unknown as Request,
      res,
    );
    return res as Response & { status: jest.Mock; setHeader: jest.Mock; send: jest.Mock; end: jest.Mock };
  }

  it('forwards a 32-byte SHA-256 digest to the whitelisted calendar and returns the upstream bytes', async () => {
    const digest = Buffer.alloc(32, 0x42);
    const upstreamBody = Buffer.from([0xf0, 0x10, 0x42, 0x00, 0xff]);
    fetchSpy.mockResolvedValueOnce({
      status: 200,
      arrayBuffer: async () => upstreamBody.buffer.slice(upstreamBody.byteOffset, upstreamBody.byteOffset + upstreamBody.byteLength),
    } as any);

    const res = await call$proxyOtsDigest('alice.btc.calendar.opentimestamps.org', digest);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://alice.btc.calendar.opentimestamps.org/digest',
      expect.objectContaining({ method: 'POST', body: digest }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.opentimestamps.v1');
  });

  it('identifies itself to the calendar with a friendly User-Agent (URL + contact invitation)', async () => {
    // The default Node fetch User-Agent reads as anonymous bot traffic;
    // an identifying UA gives calendar operators a path to reach us
    // before they reach for the block button.
    fetchSpy.mockResolvedValueOnce({ status: 200, arrayBuffer: async () => new ArrayBuffer(0) } as any);

    await call$proxyOtsDigest('alice.btc.calendar.opentimestamps.org', Buffer.alloc(32, 0));

    const [, init] = fetchSpy.mock.calls[0];
    const ua = (init?.headers as Record<string, string>)?.['User-Agent'];
    // Domain identifier (lower-case ordpool.space), URL to the page that
    // explains what we do, and a contact invitation.
    expect(ua).toMatch(/\bordpool\.space proxy\b/);
    expect(ua).toMatch(/https:\/\/ordpool\.space\/open-timestamps/);
    expect(ua).toMatch(/contact us/i);
  });

  it('rejects an unknown calendar host with 400 (so this cannot be used as an open POST relay)', async () => {
    const res = await call$proxyOtsDigest('evil.example.org', Buffer.alloc(32, 0));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('unknown calendar');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty body', async () => {
    const res = await call$proxyOtsDigest('alice.btc.calendar.opentimestamps.org', Buffer.alloc(0));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('invalid digest body');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects oversize bodies (cap 256 bytes, real OTS digests are 32)', async () => {
    const res = await call$proxyOtsDigest('alice.btc.calendar.opentimestamps.org', Buffer.alloc(1024, 0));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('invalid digest body');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects non-Buffer bodies (middleware bypass guard)', async () => {
    // If express.raw didn't run (or was bypassed), req.body might be the
    // body-parser default of {} or undefined. The handler must refuse to
    // forward in that case rather than POSTing nonsense to the calendar.
    const res = await call$proxyOtsDigest('alice.btc.calendar.opentimestamps.org', { not: 'a buffer' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('invalid digest body');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps a non-200 upstream response to 502', async () => {
    fetchSpy.mockResolvedValueOnce({ status: 503, arrayBuffer: async () => new ArrayBuffer(0) } as any);

    const res = await call$proxyOtsDigest('bob.btc.calendar.opentimestamps.org', Buffer.alloc(32, 0));

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.send).toHaveBeenCalledWith('upstream returned 503');
  });

  it('maps a thrown fetch (network failure / abort) to 502', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    const res = await call$proxyOtsDigest('alice.btc.calendar.opentimestamps.org', Buffer.alloc(32, 0));

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.send).toHaveBeenCalledWith('upstream error');
  });
});
