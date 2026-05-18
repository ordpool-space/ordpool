/**
 * Curated lookup for known Alkanes contracts. Maps `block:tx` AlkaneId
 * strings to human-readable names and (optional) external explorer URLs.
 *
 * We don't run an indexer, so this list is hand-maintained. Add an entry
 * when an alkane gets enough activity that surfacing its name in the
 * viewer is worth the extra characters of code.
 */
export interface KnownAlkane {
  name: string;
  url?: string;
}

export const KNOWN_ALKANES: Record<string, KnownAlkane> = {
  '2:0': {
    name: 'DIESEL',
    url: 'https://ordiscan.com/alkane/DIESEL/2:0',
  },
};

export function lookupAlkane(block: bigint, tx: bigint): KnownAlkane | undefined {
  return KNOWN_ALKANES[`${block}:${tx}`];
}
