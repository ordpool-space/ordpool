import ordpoolOtsTxidSet from './ordpool-ots-txid-set';
import ordpoolOtsRepository from '../repositories/OrdpoolOtsRepository';

jest.mock('../repositories/OrdpoolOtsRepository', () => ({
  __esModule: true,
  default: { getAllTxids: jest.fn().mockResolvedValue([]) },
}));

const repoMock = ordpoolOtsRepository as jest.Mocked<typeof ordpoolOtsRepository>;

beforeEach(() => {
  jest.clearAllMocks();
  ordpoolOtsTxidSet.reset();
});

describe('OrdpoolOtsTxidSet', () => {

  it('starts empty + un-bootstrapped', () => {
    expect(ordpoolOtsTxidSet.size()).toBe(0);
    expect(ordpoolOtsTxidSet.isBootstrapped()).toBe(false);
    expect(ordpoolOtsTxidSet.has('aabb')).toBe(false);
  });

  it('bootstrap loads every txid from the repo', async () => {
    repoMock.getAllTxids.mockResolvedValueOnce(['t1', 't2', 't3']);
    await ordpoolOtsTxidSet.bootstrap();

    expect(ordpoolOtsTxidSet.size()).toBe(3);
    expect(ordpoolOtsTxidSet.has('t1')).toBe(true);
    expect(ordpoolOtsTxidSet.has('t2')).toBe(true);
    expect(ordpoolOtsTxidSet.has('t3')).toBe(true);
    expect(ordpoolOtsTxidSet.has('t4')).toBe(false);
    expect(ordpoolOtsTxidSet.isBootstrapped()).toBe(true);
  });

  it('bootstrap is idempotent: second call is a no-op', async () => {
    repoMock.getAllTxids.mockResolvedValueOnce(['t1']);
    await ordpoolOtsTxidSet.bootstrap();
    await ordpoolOtsTxidSet.bootstrap();
    expect(repoMock.getAllTxids).toHaveBeenCalledTimes(1);
  });

  it('add() inserts and is reflected by has()', () => {
    expect(ordpoolOtsTxidSet.has('t1')).toBe(false);
    ordpoolOtsTxidSet.add('t1');
    expect(ordpoolOtsTxidSet.has('t1')).toBe(true);
    expect(ordpoolOtsTxidSet.size()).toBe(1);
  });

  it('add is idempotent: re-adding the same txid does not bump size', () => {
    ordpoolOtsTxidSet.add('t1');
    ordpoolOtsTxidSet.add('t1');
    expect(ordpoolOtsTxidSet.size()).toBe(1);
  });

  it('reset clears state and lets bootstrap re-run', async () => {
    repoMock.getAllTxids.mockResolvedValueOnce(['t1']);
    await ordpoolOtsTxidSet.bootstrap();
    expect(ordpoolOtsTxidSet.size()).toBe(1);

    ordpoolOtsTxidSet.reset();
    expect(ordpoolOtsTxidSet.size()).toBe(0);
    expect(ordpoolOtsTxidSet.isBootstrapped()).toBe(false);

    repoMock.getAllTxids.mockResolvedValueOnce(['t2', 't3']);
    await ordpoolOtsTxidSet.bootstrap();
    expect(ordpoolOtsTxidSet.size()).toBe(2);
    expect(ordpoolOtsTxidSet.has('t1')).toBe(false);
    expect(ordpoolOtsTxidSet.has('t2')).toBe(true);
  });

  it('bootstrap rethrows repo errors and does not flip bootstrapped flag', async () => {
    repoMock.getAllTxids.mockRejectedValueOnce(new Error('db down'));
    await expect(ordpoolOtsTxidSet.bootstrap()).rejects.toThrow('db down');
    expect(ordpoolOtsTxidSet.isBootstrapped()).toBe(false);
  });
});
