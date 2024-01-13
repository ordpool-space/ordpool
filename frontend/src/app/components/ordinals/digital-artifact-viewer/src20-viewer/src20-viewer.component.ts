import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ParsedSrc20 } from 'ordpool-parser';

/**
 * Test cases:
 * http://localhost:4200/tx/50aeb77245a9483a5b077e4e7506c331dc2f628c22046e7d2b4c6ad6c6236ae1
 * http://localhost:4200/tx/5ba7f995341b9eb70c0cec4f893912f1d853d25d43ade4d3d7739d43bda85a87
 * http://localhost:4200/tx/bca22c3f97de8ff26979f2a2ce188dc19300881ac1721843d0850956e3be95eb
 */
@Component({
  selector: 'app-src20-viewer',
  templateUrl: './src20-viewer.component.html',
  styleUrls: ['./src20-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Src20ViewerComponent {

  private _lastSrc20: ParsedSrc20 | undefined;
  public json: string | undefined = undefined;

  @Input() showDetails = false;

  @Input()
  public set parsedSrc20(src20: ParsedSrc20 | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._lastSrc20?.uniqueId === src20?.uniqueId) {
      return;
    }

    this._lastSrc20 = src20;

    if (src20) {
      this.json = src20.getContent();
      return;
    }

    this.json = undefined;
  }
}
