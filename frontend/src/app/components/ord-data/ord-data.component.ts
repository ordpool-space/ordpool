import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { Runestone, Etching } from '@app/shared/ord/rune.utils';
import { ParsedInscription } from 'ordpool-parser';

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
  @Input() runestone: Runestone;
  @Input() runeInfo: { [id: string]: { etching: Etching; txid: string } };
  @Input() type: 'vin' | 'vout';

  toNumber = (value: bigint): number => Number(value);

  // Inscriptions
  inscriptionsData: { [key: string]: { count: number, totalSize: number, text?: string; json?: JSON; tag?: string; delegate?: string } };
  // Rune mints
  minted: number;
  // Rune transfers
  transferredRunes: { key: string; etching: Etching; txid: string }[] = [];

  constructor(private ref: ChangeDetectorRef) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.runestone && this.runestone) {
      if (this.runestone.mint && this.runeInfo[this.runestone.mint.toString()]) {
        const mint = this.runestone.mint.toString();
        const terms = this.runeInfo[mint].etching.terms;
        const amount = terms?.amount;
        const divisibility = this.runeInfo[mint].etching.divisibility;
        if (amount) {
          this.minted = this.getAmount(amount, divisibility);
        }
      }

      this.runestone.edicts.forEach(edict => {
        if (this.runeInfo[edict.id.toString()]) {
          this.transferredRunes.push({ key: edict.id.toString(), ...this.runeInfo[edict.id.toString()] });
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

  getAmount(amount: bigint, divisibility: number): number {
    const divisor = BigInt(10) ** BigInt(divisibility);
    const result = amount / divisor;

    return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : Number.MAX_SAFE_INTEGER;
  }
}
