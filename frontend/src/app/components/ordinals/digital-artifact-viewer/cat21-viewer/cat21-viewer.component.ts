import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CatTraits, ParsedCat21 } from 'ordpool-parser';

/**
 * Test cases:
 * http://localhost:4200/tx/98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892
 * http://localhost:4200/tx/90dcf7825be098d1700014f15c6e4b5f99371d61cc7fc40cd5c3ae9228c64290
 * http://localhost:4200/tx/4130bd5520fff85dd98aeb8a3e03895062afb2cfd5215f878a9df835b261980e
 * http://localhost:4200/tx/76448f79c6c90281ec4d15f3a027c48d3a1f72e9de20f4ca3461932384866513
 */
@Component({
  selector: 'app-cat21-viewer',
  templateUrl: './cat21-viewer.component.html',
  styleUrls: ['./cat21-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Cat21ViewerComponent {

  private _lastCat21: ParsedCat21 | undefined;
  svg: string | undefined = undefined;
  traits: CatTraits | undefined = undefined;

  @Input() showDetails = false;

  @Input()
  set parsedCat21(cat21: ParsedCat21 | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._lastCat21?.uniqueId === cat21?.uniqueId) {
      return;
    }

    this._lastCat21 = cat21;

    if (cat21) {
      this.svg = cat21.getImage();
      this.traits = cat21.getTraits();
      return;
    }

    this.svg = undefined;
    this.traits = undefined;
  }
}
