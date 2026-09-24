import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { RuneEtchingSpec, runeIdKey } from '@app/services/ord-api.service';

import { ParsedInscription, RunestoneSpec } from 'ordpool-parser';

/** Bodies above this are summarised by size only, never rendered as text. */
const MAX_RENDERED_BODY_SIZE = 100_000;

@Component({
  selector: 'app-ord-data',
  templateUrl: './ord-data.component.html',
  styleUrls: ['./ord-data.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrdDataComponent implements OnChanges {
  @Input() inscriptions: ParsedInscription[];
  @Input() runestone: RunestoneSpec;
  @Input() runeInfo: { [id: string]: { etching: RuneEtchingSpec; txid: string } };
  @Input() type: 'vin' | 'vout';

  toNumber = (value: bigint): number => Number(value);

  // Inscriptions
  inscriptionsData: { [key: string]: { count: number, totalSize: number, text?: string; json?: JSON; tag?: string; delegate?: string } };
  // Rune mints
  minted: number;
  // Rune transfers
  transferredRunes: { key: string; etching: RuneEtchingSpec; txid: string }[] = [];

  constructor(private ref: ChangeDetectorRef) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.runestone && this.runestone) {
      if (this.runestone.mint && this.runeInfo[runeIdKey(this.runestone.mint)]) {
        const mint = runeIdKey(this.runestone.mint);
        const terms = this.runeInfo[mint].etching.terms;
        const amount = terms?.amount;
        const divisibility = this.runeInfo[mint].etching.divisibility;
        if (amount) {
          this.minted = this.getAmount(amount, divisibility);
        }
      }

      this.runestone.edicts?.forEach(edict => {
        const key = runeIdKey(edict.id);
        if (this.runeInfo[key]) {
          this.transferredRunes.push({ key, ...this.runeInfo[key] });
        }
      });
    }

    if (changes.inscriptions && this.inscriptions) {

      if (this.inscriptions?.length) {
        this.inscriptionsData = {};
        this.inscriptions.forEach((inscription) => {
          // General: count, total size, delegate
          const key = inscription.contentType || 'undefined';
          if (!this.inscriptionsData[key]) {
            this.inscriptionsData[key] = { count: 0, totalSize: 0 };
          }
          this.inscriptionsData[key].count++;
          this.inscriptionsData[key].totalSize += inscription.contentSize;

          // the template links the delegate to /tx, so it wants the txid half
          // of the inscription id
          const delegate = inscription.getDelegates()[0];
          if (delegate && !this.inscriptionsData[key].delegate) {
            this.inscriptionsData[key].delegate = delegate.split('i')[0];
          }

          // Text / JSON data. getContent() decompresses brotli and gzip, so a
          // compressed BRC-20 mint now shows its protocol tag too.
          if ((key.includes('text') || key.includes('json'))
            && inscription.contentSize <= MAX_RENDERED_BODY_SIZE
            && !this.inscriptionsData[key].text && !this.inscriptionsData[key].json) {

            inscription.getContent().then((text) => {
              try {
                this.inscriptionsData[key].json = JSON.parse(text);
                if (this.inscriptionsData[key].json['p']) {
                  this.inscriptionsData[key].tag = this.inscriptionsData[key].json['p'].toUpperCase();
                }
              } catch (e) {
                this.inscriptionsData[key].text = text;
              }
              this.ref.markForCheck();
            });
          }
        });
      }
    }
  }

  /** The rune id as the "block:tx" key the runeInfo map uses. */
  runeIdKey = runeIdKey;

  /**
   * ord: supply is premine plus cap times amount (Etching::supply in
   * ord's src/runes/etching.rs). The parser reports the etching fields, not
   * the derived total, so it is computed here.
   */
  supply(etching: RuneEtchingSpec): bigint {
    return (etching?.premine ?? 0n) + (etching?.terms?.cap ?? 0n) * (etching?.terms?.amount ?? 0n);
  }

  getAmount(amount: bigint, divisibility: number): number {
    const divisor = BigInt(10) ** BigInt(divisibility);
    const result = amount / divisor;

    return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : Number.MAX_SAFE_INTEGER;
  }
}
