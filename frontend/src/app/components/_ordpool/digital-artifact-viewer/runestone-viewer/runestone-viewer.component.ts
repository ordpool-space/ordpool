import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { Cenotaph, ParsedRunestone, RunestoneSpec } from 'ordpool-parser';
import { OrdApiRune, OrdApiService } from '../../../../services/ordinals/ord-api.service';
import { Observable, shareReplay } from 'rxjs';

/**
 * Test cases:
 * http://localhost:4200/tx/2bb85f4b004be6da54f766c17c1e855187327112c231ef2ff35ebad0ea67c69e (etching Z•Z•Z•Z•Z•FEHU•Z•Z•Z•Z•Z)
 * http://localhost:4200/tx/7923e59abd8f8ab40dcc7915ae864d8b7ad6776811ba4d478f42248a7827a7f3 (etching BITCOIN•WIF•CAT, no terms, no divisibility --> which equals 0)
 * http://localhost:4200/tx/9327998a4aee68a6792db8b00540976ebf81b32ef3c0fd52a43d4ce1e3c5cf11 (etching COOK•THE•MEMPOOL, with 0 premine but cap 21b, with offset height start/end)
 * http://localhost:4200/tx/d66de939cb3ddb4d94f0949612e06e7a84d4d0be381d0220e2903aad68135969 (etching HOPE•YOU•GET•RICH, with height start/end)
 * http://localhost:4200/tx/795e09306dba134150142801f92e66dbd44cfad304b0a0688578160a300352ee (edicts of 13x 75 NOR•MOONRUNNERS)
 * http://localhost:4200/tx/1af2a846befbfac4091bf540adad4fd1a86604c26c004066077d5fe22510e99b (DOG airdrop - uses only a single edict, but a huge amount of outputs)
 * http://localhost:4200/tx/c7a7cf4c146e48e39b1ab2d235263886d364a225255d421dd61f19538e96e79c (EPIC airdrop - uses only a single edict, but a huge amount of outputs)
 * http://localhost:4200/tx/7f4c516ca5b7b2b747bb04e0bd50aef2e8c4c34d78e681be40c5d93c9d635972 (mint UNCOMMON•GOODS)
 * http://localhost:4200/tx/e59cc3f24abd61c0b6ec97cbde001e6da859409644c8ed64027512ed5f61329e (mint THE•PONZI•CHANNEL)
 * http://localhost:4200/tx/1ec45028e1f3b3ee82644cd6bbaf3f7966d85c8e6fe7c20b829d5c3633333ae6 (mint of 1 GRAYSCALE•RUNE width edict)
 * http://localhost:4200/tx/897cb15f5d7633e8daa9d29d8f8b73238668a136394d0c319b8e1f55a279df46 (mint of 100,000 HOPE•YOU•GET•RICH)
 * http://localhost:4200/tx/b3205ea418e67fb5a9b80bb14956e7566751903fb7fc6b36af55429af9681d0e (pointer)
 * http://localhost:4200/tx/25d919c2f02c00ef26a4d674ac1ecffd92684bce35fc449b7834841fd017a9f9 (1st cenotaph)
 * 
 * Edge case, OP_RETURN OP_PUSHNUM_13 OP_PUSHBYTES_1 00 (no real message) 
 * http://localhost:4200/tx/28baf9374797230174803b0c3f63fd39e22bb1972a25cc2af4e791ca8fc89dae
 * 
 * A lot of etchings are here:
 * http://localhost:4200/block/840000
 * 
 * TODO:
 * total supply, must be equal to `premine + terms.cap * terms.amount`
 * 
 * TODO:
 * premine percentage:
 * Decimal { value: ((self.entry.premine as f64 / self.entry.supply() as f64) * 10000.0) as u128, scale: 2 } }}
 */
@Component({
  selector: 'app-runestone-viewer',
  templateUrl: './runestone-viewer.component.html',
  styleUrls: ['./runestone-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RunestoneViewerComponent {

  ordApiService = inject(OrdApiService);

  private _runestone: ParsedRunestone | undefined;
  runestone: RunestoneSpec | undefined = undefined;
  cenotaph: Cenotaph | undefined = undefined;
  transactionId: string | undefined = undefined;

  @Input() showDetails = false;

  @Input()
  public set parsedRunestone(parsedRunestone: ParsedRunestone | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._runestone?.uniqueId === parsedRunestone?.uniqueId) {
      return;
    }

    this._runestone = parsedRunestone;

    if (parsedRunestone) {
      this.runestone = parsedRunestone.runestone;
      this.cenotaph = parsedRunestone.cenotaph;
      this.transactionId = parsedRunestone.transactionId;
      return;
    }

    this.runestone = undefined;
    this.cenotaph = undefined;
    this.transactionId = undefined;
  }

  get isUncommonGoods() {
    return OrdApiService.isUncommonGoods(this.runestone?.mint?.block, this.runestone?.mint?.tx);
  }

  getRuneDetails(block: number | bigint, tx: number): Observable<OrdApiRune> {
    return this.ordApiService.getRuneDetails(block, tx);
  }

  // /**
  //  * Calculates the percentage of two BigInt numbers with fixed-point precision.
  //  * 
  //  * @param numerator - The numerator in BigInt.
  //  * @param denominator - The denominator in BigInt.
  //  * @param scale - The number of decimal places for the result.
  //  * @returns The percentage as a string with the specified number of decimal places.
  //  */
  // calculatePercentage(numerator: bigint, denominator: bigint, scale: number = 2): string {
    
  //   // Handle division by zero case
  //   if (denominator === BigInt(0)) {
  //     throw new Error("Denominator cannot be zero.");
  //   }

  //   const scaleFactor = BigInt(10 ** (scale + 2)); // Increase scale by 2 to preserve precision
  //   const scaledNumerator = numerator * scaleFactor;

  //   // Perform division with BigInt to avoid loss of precision
  //   const result = scaledNumerator / denominator;

  //   // Convert to number for final scaling (safe because the scale limits the size)
  //   let finalResult = Number(result) / 100; // Scale down by 100 to adjust for percentage

  //   // Format the result to the desired decimal places
  //   return finalResult.toFixed(scale);
  // }
}
