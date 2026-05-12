import ordpoolOtsRepository from '../repositories/OrdpoolOtsRepository';
import ordpoolOtsTxidSet from './ordpool-ots-txid-set';

jest.mock('../repositories/OrdpoolOtsRepository', () => ({
  __esModule: true,
  default: {
    getAllTxids: jest.fn(),
  },
}));

jest.mock('../logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    err: jest.fn(),
  },
}));

/*
Backend liveness must not depend on a healthy `ordpool_stats_ots`
satellite table. A bootstrap failure (DB outage, partial schema,
permissions glitch) is treated as a soft error: the in-memory
`ordpoolOtsTxidSet` stays empty, `getOtsFlag` returns `0n` for every
tx (no OTS badges anywhere), and the poller can retry later.

The handler at `index.ts:~150` does `try/catch` around
`ordpoolOtsTxidSet.bootstrap()` and logs a warning on failure.

This spec pins the contract that `bootstrap()` ITSELF propagates the
error (so the caller can catch and decide), and that the set remains
in a clean post-failure state: empty and `isBootstrapped() === false`
(so the poller knows to retry).
*/

describe('OrdpoolOtsTxidSet — bootstrap fail-soft contract', () => {

  beforeEach(() => {
    ordpoolOtsTxidSet.reset();
    jest.clearAllMocks();
  });

  it('propagates the error so callers can decide what to do', async () => {
    (ordpoolOtsRepository.getAllTxids as jest.Mock).mockRejectedValueOnce(
      new Error('Connection refused'),
    );
    await expect(ordpoolOtsTxidSet.bootstrap()).rejects.toThrow('Connection refused');
  });

  it('leaves the set empty after a failed bootstrap', async () => {
    (ordpoolOtsRepository.getAllTxids as jest.Mock).mockRejectedValueOnce(
      new Error('Connection refused'),
    );
    await expect(ordpoolOtsTxidSet.bootstrap()).rejects.toThrow();
    expect(ordpoolOtsTxidSet.size()).toBe(0);
  });

  it('leaves isBootstrapped() === false after a failed bootstrap (so the poller retries)', async () => {
    (ordpoolOtsRepository.getAllTxids as jest.Mock).mockRejectedValueOnce(
      new Error('Connection refused'),
    );
    await expect(ordpoolOtsTxidSet.bootstrap()).rejects.toThrow();
    expect(ordpoolOtsTxidSet.isBootstrapped()).toBe(false);
  });

  it('a subsequent successful bootstrap fills the set correctly', async () => {
    // First call fails.
    (ordpoolOtsRepository.getAllTxids as jest.Mock).mockRejectedValueOnce(
      new Error('Connection refused'),
    );
    await expect(ordpoolOtsTxidSet.bootstrap()).rejects.toThrow();
    expect(ordpoolOtsTxidSet.size()).toBe(0);

    // Second call succeeds with a real result.
    (ordpoolOtsRepository.getAllTxids as jest.Mock).mockResolvedValueOnce(['aabb', 'ccdd']);
    await ordpoolOtsTxidSet.bootstrap();
    expect(ordpoolOtsTxidSet.size()).toBe(2);
    expect(ordpoolOtsTxidSet.isBootstrapped()).toBe(true);
    expect(ordpoolOtsTxidSet.has('aabb')).toBe(true);
    expect(ordpoolOtsTxidSet.has('ccdd')).toBe(true);
  });
});
