import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input } from '@angular/core';
import { DecodeFailureReason, InscriptionParserService, InscriptionPreviewService, ParsedInscription } from 'ordpool-parser';
import { map, Observable } from 'rxjs';

import { ElectrsApiService } from '../../../../services/electrs-api.service';

/*
More test cases:

- Batch inscription with pointer: https://ordpool.space/tx/11d3f4b39e8ab97995bab1eacf7dcbf1345ec59c07261c0197e18bf29b88d8da
- Inscriptions on multiple inputs: https://ordpool.space/tx/092111e882a8025f3f05ab791982e8cc7fd7395afe849a5949fd56255b5c41cc
- Content with brotli encoding: https://ordpool.space/tx/6dc2c16a74dedcae46300b2058ebadc7ca78aea78236459662375c8d7d9804db
- Content with gzip encoding: https://ordpool.space/tx/2c0c49fc122d223b7178a74064e59ffaa2db7ce7e541ef5c1a9188064f2f24ab
- Metadata and Metaprotocol: https://ordpool.space/tx/49cbc5cbac92cf917dd4539d62720a3e528d17e22ef5fc47070a17ec0d3cf307
- Multiple Parents: https://ordpool.space/tx/f988fe4b414a3f3d4a815dd1b1675dea0ba6140b1d698d8970273c781fb95746
- Delegatation (basic support): https://ordpool.space/tx/6b6f65ba4bc2cbb8cec1e1ca5e1d426e442a05729cdbac6009cca185f7d95bab
- Complex SVG: https://ordpool.space/tx/77709919918d38c8a89761e3cd300d22ef312948044217327f54e62cc01b47a0
- Decode failure (Content-Encoding: br on a gzip body, block 869,599): https://ordpool.space/tx/5125c1269bd9c4605764fe76d253078d4c35897646004b8fa9837ad41e94a634
*/

@Component({
  selector: 'app-inscription-viewer',
  templateUrl: './inscription-viewer.component.html',
  styleUrls: ['./inscription-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class InscriptionViewerComponent {

  electrsApiService = inject(ElectrsApiService);
  cd = inject(ChangeDetectorRef);

  _parsedInscription: ParsedInscription | undefined;
  delegates: string[] = [];
  delegateInscriptions: {
    inscriptionId: string;
    txId: string;
    allInscriptionsInTheTxn$: Observable<ParsedInscription[]>;
  }[] = [];

  contentTypeInstructions$: Promise<{
    content: string | undefined,
    whatToShow: 'json' | 'code' | 'preview' | 'decode-failure',
    reason?: DecodeFailureReason,
  }> | undefined;

  @Input() showDetails = false;

  @Input()
  set parsedInscription(inscription: ParsedInscription | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._parsedInscription?.uniqueId === inscription?.uniqueId) {
      return;
    }

    this._parsedInscription = inscription;

    if (!inscription) {
      this.contentTypeInstructions$ = undefined;
      return;
    }

    this.delegates = inscription.getDelegates();
    if (this.delegates.length) {

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
    }

    this.contentTypeInstructions$ = InscriptionPreviewService.getContentTypeInstructions(inscription);
  }
}
