// Mock the SDK barrel to the family constants only. Importing the real
// 'ordpool-sdk' entry pulls the sats-connect ESM chain jsdom can't load; the
// component only needs the three family exports, so we stand them in with the
// SAME SHAPE the SDK ships (verified against src/family/ordpool-family.ts).
jest.mock('ordpool-sdk', () => ({
  ORDPOOL_FAMILY_HEADING: 'The Ordpool family',
  // The lede is written locally in the component now (not from the SDK), so the
  // mock only needs the heading + members. ordpoolFamilyLede is deliberately
  // absent to prove the component no longer depends on it.
  ORDPOOL_FAMILY: [
    { key: 'ordpool', name: 'ordpool.space', url: 'https://ordpool.space', line: 'See inside every Bitcoin block.' },
    { key: 'cat21', name: 'cat21.space', url: 'https://cat21.space', line: 'Everything CAT-21, a meme protocol from the Creator of Ordpool.' },
    { key: 'cubes', name: 'cubes.haushoppe.art', url: 'https://cubes.haushoppe.art', line: 'Everything cubes, an art project from the Creator of Ordpool.' },
    { key: 'wallet', name: 'CAT-21 wallet', url: 'https://github.com/ordpool-space/cat21-wallet', line: 'A hot wallet for high frequency trading of CAT-21, made for AI agents and their humans.' },
  ],
}));

import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FamilyFooterComponent } from './family-footer.component';

describe('FamilyFooterComponent', () => {
  let fixture: ComponentFixture<FamilyFooterComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [FamilyFooterComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    fixture = TestBed.createComponent(FamilyFooterComponent);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  const members = () => Array.from(el.querySelectorAll('.family-member'));
  const memberByName = (name: string) =>
    members().find((m) => (m.querySelector('.member-name')?.textContent || '').includes(name));

  it('renders the heading and this site\'s two-line local lede, with NO coin-safety claim', () => {
    expect(el.querySelector('.family-heading')?.textContent).toContain('The Ordpool family');
    // Two lines, each in its own .lede-line span, ordpool's medium ("a JPEG").
    const lines = Array.from(el.querySelectorAll('.family-lede .lede-line')).map((s) => (s.textContent || '').trim());
    expect(lines).toEqual(['Sometimes Bitcoin is hard money.', 'Sometimes Bitcoin is a JPEG.']);
    // The footer introduces the family; the "frightening" coin-check clause was
    // removed from it (it lives in the single-address caveat instead). Guard its
    // absence so it cannot creep back into the footer lede.
    expect((el.querySelector('.family-lede')?.textContent || '')).not.toContain('checks what a coin is carrying');
  });

  it('renders every one of the four family members, including this site', () => {
    expect(members().length).toBe(4);
    for (const name of ['ordpool.space', 'cat21.space', 'cubes.haushoppe.art', 'CAT-21 wallet']) {
      expect(memberByName(name)).toBeTruthy();
    }
  });

  it('marks ONLY ordpool as the current row: no link at all, a "You’re here" marker', () => {
    const own = memberByName('ordpool.space')!;
    expect(own.classList).toContain('is-current');
    // The current row has NO anchor anywhere: it is not a link to the site
    // you are already on.
    expect(own.querySelector('a')).toBeNull();
    expect(own.querySelector('span.member-name')).toBeTruthy();
    expect(own.querySelector('.you-are-here')?.textContent).toContain('here');
  });

  it('makes the WHOLE card a link for each of the other three members, not just the name', () => {
    for (const { name, url } of [
      { name: 'cat21.space', url: 'https://cat21.space' },
      { name: 'cubes.haushoppe.art', url: 'https://cubes.haushoppe.art' },
      { name: 'CAT-21 wallet', url: 'https://github.com/ordpool-space/cat21-wallet' },
    ]) {
      const row = memberByName(name)!;
      expect(row.classList).not.toContain('is-current');
      const link = row.querySelector('a.member-link') as HTMLAnchorElement | null;
      expect(link).toBeTruthy();
      expect(link!.getAttribute('href')).toBe(url);
      // Same-tab: inside the family we link directly so clicking through does
      // not open a new tab per member.
      expect(link!.getAttribute('target')).toBeNull();
      expect(link!.getAttribute('rel')).toBeNull();
      // The whole card is inside the single anchor: both the name AND the claim
      // line are descendants of the link, so a click anywhere on the card follows
      // it (not just on the name).
      expect(link!.querySelector('.member-name')).toBeTruthy();
      expect(link!.querySelector('.member-line')?.textContent).toBe(row.querySelector('.member-line')?.textContent);
      // No "You're here" marker on a sibling row.
      expect(row.querySelector('.you-are-here')).toBeNull();
    }
  });

  it('prints each member line as a claim (not a bare name)', () => {
    expect(memberByName('cat21.space')!.querySelector('.member-line')?.textContent)
      .toContain('a meme protocol from the Creator of Ordpool');
    expect(memberByName('ordpool.space')!.querySelector('.member-line')?.textContent)
      .toContain('See inside every Bitcoin block');
  });
});
