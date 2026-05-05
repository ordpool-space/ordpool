import { getEmptyStats, OrdpoolStats } from 'ordpool-parser';
import { ORDPOOL_STATS_COLUMNS } from './OrdpoolBlocksRepository';

/**
 * Spec-level round-trip test (no DB required).
 *
 * For every column in ORDPOOL_STATS_COLUMNS, write a unique sentinel value
 * via `val()` from a populated OrdpoolStats, then read it back via `set()`
 * into a fresh OrdpoolStats target, and assert `val(target) === val(source)`.
 *
 * Catches: any spec entry where `val` and `set` point at different fields,
 * which would cause writes to land in column X but reads to come back from
 * column Y — silent data corruption. Doesn't need a real database.
 */
describe('ORDPOOL_STATS_COLUMNS — spec round-trip', () => {

  it('every column unique col + alias', () => {
    const cols = ORDPOOL_STATS_COLUMNS.map(c => c.col);
    const aliases = ORDPOOL_STATS_COLUMNS.map(c => c.alias);
    expect(new Set(cols).size).toBe(cols.length);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it('val(stats) read back via set(target, val(stats)) returns the same value', () => {
    // Stamp every numeric/string field with a unique sentinel. Use the
    // column index as the sentinel so a wrong-field write shows up as the
    // wrong column number in the failure message.
    const source = getEmptyStats() as OrdpoolStats;
    const sentinels = new Map<number, unknown>();
    ORDPOOL_STATS_COLUMNS.forEach((c, i) => {
      // Numeric columns get integer i+1; string columns get distinguishable
      // string sentinels. Use the column name as a hint.
      const sentinel: unknown = c.col.includes('_inscription_id') || c.col.includes('most_active')
        ? `sentinel-${i}`
        : i + 1;
      // Use set() to plant the sentinel, then val() to read it. This
      // checks both directions in one pass against the same field.
      c.set(source, sentinel);
      sentinels.set(i, sentinel);
    });

    // Round-trip: copy every field via the spec into a fresh target.
    const target = getEmptyStats() as OrdpoolStats;
    ORDPOOL_STATS_COLUMNS.forEach((c, i) => {
      target.runes.runeMintActivity = []; // satellite arrays aren't spec-driven
      const value = c.val(source);
      c.set(target, value);

      // Read back from target via the same spec entry.
      expect(c.val(target)).toBe(sentinels.get(i));
    });
  });

  it('truncated columns carry the LEFT(?, 20) placeholder, others default to ?', () => {
    const truncated = ORDPOOL_STATS_COLUMNS.filter(c => c.placeholder === 'LEFT(?, 20)');
    const truncatedCols = truncated.map(c => c.col);
    expect(truncatedCols).toEqual([
      'runes_most_active_mint',
      'runes_most_active_non_uncommon_mint',
      'brc20_most_active_mint',
      'src20_most_active_mint',
    ]);

    // All non-truncated columns must use the default '?' (i.e. placeholder undefined).
    const others = ORDPOOL_STATS_COLUMNS.filter(c => c.placeholder !== 'LEFT(?, 20)');
    for (const c of others) {
      expect(c.placeholder).toBeUndefined();
    }
  });
});
