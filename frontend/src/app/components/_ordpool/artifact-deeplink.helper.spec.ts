import { DigitalArtifact, DigitalArtifactType } from 'ordpool-parser';
import { findArtifactIndex } from './artifact-deeplink.helper';

// Minimal fixtures — only the fields findArtifactIndex reads. ordpool-parser is
// zero-dependency, so its real DigitalArtifactType enum loads in jest directly.
function inscription(inscriptionId: string): DigitalArtifact {
  return { type: DigitalArtifactType.Inscription, uniqueId: inscriptionId, transactionId: 't', inscriptionId } as unknown as DigitalArtifact;
}
function runestone(runeName: string | null): DigitalArtifact {
  return {
    type: DigitalArtifactType.Runestone,
    uniqueId: 'r',
    transactionId: 't',
    runestone: runeName == null ? null : { etching: { runeName } },
  } as unknown as DigitalArtifact;
}
function cat(): DigitalArtifact {
  return { type: DigitalArtifactType.Cat21, uniqueId: 'c', transactionId: 't' } as unknown as DigitalArtifact;
}

const ID = 'a'.repeat(64) + 'i0';

describe('findArtifactIndex', () => {
  it('matches an inscription by its full inscription id', () => {
    expect(findArtifactIndex([cat(), inscription(ID), runestone('X')], ID)).toBe(1);
  });

  it('matches by IDENTITY, not array position (an inscription is not at its Nth-in-tx index)', () => {
    const ID2 = 'b'.repeat(64) + 'i5';
    // ID2 is the 2nd inscription but sits at array index 2 (a cat is interleaved).
    expect(findArtifactIndex([inscription(ID), cat(), inscription(ID2)], ID2)).toBe(2);
  });

  it('matches a rune by its etching name, spacer- and case-insensitive', () => {
    const arts = [runestone('UNCOMMON•GOODS')];
    expect(findArtifactIndex(arts, 'UNCOMMON•GOODS')).toBe(0); // exact spaced
    expect(findArtifactIndex(arts, 'UNCOMMONGOODS')).toBe(0);  // unspaced
    expect(findArtifactIndex(arts, 'uncommon•goods')).toBe(0); // lower-case
  });

  it('inscription match is EXACT — a wrong index or a missing iN suffix does not match', () => {
    const arts = [inscription(ID)];
    expect(findArtifactIndex(arts, 'a'.repeat(64) + 'i1')).toBe(-1);
    expect(findArtifactIndex(arts, 'a'.repeat(64))).toBe(-1);
  });

  it('returns -1 for no match, empty param, or empty list', () => {
    const arts = [inscription(ID), runestone('X')];
    expect(findArtifactIndex(arts, 'c'.repeat(64) + 'i0')).toBe(-1);
    expect(findArtifactIndex(arts, '')).toBe(-1);
    expect(findArtifactIndex([], ID)).toBe(-1);
  });

  it('ignores a runestone with no etching name', () => {
    expect(findArtifactIndex([runestone(null)], 'X')).toBe(-1);
  });
});
