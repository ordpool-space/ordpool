// Mock the SDK barrel to the family constants only. Importing the real
// 'ordpool-sdk' entry pulls the sats-connect ESM chain jsdom can't load; the
// component only needs the three family exports, so we stand them in with the
// SAME SHAPE the SDK ships (verified against src/family/ordpool-family.ts).
jest.mock('ordpool-sdk', () => ({
  ORDPOOL_FAMILY_HEADING: 'The Ordpool family',
  ORDPOOL_FAMILY_LEDE:
    'Sometimes Bitcoin is hard money. Sometimes Bitcoin is a JPEG. We render both, '
    + 'and everything here checks what a coin is carrying before it spends it.',
  ORDPOOL_FAMILY: [
    { key: 'ordpool', name: 'ordpool.space', url: 'https://ordpool.space', line: 'The best MEMEpool explorer on Bitcoin.' },
    { key: 'cat21', name: 'cat21.space', url: 'https://cat21.space', line: 'Everything CAT-21, a meme protocol from the Creator of Ordpool.' },
    { key: 'cubes', name: 'cubes.haushoppe.art', url: 'https://cubes.haushoppe.art', line: 'Everything cubes, an art project from the Creator of Ordpool.' },
    { key: 'wallet', name: 'Cat21 Wallet', url: 'https://github.com/ordpool-space/cat21-wallet', line: 'A hot wallet for high frequency trading of CAT-21, made for AI agents and their humans.' },
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

  it('renders the heading and the lede from the SDK', () => {
    expect(el.querySelector('.family-heading')?.textContent).toContain('The Ordpool family');
    expect(el.querySelector('.family-lede')?.textContent)
      .toContain('everything here checks what a coin is carrying before it spends it');
  });

  it('renders every one of the four family members, including this site', () => {
    expect(members().length).toBe(4);
    for (const name of ['ordpool.space', 'cat21.space', 'cubes.haushoppe.art', 'Cat21 Wallet']) {
      expect(memberByName(name)).toBeTruthy();
    }
  });

  it('marks ONLY ordpool as the current row: no link, a "You’re here" marker', () => {
    const own = memberByName('ordpool.space')!;
    expect(own.classList).toContain('is-current');
    // The current row is a span, not an anchor, so it is not a link to itself.
    expect(own.querySelector('a.member-name')).toBeNull();
    expect(own.querySelector('span.member-name')).toBeTruthy();
    expect(own.querySelector('.you-are-here')?.textContent).toContain('here');
  });

  it('renders the other three members as external links to their url, and NOT as current', () => {
    for (const { name, url } of [
      { name: 'cat21.space', url: 'https://cat21.space' },
      { name: 'cubes.haushoppe.art', url: 'https://cubes.haushoppe.art' },
      { name: 'Cat21 Wallet', url: 'https://github.com/ordpool-space/cat21-wallet' },
    ]) {
      const row = memberByName(name)!;
      expect(row.classList).not.toContain('is-current');
      const link = row.querySelector('a.member-name') as HTMLAnchorElement | null;
      expect(link).toBeTruthy();
      expect(link!.getAttribute('href')).toBe(url);
      expect(link!.getAttribute('target')).toBe('_blank');
      expect(link!.getAttribute('rel')).toContain('noopener');
      // No "You're here" marker on a sibling row.
      expect(row.querySelector('.you-are-here')).toBeNull();
    }
  });

  it('prints each member line as a claim (not a bare name)', () => {
    expect(memberByName('cat21.space')!.querySelector('.member-line')?.textContent)
      .toContain('a meme protocol from the Creator of Ordpool');
    expect(memberByName('ordpool.space')!.querySelector('.member-line')?.textContent)
      .toContain('The best MEMEpool explorer on Bitcoin');
  });
});
