import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { Cenotaph, ParsedRunestone, RunestoneSpec } from 'ordpool-parser';
import { OrdApiRune, OrdApiService } from '../../../../services/ordinals/ord-api.service';
import { Observable, shareReplay } from 'rxjs';

/**
 * Test cases:
 * http://localhost:4200/tx/2bb85f4b004be6da54f766c17c1e855187327112c231ef2ff35ebad0ea67c69e (etching Z•Z•Z•Z•Z•FEHU•Z•Z•Z•Z•Z)
 * http://localhost:4200/tx/795e09306dba134150142801f92e66dbd44cfad304b0a0688578160a300352ee (edicts of 13x 75 NOR•MOONRUNNERS)
 * http://localhost:4200/tx/1af2a846befbfac4091bf540adad4fd1a86604c26c004066077d5fe22510e99b (dog airdrop)
 * http://localhost:4200/tx/7f4c516ca5b7b2b747bb04e0bd50aef2e8c4c34d78e681be40c5d93c9d635972 (mint UNCOMMON•GOODS)
 * http://localhost:4200/tx/e59cc3f24abd61c0b6ec97cbde001e6da859409644c8ed64027512ed5f61329e (mint THE•PONZI•CHANNEL)
 * http://localhost:4200/tx/1ec45028e1f3b3ee82644cd6bbaf3f7966d85c8e6fe7c20b829d5c3633333ae6 (mint GRAYSCALE•RUNE)
 * http://localhost:4200/tx/b3205ea418e67fb5a9b80bb14956e7566751903fb7fc6b36af55429af9681d0e (pointer)
 * http://localhost:4200/tx/25d919c2f02c00ef26a4d674ac1ecffd92684bce35fc449b7834841fd017a9f9 (1st cenotaph)
 * http://localhost:4200/tx/9327998a4aee68a6792db8b00540976ebf81b32ef3c0fd52a43d4ce1e3c5cf11 (etching COOK•THE•MEMPOOL, with 0 premine but cap 21b)
 * 
 * 
 * More test cases
 * https://ordiscan.com/rune/HOPEYOUGETRICH
 * Starts at Block 840,001
 * Ends at Block 844,609
 * Mint of 100,000 HOPE•YOU•GET•RICH: 
 * https://ordiscan.com/tx/897cb15f5d7633e8daa9d29d8f8b73238668a136394d0c319b8e1f55a279df46
 * -->  * http://localhost:4200/tx/897cb15f5d7633e8daa9d29d8f8b73238668a136394d0c319b8e1f55a279df46

 * 
 * https://ordiscan.com/tx/c7a7cf4c146e48e39b1ab2d235263886d364a225255d421dd61f19538e96e79c
 * 
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

  private runeDetailsMap: Map<string, Observable<OrdApiRune>> = new Map();

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

  isUncommonGoods() {
    return this.runestone?.mint?.block === 1n && this.runestone?.mint?.tx === 0;
  }

  /**
   * Retrieves rune details by block height and transaction number.
   * Caches the result and shares the observable among multiple subscribers.
   * 
   * The observable is cached and shared among subscribers using shareReplay,
   * ensuring that multiple requests for the same rune do not result in multiple API calls.
   *
   * @param block The height of the Bitcoin block.
   * @param tx The number of the transaction within that block.
   * @returns An observable containing the rune details.
   */
  getRuneDetails(block: number | bigint, tx: number): Observable<OrdApiRune> {
    const key = `${block}:${tx}`;
    
    if (this.runeDetailsMap.has(key)) {
      return this.runeDetailsMap.get(key);
    } else {
      const runeDetails$ = this.ordApiService.getRuneById(Number(block), tx).pipe(
        shareReplay({
          refCount: true,
          bufferSize: 1
        })
      );
      this.runeDetailsMap.set(key, runeDetails$);
      return runeDetails$;
    }
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
