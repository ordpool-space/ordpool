import { isHiddenInscription } from './hidden-content';

// Synthetic ids only -- the matcher is txid-agnostic, so these are dummy
// values. Real hidden ids live in the server config and never enter the repo.
describe('isHiddenInscription', () => {
  const txid = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  const other = '1111111111111111111111111111111111111111111111111111111111111111';

  it('matches a bare txid when the list holds the bare txid', () => {
    expect(isHiddenInscription([txid], txid)).toBe(true);
  });

  it('matches a bare txid request when the list holds the <txid>i0 form', () => {
    // the block-overview atlas requests /content/<txid> (bare)
    expect(isHiddenInscription([`${txid}i0`], txid)).toBe(true);
  });

  it('matches the <txid>i0 request when the list holds the bare txid', () => {
    expect(isHiddenInscription([txid], `${txid}i0`)).toBe(true);
  });

  it('matches a multi-digit inscription index', () => {
    expect(isHiddenInscription([txid], `${txid}i37`)).toBe(true);
  });

  it('matches regardless of letter case', () => {
    expect(isHiddenInscription([txid.toUpperCase()], `${txid.toUpperCase()}I0`)).toBe(true);
  });

  it('finds the entry among several', () => {
    expect(isHiddenInscription([other, `${txid}i0`], `${txid}i2`)).toBe(true);
  });

  it('does not match an unrelated inscription', () => {
    expect(isHiddenInscription([txid], `${other}i0`)).toBe(false);
  });

  it('does not match a malformed / non-hex id', () => {
    expect(isHiddenInscription([txid], 'not-a-txid')).toBe(false);
  });

  it('an empty list matches nothing', () => {
    expect(isHiddenInscription([], `${txid}i0`)).toBe(false);
  });
});
