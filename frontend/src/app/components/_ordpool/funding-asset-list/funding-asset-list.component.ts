import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { UtxoAssetDetail } from 'ordpool-sdk';

import { RuneEtchingResolverService } from '../rune-etching-resolver.service';

/** cat21.space's page for one sat: it names every cat on that sat and resolves a rare sat. */
export function cat21SatUrl(sat: number | string): string {
  return `https://cat21.space/sat/${sat}`;
}

/**
 * What a funding coin carries, as the list the funding notice and the funding
 * warning show on /cat21-mint and /inscribe.
 *
 * Every entry carries the identifier its owner recognises and links to where it
 * resolves (FAMILY_UX, "Every flagged row carries the identifier its owner would
 * recognise"), because a notice that does not say what is on the coin informs
 * nobody:
 * - an inscription is its id, linked to the transaction that created it;
 * - a rune is its name, linked to the transaction that etched it once the
 *   etching is resolved, and plain text while it is not, or for a reserved rune
 *   whose etching is all zeros (the resolver never answers those with a txid);
 * - a cat is its inscription id, linked the same way: the asset detail carries
 *   no cat sat, and ordpool's transaction page renders the cat;
 * - a rare sat is its sat number, linked to cat21.space's sat page, because
 *   rarity and block do not identify one: two sats in a block share both.
 *
 * Transaction links are in-app router links; the sat page is external.
 */
@Component({
  selector: 'app-funding-asset-list',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="m-0 mt-1" data-testid="funding-asset-list">
      <li *ngIf="assets().inscriptionIds.length" data-testid="funding-asset-inscriptions">
        Inscription{{ assets().inscriptionIds.length === 1 ? '' : 's' }}:
        <ng-container *ngFor="let id of assets().inscriptionIds; let last = last"><a [routerLink]="['/tx/' | relativeUrl, txidOf(id)]" target="_blank" rel="noopener">{{ id }}</a><ng-container *ngIf="!last">, </ng-container></ng-container>
      </li>
      <li *ngIf="assets().runeNames.length" data-testid="funding-asset-runes">
        Rune{{ assets().runeNames.length === 1 ? '' : 's' }}:
        <ng-container *ngFor="let name of assets().runeNames; let last = last"><a *ngIf="etchingOf(name) as etching; else runePlain" [routerLink]="['/tx/' | relativeUrl, etching]" target="_blank" rel="noopener">{{ name }}</a><ng-template #runePlain>{{ name }}</ng-template><ng-container *ngIf="!last">, </ng-container></ng-container>
      </li>
      <li *ngIf="assets().catIds.length" data-testid="funding-asset-cats">
        CAT-21 cat{{ assets().catIds.length === 1 ? '' : 's' }}:
        <ng-container *ngFor="let id of assets().catIds; let last = last"><a [routerLink]="['/tx/' | relativeUrl, txidOf(id)]" target="_blank" rel="noopener">{{ id }}</a><ng-container *ngIf="!last">, </ng-container></ng-container>
      </li>
      <li *ngIf="assets().rareSat as rareSat" data-testid="funding-asset-rare-sat">
        Rare sat: {{ rareSat.rarity }} · <a [href]="satUrl(rareSat.sat)" target="_blank" rel="noopener">sat {{ rareSat.sat }}</a> · block {{ rareSat.block }}
      </li>
    </ul>
  `,
})
export class FundingAssetListComponent {
  readonly assets = input.required<UtxoAssetDetail>();

  private runeResolver = inject(RuneEtchingResolverService);

  readonly satUrl = cat21SatUrl;

  /** The transaction an inscription id points at: `<64-hex-txid>i<index>` without the index. */
  txidOf(inscriptionId: string): string {
    return inscriptionId.replace(/i\d+$/, '');
  }

  /** The etching txid of a rune, or null while unresolved or for a reserved rune (rendered as plain text). */
  etchingOf(name: string): string | null {
    return this.runeResolver.resolved().get(name) ?? null;
  }
}
