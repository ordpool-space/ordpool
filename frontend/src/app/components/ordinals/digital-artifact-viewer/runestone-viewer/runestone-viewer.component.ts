import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { Cenotaph, ParsedRunestone, RunestoneSpec } from 'ordpool-parser';
import { OrdApiService } from '../../../../services/ordinals/ord-api.service';

/**
 * Test cases:
 * http://localhost:4200/tx/2bb85f4b004be6da54f766c17c1e855187327112c231ef2ff35ebad0ea67c69e (etching Z•Z•Z•Z•Z•FEHU•Z•Z•Z•Z•Z)
 * http://localhost:4200/tx/795e09306dba134150142801f92e66dbd44cfad304b0a0688578160a300352ee (edicts)
 * http://localhost:4200/tx/1af2a846befbfac4091bf540adad4fd1a86604c26c004066077d5fe22510e99b (dog airdrop)
 * http://localhost:4200/tx/7f4c516ca5b7b2b747bb04e0bd50aef2e8c4c34d78e681be40c5d93c9d635972 (mint UNCOMMON•GOODS)
 * http://localhost:4200/tx/e59cc3f24abd61c0b6ec97cbde001e6da859409644c8ed64027512ed5f61329e (mint THE•PONZI•CHANNEL)
 * http://localhost:4200/tx/1ec45028e1f3b3ee82644cd6bbaf3f7966d85c8e6fe7c20b829d5c3633333ae6 (mint GRAYSCALE•RUNE)
 * http://localhost:4200/tx/b3205ea418e67fb5a9b80bb14956e7566751903fb7fc6b36af55429af9681d0e (pointer)
 * http://localhost:4200/tx/25d919c2f02c00ef26a4d674ac1ecffd92684bce35fc449b7834841fd017a9f9 (1st cenotaph)
 * http://localhost:4200/tx/9327998a4aee68a6792db8b00540976ebf81b32ef3c0fd52a43d4ce1e3c5cf11 (etching COOK•THE•MEMPOOL, with 0 premine but cap 21b)
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
      return;
    }

    this.runestone = undefined;
    this.cenotaph = undefined;
  }

  isUncommonGoods() {
    return this.runestone?.mint?.block === 1n && this.runestone?.mint?.tx === 0;
  }
  
  getRuneById$(blockHeight: bigint, transactionNumber: number) {
    return this.ordApiService.getRuneById(Number(blockHeight), transactionNumber);
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
