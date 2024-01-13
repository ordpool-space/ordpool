import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ParsedInscription } from 'ordpool-parser';

/*
More test cases:

- Batch inscription with pointer: http://localhost:4200/tx/11d3f4b39e8ab97995bab1eacf7dcbf1345ec59c07261c0197e18bf29b88d8da
- Inscriptions on multiple inputs: http://localhost:4200/tx/092111e882a8025f3f05ab791982e8cc7fd7395afe849a5949fd56255b5c41cc
- Content with brotli encryption: http://localhost:4200/tx/6dc2c16a74dedcae46300b2058ebadc7ca78aea78236459662375c8d7d9804db
- Metadata and Metaprotocol: http://localhost:4200/tx/49cbc5cbac92cf917dd4539d62720a3e528d17e22ef5fc47070a17ec0d3cf307
*/

@Component({
  selector: 'app-inscription-viewer',
  templateUrl: './inscription-viewer.component.html',
  styleUrls: ['./inscription-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InscriptionViewerComponent {

  _parsedInscription: ParsedInscription | undefined;
  private _lastParsedInscription: ParsedInscription | undefined;

  whatToShow: 'nothing' | 'json' | 'code' | 'preview' = 'nothing';

  @Input() showDetails = false;

  @Input()
  set parsedInscription(inscription: ParsedInscription | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._lastParsedInscription?.uniqueId === inscription?.uniqueId) {
      return;
    }

    this._parsedInscription = inscription;
    this._lastParsedInscription = inscription;

    if (!inscription) {
      this.whatToShow = 'nothing';
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
