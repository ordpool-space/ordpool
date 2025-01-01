import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CatTraits, ParsedCat21 } from 'ordpool-parser';
import { environment } from 'src/environments/environment';

/**
 * Test cases:
 * http://localhost:4200/tx/98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892
 * http://localhost:4200/tx/90dcf7825be098d1700014f15c6e4b5f99371d61cc7fc40cd5c3ae9228c64290
 * http://localhost:4200/tx/4130bd5520fff85dd98aeb8a3e03895062afb2cfd5215f878a9df835b261980e
 * http://localhost:4200/tx/76448f79c6c90281ec4d15f3a027c48d3a1f72e9de20f4ca3461932384866513
 * http://localhost:4200/tx/499e011170e99189b2fb43bf3de790d10a7ff4c6c855bc9f7986e0db82a19c67
 * http://localhost:4200/tx/7fd952b2723eccdff0f0169931ed7fcf7d7a58581e6affc9209d30060f224a65
 * http://localhost:4200/tx/5ee1320ff65acbe01cb5074ec89deca1220dc30a29c672a6b97a2936b2613f4c
 * http://localhost:4200/tx/917320c3a6a92f0c30e1876c164a1b06f57aae8be3c37aff74d8ec1f1a7da240
 * http://localhost:4200/tx/d2dd3b67658416b27657fdb72d9a19021c1ebe3f797bf659182190c566ee4e57
 * http://localhost:4200/tx/eccac793d22d66a14c3fd6cd5adf5002d1347b503d3fe5171178bd4edf4cf57d
 * http://localhost:4200/tx/dc0628339faf50149bc7fffbb25544328fabc10ee16ac7326e1754f08025d7ca
 * http://localhost:4200/tx/2a6514a04d7b3ea839f177b6aec9418c24262629d885f09fdd83420853c2d7cc
 * http://localhost:4200/tx/5a68ffaea166743b41f8ad02bbb77933e1b29729b338098280574cd7482de87c
 * http://localhost:4200/tx/8145338a41e2b8c8b275f38aa7b5b669f4d22ddf1b627f2632a157fb906104a0
 * http://localhost:4200/tx/bab0ca815cc56a281ff510067984f38236f533e9100d737a9fd28bd12521ac6f
 * http://localhost:4200/tx/6d895bcdb8af42669305f3360b35c403b35064ed7ff3e6845983016adb29af01
 * http://localhost:4200/tx/e8b98486b151fcc4570dbd526f6ef50d5c194e54e248592d04bb092d5c08c430
 * 
 * A large cat:
 * http://localhost:4200/tx/b0d6d810f4b3a6c6f92c2d5f502877f30a7a343f8f937a41985ea1db8bf82f14
 * 
 */
@Component({
  selector: 'app-cat21-viewer',
  templateUrl: './cat21-viewer.component.html',
  styleUrls: ['./cat21-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Cat21ViewerComponent {

  enableCat21Mint = environment.enableCat21Mint;

  private _parsedCat21: ParsedCat21 | undefined;
  svg: string | undefined = undefined;
  traits: CatTraits | undefined | null = undefined;

  @Input() showDetails = false;
  @Input() minimal = false;

  @Input()
  set parsedCat21(cat21: ParsedCat21 | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._parsedCat21?.uniqueId === cat21?.uniqueId) {
      return;
    }

    this._parsedCat21 = cat21;

    if (cat21) {
      this.svg = cat21.getImage();
      this.traits = cat21.getTraits();
      return;
    }

    this.svg = undefined;
    this.traits = undefined;
  }
}
