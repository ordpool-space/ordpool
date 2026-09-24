// The full ordpool-sdk barrel drags in browser-only deps jest can't resolve
// (bitcoin-address-validation -> base58-js), which is why the component specs
// mock it. `ordpool-sdk/rune` is a dependency-free subpath (0.8 kB, no
// third-party deps) that exports the real formatRunePile, so we wire it in
// directly: this exercises ord's actual Pile rendering, not a stand-in, without
// loading the heavy barrel. A public subpath is the package's contract, so it
// survives the SDK's internal build restructures (a deep path into `dist/`
// does not, and `/core` drags the same deps as the barrel).
jest.mock('ordpool-sdk', () => ({
  formatRunePile: jest.requireActual('ordpool-sdk/rune').formatRunePile,
}));

import { runeLabel } from './rune-label.helper';

// The separator formatRunePile puts between figure and symbol is U+00A0, a
// non-breaking space. Written as an escape (not a pasted character) so a
// reviewer can tell it apart from the ordinary space this helper puts before
// the name. Likewise the currency-sign fallback ord uses for a symbol-less rune.
const NBSP = ' ';
const FALLBACK = '¤'; // ord's ¤ for a rune with no symbol

describe('runeLabel', () => {
  it('renders a whole-number amount (ord /output number shape) as figure, symbol, name', () => {
    expect(runeLabel('ANARCHY', { amount: 12600000, divisibility: 0, symbol: '⬛' }))
      .toBe(`12600000${NBSP}⬛ ANARCHY`);
  });

  it('applies divisibility and strips trailing zeros the way ord does', () => {
    // 1100 base units at divisibility 3 is "1.1", never "1.100".
    expect(runeLabel('R', { amount: 1100, divisibility: 3, symbol: 'X' }))
      .toBe(`1.1${NBSP}X R`);
  });

  it('accepts a string amount (ord /address shape)', () => {
    expect(runeLabel('BITBLOCK', { amount: '750000000', divisibility: 0, symbol: '\u{1f7e7}' }))
      .toBe(`750000000${NBSP}\u{1f7e7} BITBLOCK`);
  });

  it('accepts a bigint amount', () => {
    expect(runeLabel('MEMENTO', { amount: 6n, divisibility: 0, symbol: '\u{1f480}' }))
      .toBe(`6${NBSP}\u{1f480} MEMENTO`);
  });

  it('falls back to ord\'s currency sign when the rune has no symbol', () => {
    expect(runeLabel('R', { amount: 5, divisibility: 0, symbol: null }))
      .toBe(`5${NBSP}${FALLBACK} R`);
  });

  it('does not lose an amount above Number.MAX_SAFE_INTEGER that is representable', () => {
    // DOG's premine: 10^16 base units. Representable as a double, so it survives.
    expect(runeLabel('DOG', { amount: 10000000000000000, divisibility: 0, symbol: '\u{1f415}' }))
      .toBe(`10000000000000000${NBSP}\u{1f415} DOG`);
  });

  describe('falls back to the bare name on a shape it cannot render', () => {
    it('value is not an object', () => {
      expect(runeLabel('R', 'nope')).toBe('R');
      expect(runeLabel('R', null)).toBe('R');
      expect(runeLabel('R', 42)).toBe('R');
    });
    it('amount is missing / negative / non-integer number', () => {
      expect(runeLabel('R', { divisibility: 0, symbol: 'X' })).toBe('R');
      expect(runeLabel('R', { amount: -1, divisibility: 0, symbol: 'X' })).toBe('R');
      expect(runeLabel('R', { amount: 1.5, divisibility: 0, symbol: 'X' })).toBe('R');
    });
    it('divisibility is not a number', () => {
      expect(runeLabel('R', { amount: 5, divisibility: '0', symbol: 'X' })).toBe('R');
    });
    it('formatRuneAmount throws (divisibility out of ord\'s range) — caught, name shown', () => {
      // MAX_RUNE_DIVISIBILITY is 38; 39 makes the SDK throw. A throw must not
      // take the danger panel down, so the row degrades to the bare name.
      expect(runeLabel('R', { amount: 5, divisibility: 39, symbol: 'X' })).toBe('R');
    });
  });
});
