import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import { Observable, of } from 'rxjs';

import { OrdApiRune, OrdApiService } from '../../../../services/ordinals/ord-api.service';

@Component({
  selector: 'app-runestone-id-to-link',
  templateUrl: './runestone-id-to-link.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RunestoneIdToLinkComponent {

  ordApiService = inject(OrdApiService);

  _block: number | bigint;
  _tx: number;

  runeDetails$: Observable<OrdApiRune | undefined> = of(undefined);

  @Input() showDetails = false;

  @Input()
  public set runeId(id : { block: number | bigint, tx: number} | string | undefined) {

    if (!id) {
      this.runeDetails$ = of(undefined);
      return;
    }

    let block : number | bigint;
    let tx : number;

    if (typeof(id) === 'string') {
      const splitted = id.split(':');
      block = parseInt(splitted[0] , 10);
      tx = parseInt(splitted[1] , 10);
    } else {
      block = id.block;
      tx = id.tx;
    }

    // early exit if setter is called multiple times (don't remove!)
    if (this._block === block && this._tx === tx) {
      return;
    }

    this._block = block;
    this._tx = tx;

    if (this.isUncommonGoods) {
      this.runeDetails$ = of(undefined);
      return;
    }

    this.runeDetails$ = this.ordApiService.getRuneDetails(block, tx);
  }

  get isUncommonGoods() {
    return this._block === 1n && this._tx === 0;
  }
}
