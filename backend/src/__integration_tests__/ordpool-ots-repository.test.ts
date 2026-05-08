import DB from '../database';
import ordpoolOtsRepository from '../repositories/OrdpoolOtsRepository';
import { cleanupOrdpoolStats, setupOrdpoolTestDatabase, waitForDatabase } from './test-helpers';

const TXID_A = '8d8ce7ac7b68335a040243f31e7e3a2ba8fb82166ca569e7c8b80361b90e8b9f';
const TXID_B = '914a3f3575a1da92035a57bd758da8588fd11776927ab880915f97e66612f773';
const TXID_C = '054cc18a8162887917a1e6e5c60389bb4b6647167e6936d231466d7b2710f413';

const MERKLE_ROOT_A = '64a604fcdfa6b5bb2f3245a283da4cad7d2d33064904fe0d2a689e4fbbb123ef';
const MERKLE_ROOT_B = '7f909ce454f6c88a6f6721e2e4527ac0a76ca6460a0f0bbdf94978aeae58081e';
const MERKLE_ROOT_C = 'a178423236373963363035646631323031663530316239383237666136313653';

describe('OrdpoolOtsRepository (integration, live MariaDB)', () => {
  beforeAll(async () => {
    await waitForDatabase();
    await setupOrdpoolTestDatabase();
  }, 120000);

  beforeEach(async () => {
    await cleanupOrdpoolStats();
  });

  describe('upsertPending', () => {
    it('inserts a new pending row', async () => {
      await ordpoolOtsRepository.upsertPending({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
      });

      const row = await ordpoolOtsRepository.getByTxid(TXID_A);
      expect(row).not.toBeNull();
      expect(row!.txid).toBe(TXID_A);
      expect(row!.calendar).toBe('alice');
      expect(row!.merkleRoot).toBe(MERKLE_ROOT_A);
      expect(row!.confirmedAt).toBeNull();
      expect(row!.blockhash).toBeNull();
      expect(row!.blockheight).toBeNull();
      expect(row!.firstSeenAt).toBeInstanceOf(Date);
    });

    it('is idempotent: re-inserting the same pending row does not error', async () => {
      await ordpoolOtsRepository.upsertPending({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
      });
      await expect(ordpoolOtsRepository.upsertPending({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
      })).resolves.not.toThrow();

      const row = await ordpoolOtsRepository.getByTxid(TXID_A);
      expect(row!.confirmedAt).toBeNull();
    });

    it('upsertPending on an already-confirmed row does NOT downgrade it', async () => {
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
        blockhash: '0'.repeat(64), blockheight: 948192, blocktime: 1778100000,
        fee: 159, feerate: '0.68',
      });
      await ordpoolOtsRepository.upsertPending({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
      });

      const row = await ordpoolOtsRepository.getByTxid(TXID_A);
      expect(row!.confirmedAt).toBeInstanceOf(Date);
      expect(row!.blockheight).toBe(948192);
    });
  });

  describe('upsertConfirmed', () => {
    it('inserts a new confirmed row directly (we never saw it pending)', async () => {
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
        blockhash: '0'.repeat(64), blockheight: 948192, blocktime: 1778100000,
        fee: 159, feerate: '0.68',
      });

      const row = await ordpoolOtsRepository.getByTxid(TXID_A);
      expect(row!.confirmedAt).toBeInstanceOf(Date);
      expect(row!.blockhash).toBe('0'.repeat(64));
      expect(row!.blockheight).toBe(948192);
      expect(row!.blocktime).toBe(1778100000);
      expect(row!.fee).toBe(159);
      expect(row!.feerate).toBe('0.68');
    });

    it('upgrades a pending row to confirmed', async () => {
      await ordpoolOtsRepository.upsertPending({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
      });
      const before = await ordpoolOtsRepository.getByTxid(TXID_A);
      expect(before!.confirmedAt).toBeNull();

      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
        blockhash: '0'.repeat(64), blockheight: 948192, blocktime: 1778100000,
        fee: 159, feerate: '0.68',
      });

      const after = await ordpoolOtsRepository.getByTxid(TXID_A);
      expect(after!.confirmedAt).toBeInstanceOf(Date);
      expect(after!.blockheight).toBe(948192);
      // first_seen_at preserved across the upgrade
      expect(after!.firstSeenAt.getTime()).toBe(before!.firstSeenAt.getTime());
    });

    it('re-confirming with new chain data refreshes the chain fields but preserves confirmed_at', async () => {
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
        blockhash: '0'.repeat(64), blockheight: 948192, blocktime: 1778100000,
        fee: 159, feerate: '0.68',
      });
      const first = await ordpoolOtsRepository.getByTxid(TXID_A);

      // Tiny gap so DATETIME comparison is meaningful even on fast machines.
      await new Promise(r => setTimeout(r, 1100));

      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
        blockhash: '1'.repeat(64), blockheight: 948193, blocktime: 1778100600,
        fee: 200, feerate: '0.85',
      });
      const second = await ordpoolOtsRepository.getByTxid(TXID_A);

      // confirmed_at is NOT updated on re-confirm (COALESCE in the SQL)
      expect(second!.confirmedAt!.getTime()).toBe(first!.confirmedAt!.getTime());
      // chain fields refresh
      expect(second!.blockhash).toBe('1'.repeat(64));
      expect(second!.blockheight).toBe(948193);
      expect(second!.fee).toBe(200);
    });
  });

  describe('getAllTxids', () => {
    it('returns every txid in the table', async () => {
      await ordpoolOtsRepository.upsertPending({ txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A });
      await ordpoolOtsRepository.upsertPending({ txid: TXID_B, calendar: 'bob', merkleRoot: MERKLE_ROOT_B });

      const txids = await ordpoolOtsRepository.getAllTxids();
      expect(txids.sort()).toEqual([TXID_A, TXID_B].sort());
    });

    it('returns empty array on empty table', async () => {
      expect(await ordpoolOtsRepository.getAllTxids()).toEqual([]);
    });
  });

  describe('getCalendarStats', () => {
    it('groups by calendar with correct counts and pending count', async () => {
      // alice: 2 confirmed
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
        blockhash: '0'.repeat(64), blockheight: 948000, blocktime: 1778000000, fee: 159, feerate: '0.68',
      });
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_B, calendar: 'alice', merkleRoot: MERKLE_ROOT_B,
        blockhash: '1'.repeat(64), blockheight: 948100, blocktime: 1778001000, fee: 200, feerate: '0.85',
      });
      // bob: 1 pending
      await ordpoolOtsRepository.upsertPending({
        txid: TXID_C, calendar: 'bob', merkleRoot: MERKLE_ROOT_C,
      });

      const stats = await ordpoolOtsRepository.getCalendarStats();
      const alice = stats.find(s => s.calendar === 'alice')!;
      const bob = stats.find(s => s.calendar === 'bob')!;

      expect(alice.totalCommits).toBe(2);
      expect(alice.lastBlockheight).toBe(948100);
      expect(alice.lastBlocktime).toBe(1778001000);
      expect(alice.pendingCount).toBe(0);

      expect(bob.totalCommits).toBe(1);
      expect(bob.lastBlockheight).toBeNull();
      expect(bob.pendingCount).toBe(1);
    });
  });

  describe('getRecent', () => {
    it('returns confirmed only, ordered by blockheight DESC, respecting limit', async () => {
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
        blockhash: '0'.repeat(64), blockheight: 948000, blocktime: 1778000000, fee: 159, feerate: '0.68',
      });
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_B, calendar: 'bob', merkleRoot: MERKLE_ROOT_B,
        blockhash: '1'.repeat(64), blockheight: 948500, blocktime: 1778001000, fee: 200, feerate: '0.85',
      });
      await ordpoolOtsRepository.upsertPending({
        txid: TXID_C, calendar: 'finney', merkleRoot: MERKLE_ROOT_C,
      });

      const recent = await ordpoolOtsRepository.getRecent(10);
      expect(recent.map(r => r.txid)).toEqual([TXID_B, TXID_A]); // desc by blockheight, pending excluded
    });

    it('respects limit', async () => {
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
        blockhash: '0'.repeat(64), blockheight: 948000, blocktime: 1778000000, fee: 159, feerate: '0.68',
      });
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_B, calendar: 'bob', merkleRoot: MERKLE_ROOT_B,
        blockhash: '1'.repeat(64), blockheight: 948500, blocktime: 1778001000, fee: 200, feerate: '0.85',
      });
      const recent = await ordpoolOtsRepository.getRecent(1);
      expect(recent.length).toBe(1);
      expect(recent[0].txid).toBe(TXID_B);
    });
  });

  describe('getByBlockheight', () => {
    it('returns every commit at the given height (across calendars)', async () => {
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
        blockhash: '0'.repeat(64), blockheight: 948500, blocktime: 1778001000, fee: 159, feerate: '0.68',
      });
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_B, calendar: 'bob', merkleRoot: MERKLE_ROOT_B,
        blockhash: '0'.repeat(64), blockheight: 948500, blocktime: 1778001000, fee: 200, feerate: '0.85',
      });
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_C, calendar: 'finney', merkleRoot: MERKLE_ROOT_C,
        blockhash: '1'.repeat(64), blockheight: 948501, blocktime: 1778001500, fee: 175, feerate: '0.71',
      });

      const at500 = await ordpoolOtsRepository.getByBlockheight(948500);
      expect(at500.map(r => r.txid).sort()).toEqual([TXID_A, TXID_B].sort());

      const at501 = await ordpoolOtsRepository.getByBlockheight(948501);
      expect(at501.map(r => r.txid)).toEqual([TXID_C]);
    });

    it('returns empty array when no rows match', async () => {
      expect(await ordpoolOtsRepository.getByBlockheight(123456)).toEqual([]);
    });
  });

  describe('merkle_root round-trip', () => {
    it('hex string in, same hex string out (no byte-order surprises)', async () => {
      await ordpoolOtsRepository.upsertConfirmed({
        txid: TXID_A, calendar: 'alice', merkleRoot: MERKLE_ROOT_A,
        blockhash: '0'.repeat(64), blockheight: 948000, blocktime: 1778000000, fee: 159, feerate: '0.68',
      });
      const row = await ordpoolOtsRepository.getByTxid(TXID_A);
      expect(row!.merkleRoot).toBe(MERKLE_ROOT_A);
    });
  });
});
