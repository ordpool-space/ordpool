import { CommonModule } from '@angular/common';
import { Pipe, PipeTransform, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { UtxoAssetDetail } from 'ordpool-sdk';

import { RuneEtchingResolverService } from '../rune-etching-resolver.service';
import { FundingAssetListComponent, cat21SatUrl } from './funding-asset-list.component';

/** mempool's router-prefix pipe; identity here, the list only reads the link target. */
@Pipe({ name: 'relativeUrl', standalone: false })
class RelativeUrlStubPipe implements PipeTransform {
  transform(url: string): string { return url; }
}

const INSCRIPTION = 'a'.repeat(64) + 'i0';
const CAT = 'c'.repeat(64) + 'i0';
const ETCHED = 'DOG•GO•TO•THE•MOON';
const ETCHING_TXID = 'e'.repeat(64);
/** A reserved rune: its etching is all zeros, so the resolver records null and it is never linked. */
const RESERVED = 'UNCOMMON•GOODS';
/** A rune the resolver has no answer for yet. */
const UNRESOLVED = 'NOT•ASKED•YET';

describe('FundingAssetListComponent', () => {
  let fixture: ComponentFixture<FundingAssetListComponent>;

  function render(assets: UtxoAssetDetail): HTMLElement {
    fixture.componentRef.setInput('assets', assets);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const item = (root: HTMLElement, id: string): HTMLElement | null => root.querySelector(`[data-testid="${id}"]`);
  const links = (el: HTMLElement | null): { text: string; href: string | null; target: string | null; rel: string | null }[] =>
    Array.from(el?.querySelectorAll('a') ?? []).map((a) => ({
      text: (a.textContent ?? '').trim(), href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'),
    }));

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [FundingAssetListComponent, RelativeUrlStubPipe],
      imports: [CommonModule, RouterModule.forRoot([])],
      providers: [{
        provide: RuneEtchingResolverService,
        useValue: { resolved: signal<ReadonlyMap<string, string | null>>(new Map([[ETCHED, ETCHING_TXID], [RESERVED, null]])) },
      }],
    });
    fixture = TestBed.createComponent(FundingAssetListComponent);
  });

  it('links an inscription to the transaction that created it', () => {
    const root = render({ inscriptionIds: [INSCRIPTION], runeNames: [], catIds: [], rareSat: null });
    expect(links(item(root, 'funding-asset-inscriptions'))).toEqual([
      { text: INSCRIPTION, href: '/tx/' + 'a'.repeat(64), target: '_blank', rel: 'noopener' },
    ]);
  });

  it('links a rune to its etching once resolved, and leaves a reserved or unresolved rune as plain text', () => {
    const root = render({ inscriptionIds: [], runeNames: [ETCHED, RESERVED, UNRESOLVED], catIds: [], rareSat: null });
    const runes = item(root, 'funding-asset-runes');
    expect(links(runes)).toEqual([{ text: ETCHED, href: '/tx/' + ETCHING_TXID, target: '_blank', rel: 'noopener' }]);
    expect((runes?.textContent ?? '').replace(/\s+/g, ' ')).toContain(`${ETCHED}, ${RESERVED}, ${UNRESOLVED}`);
  });

  it('links a cat to the transaction of its inscription id', () => {
    const root = render({ inscriptionIds: [], runeNames: [], catIds: [CAT], rareSat: null });
    expect(links(item(root, 'funding-asset-cats'))).toEqual([
      { text: CAT, href: '/tx/' + 'c'.repeat(64), target: '_blank', rel: 'noopener' },
    ]);
  });

  it('names a rare sat by its sat number, linked to its cat21.space sat page, with rarity and block', () => {
    const root = render({ inscriptionIds: [], runeNames: [], catIds: [], rareSat: { sat: '1050000000000000', block: 210000, rarity: 'uncommon' } });
    const rare = item(root, 'funding-asset-rare-sat');
    expect(links(rare)).toEqual([
      { text: 'sat 1050000000000000', href: 'https://cat21.space/sat/1050000000000000', target: '_blank', rel: 'noopener' },
    ]);
    expect((rare?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe('Rare sat: uncommon · sat 1050000000000000 · block 210000');
  });

  it('renders only the kinds the coin carries', () => {
    const root = render({ inscriptionIds: [INSCRIPTION], runeNames: [], catIds: [], rareSat: null });
    expect(item(root, 'funding-asset-runes')).toBeNull();
    expect(item(root, 'funding-asset-cats')).toBeNull();
    expect(item(root, 'funding-asset-rare-sat')).toBeNull();
  });

  it('cat21SatUrl is the cat21.space sat page', () => {
    expect(cat21SatUrl(1971987)).toBe('https://cat21.space/sat/1971987');
  });
});
