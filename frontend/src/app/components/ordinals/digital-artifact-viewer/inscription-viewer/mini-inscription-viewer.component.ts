import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import { InscriptionParserService, ParsedInscription } from 'ordpool-parser';
import { map, Observable, of } from 'rxjs';

import { ElectrsApiService } from '../../../../services/electrs-api.service';


@Component({
  selector: 'app-mini-inscription-viewer',
  templateUrl: './mini-inscription-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MiniInscriptionViewerComponent {

  electrsApiService = inject(ElectrsApiService);

  _inscriptionId: string | undefined;
  _parsedInscription$: Observable<ParsedInscription | undefined>;

  @Input()
  set inscriptionId(id: string | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._inscriptionId === id) {
      return;
    }

    if (!id) {
      this._inscriptionId = undefined;
      this._parsedInscription$ = of(undefined);
      return;
    }

    const txId = id.split('i')[0];

    this._inscriptionId = id;
    this._parsedInscription$ = this.electrsApiService.getTransaction$(txId).pipe(
      map(txn => InscriptionParserService.parse(txn)),
      map(inscriptions => inscriptions.find(x => x.inscriptionId === id))
    );
  }
}
