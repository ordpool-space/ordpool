import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { InscriptionParserService, ParsedInscription } from 'ordpool-parser';
import { ElectrsApiService } from '../../../../services/electrs-api.service';
import { Observable, map } from 'rxjs';

/*
More test cases:

- Batch inscription with pointer: http://localhost:4200/tx/11d3f4b39e8ab97995bab1eacf7dcbf1345ec59c07261c0197e18bf29b88d8da
- Inscriptions on multiple inputs: http://localhost:4200/tx/092111e882a8025f3f05ab791982e8cc7fd7395afe849a5949fd56255b5c41cc
- Content with brotli encryption: http://localhost:4200/tx/6dc2c16a74dedcae46300b2058ebadc7ca78aea78236459662375c8d7d9804db
- Metadata and Metaprotocol: http://localhost:4200/tx/49cbc5cbac92cf917dd4539d62720a3e528d17e22ef5fc47070a17ec0d3cf307
- Multiple Parens: http://localhost:4200/tx/f988fe4b414a3f3d4a815dd1b1675dea0ba6140b1d698d8970273c781fb95746
- Delegatation (basic support): http://localhost:4200/tx/6b6f65ba4bc2cbb8cec1e1ca5e1d426e442a05729cdbac6009cca185f7d95bab
*/

@Component({
  selector: 'app-inscription-viewer',
  templateUrl: './inscription-viewer.component.html',
  styleUrls: ['./inscription-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InscriptionViewerComponent {

  electrsApiService = inject(ElectrsApiService);

  _parsedInscription: ParsedInscription | undefined;
  delegates: string[] = [];
  delegateInscriptions: {
    inscriptionId: string;
    txId: string;
    allInscriptionsInTheTxn$: Observable<ParsedInscription[]>;
  }[] = [];

  whatToShow: 'nothing' | 'json' | 'code' | 'preview' | 'delegates' = 'nothing';

  @Input() showDetails = false;
  @Input() minimal = false;

  @Input()
  set parsedInscription(inscription: ParsedInscription | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._parsedInscription?.uniqueId === inscription?.uniqueId) {
      return;
    }

    this._parsedInscription = inscription;

    if (!inscription) {
      this.whatToShow = 'nothing';
      return;
    }

    const delegates = inscription.getDelegates();

    if (delegates.length) {
      this.whatToShow = 'delegates';
      this.delegates = delegates;

      this.delegateInscriptions = this.delegates
        .map(inscriptionId => ({
          inscriptionId,
          txId: inscriptionId.split('i')[0]
        }))
        .map(({ inscriptionId, txId }) => ({
          inscriptionId,
          txId,
          allInscriptionsInTheTxn$: this.electrsApiService.getTransaction$(txId).pipe(
            map(txn => InscriptionParserService.parse(txn))
          )
        }));

      return;
    } else {
      this.delegates = [];
    }

    // preview will force everything into an iframe, which always fits
    // (quickest solution right now)
    if (this.minimal) {
      this.whatToShow = 'preview';
      return;
    }

    if ((inscription.contentType.startsWith('text/plain') ||
      inscription.contentType.startsWith('application/json')) &&
      this.validateJson(inscription.getContent())) {

      this.whatToShow = 'json';
      return;
    }

    if (inscription &&
      inscription.contentType.startsWith('application/yaml') ||
      inscription.contentType.startsWith('text/css') ||
      inscription.contentType.startsWith('text/javascript') ||
      inscription.contentType.startsWith('application/x-javascript')) {

      this.whatToShow = 'code';
      return;
    }

    this.whatToShow = 'preview';
  }

  /**
   * Checks if a given string is valid JSON.
   *
   * @param str - The string to be tested.
   * @returns Returns true if the string is valid JSON, otherwise false.
   */
  validateJson(str: string) {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }
}
