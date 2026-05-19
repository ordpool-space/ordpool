/**
 * Curated lookup for known Alkanes contracts. Temporary stopgap until the
 * backend alkanes-metadata endpoint replaces it. Outbound `url` field is
 * intentionally absent -- we don't link visitors to other explorers unless
 * they link back to us.
 */
export interface KnownAlkane {
  name: string;
}

export const KNOWN_ALKANES: Record<string, KnownAlkane> = {
  '2:0': { name: 'DIESEL' },
};

export function lookupAlkane(block: bigint, tx: bigint): KnownAlkane | undefined {
  return KNOWN_ALKANES[`${block}:${tx}`];
}
