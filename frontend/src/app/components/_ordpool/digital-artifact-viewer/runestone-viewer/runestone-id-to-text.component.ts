import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import { Observable, of } from 'rxjs';

import { OrdApiRune, OrdApiService } from '../../../../services/ordinals/ord-api.service';

@Component({
  selector: 'app-runestone-id-to-text',
  templateUrl: './runestone-id-to-text.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RunestoneIdToTextComponent {

  zeroWidthSpace = '\u200B';
  runesSpacer = '•';

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

    const { block, tx } = OrdApiService.splitRuneId(id);

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
    return OrdApiService.isUncommonGoods(this._block, this._tx);
  }
}
