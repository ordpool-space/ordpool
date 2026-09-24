import { DigitalArtifact, DigitalArtifactType, ParsedInscription, ParsedRunestone } from 'ordpool-parser';

/** Strip rune spacers (U+2022) and lower-case, so a spaced or unspaced rune name matches. */
function normalizeRuneName(name: string): string {
  return name.replace(/•/g, '').toLowerCase();
}

/**
 * Index of the digital artifact a `?artifact=<id>` deep link points at on the tx
 * page, or -1 when there's no match (or an empty/unknown param — the caller then
 * leaves the default page 1).
 *
 * Matches by IDENTITY, not array position: `digitalArtifacts` mixes all types
 * (inscription, runestone, cat, stamp, …) in parse order, so an inscription's
 * Nth-in-tx spot is not its array index. An inscription matches its full
 * inscription id (`<txid>iN`, exact). A rune matches its etching's name,
 * spacer- and case-insensitive, because the linking side may send the spaced
 * form ("UNCOMMON•GOODS") or the bare one ("UNCOMMONGOODS").
 */
export function findArtifactIndex(artifacts: readonly DigitalArtifact[], param: string): number {
  if (!param) {
    return -1;
  }
  const target = normalizeRuneName(param);
  return artifacts.findIndex((a) => {
    if (a.type === DigitalArtifactType.Inscription) {
      return (a as ParsedInscription).inscriptionId === param;
    }
    if (a.type === DigitalArtifactType.Runestone) {
      const runeName = (a as ParsedRunestone).runestone?.etching?.runeName;
      return runeName != null && normalizeRuneName(runeName) === target;
    }
    return false;
  });
}
