import config from '../../../config';

/**
 * Normalises an inscription id or bare txid to its leading 64-hex txid.
 * Returns null when the input doesn't start with a txid.
 */
function leadingTxid(value: string): string | null {
  const match = value.toLowerCase().match(/^[0-9a-f]{64}/);
  return match ? match[0] : null;
}

/**
 * Pure membership check: is `inscriptionIdOrTxid` covered by `hidden`?
 *
 * Both sides are normalised to their leading txid, so one hidden entry
 * (`<txid>` or `<txid>i0`) matches every form the content routes accept:
 * `<txid>`, `<txid>i0`, `<txid>i37`, any letter case. The bare-txid form is
 * what the block-overview atlas requests (`/content/<txid>`), so txid-level
 * matching is required, not exact-id matching.
 */
export function isHiddenInscription(hidden: readonly string[], inscriptionIdOrTxid: string): boolean {
  const txid = leadingTxid(inscriptionIdOrTxid);
  if (txid === null) {
    return false;
  }
  return hidden.some((entry) => leadingTxid(entry) === txid);
}

/**
 * Returns true if the inscription id / txid is on the server-configured
 * hidden list. The list lives only in the server's (gitignored)
 * mempool-config.json under HIDDEN.INSCRIPTIONS and is never committed.
 */
export function isHidden(inscriptionIdOrTxid: string): boolean {
  return isHiddenInscription(config.HIDDEN.INSCRIPTIONS, inscriptionIdOrTxid);
}
