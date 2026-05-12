import { readFileSync } from 'fs';
import { resolve } from 'path';

/*
The OTS poller hydrates `ordpoolOtsTxidSet` asynchronously. Per
ORDPOOL-FLAGS-ARCHITECTURE.md §6.1, `ordpoolOtsTxidSet.bootstrap()` MUST
complete before any code path that re-classifies persisted-mempool
transactions runs (today: `disk-cache.$loadMempoolCache` and
`redis-cache.$loadCache`, both of which call `memPool.$setMempool`).

If the order is reversed, every persisted mempool tx hits the
`getTransactionFlags` early-return path with an empty
`ordpoolOtsTxidSet`, picking up no OTS bit. The bit silently stays
absent until the tx is re-classified by some other code path.

This spec pins the order textually rather than by hooking the boot
sequence (which would require instantiating the entire backend). If
either name moves, this test fires and the next maintainer reads the
comment block.
*/

const INDEX_TS = resolve(__dirname, '../index.ts');

describe('Boot order — ordpoolOtsTxidSet.bootstrap() must precede mempool-cache reload', () => {

  const source = readFileSync(INDEX_TS, 'utf8');

  function lineOf(needle: string): number {
    const idx = source.indexOf(needle);
    if (idx < 0) {
      throw new Error(`expected to find "${needle}" in ${INDEX_TS}, but it's not there`);
    }
    return source.slice(0, idx).split('\n').length;
  }

  it('ordpoolOtsTxidSet.bootstrap() appears before diskCache.\$loadMempoolCache()', () => {
    const bootstrapLine = lineOf('ordpoolOtsTxidSet.bootstrap()');
    const diskLoadLine = lineOf('diskCache.$loadMempoolCache()');
    expect(bootstrapLine).toBeLessThan(diskLoadLine);
  });

  it('ordpoolOtsTxidSet.bootstrap() appears before redisCache.\$loadCache()', () => {
    const bootstrapLine = lineOf('ordpoolOtsTxidSet.bootstrap()');
    const redisLoadLine = lineOf('redisCache.$loadCache()');
    expect(bootstrapLine).toBeLessThan(redisLoadLine);
  });

  it('ordpoolOtsPoller.start() appears immediately after the bootstrap (so retries happen if it failed)', () => {
    const bootstrapLine = lineOf('ordpoolOtsTxidSet.bootstrap()');
    const pollerStartLine = lineOf('ordpoolOtsPoller.start()');
    expect(pollerStartLine).toBeGreaterThan(bootstrapLine);
    // Same try/catch / same function; close together is enough.
    expect(pollerStartLine - bootstrapLine).toBeLessThan(20);
  });
});
