import { formatRunePile } from 'ordpool-sdk';

/**
 * One rune's label for the "Assets on this UTXO" panel: its balance rendered
 * the way ord renders it, then the rune name (e.g. `12600000 ⬛ ANARCHY`).
 *
 * The value is typed `unknown` by the SDK because it is whatever ord put on
 * `/output/`, so the shape is checked here rather than trusted. ord serialises
 * a pile's amount as a bare JSON NUMBER, so that is the case to expect after
 * `JSON.parse`; a string or a bigint is accepted too, for a value that reached
 * us some other way.
 *
 * A value that does not match falls back to the bare name. `formatRuneAmount`
 * throws on a divisibility it cannot use, and a throw while someone is deciding
 * whether to spend a coin would take the whole danger panel down over a
 * cosmetic detail; the name alone still tells them what is on the coin.
 *
 * The precision bound worth knowing: a rune amount is a u128, and the ones that
 * exceed `Number.MAX_SAFE_INTEGER` have already lost their last digits inside
 * `JSON.parse`, before any code here runs (ord emits a number, not a string, so
 * there is no lossless form to receive). Nothing downstream can recover them,
 * and for a "do not burn this" panel it does not change the decision.
 *
 * Kept byte-identical to cat21.space and cubes so a rune row reads the same on
 * every family site and matches the /tx explorer page it links to.
 */
export function runeLabel(name: string, value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return name;
  }
  const { amount, divisibility, symbol } = value as {
    amount?: unknown;
    divisibility?: unknown;
    symbol?: unknown;
  };

  // Integer-valued numbers go through BigInt, which writes out every digit.
  // String(1e21) is "1e+21", which the SDK rejects as not-base-units, so the
  // amount would silently vanish from the row.
  const units =
    typeof amount === 'number' && Number.isInteger(amount) && amount >= 0
      ? BigInt(amount)
      : typeof amount === 'string' || typeof amount === 'bigint'
        ? amount
        : null;
  if (units === null) {
    return name;
  }
  if (typeof divisibility !== 'number') {
    return name;
  }

  // A non-string symbol (null, missing, or an unexpected shape) maps to null,
  // which formatRunePile renders as ord's ¤ fallback exactly like undefined.
  const sym: string | null = typeof symbol === 'string' ? symbol : null;
  try {
    return `${formatRunePile({ amount: units, divisibility, symbol: sym })} ${name}`;
  } catch {
    return name;
  }
}
