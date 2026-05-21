import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input } from '@angular/core';
import { DecodeFailureReason, InscriptionParserService, InscriptionPreviewService, InscriptionProperties, parseBitmapHeight, ParsedInscription } from 'ordpool-parser';
import { catchError, from, map, Observable, of, shareReplay } from 'rxjs';

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
- Bitmap claim ("0.bitmap" -- genesis block, 1 tx): https://ordpool.space/tx/86539aff946c437af8088955827b7e6ff48fc6192836d4071b697b5359b7a732
- Bitmap claim ("210000.bitmap" -- 1st halving, 457 txs): https://ordpool.space/tx/b8505f82e5ba0f7179f8d05213e631b375815c1af820eed9d6a34b48e1b13104
- Bitmap claim ("840000.bitmap" -- 4th halving, 3050 txs): https://ordpool.space/tx/05f8584cf4dbe34ef677f8f316fcac9e6e4ccb0e298d53fd21edaac7787660ee
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

  // Tag 15 (note): free-form string attached to the inscription. The
  // reference indexer stores it but doesn't display it; we surface it on
  // the detail page.
  note: string | undefined;

  // Tag 13 (rune commitment): little-endian bytes of a rune's u128 value.
  // Displayed as hex; explained in a tooltip rather than turned into the
  // human-readable rune name, because mapping bytes -> name requires the
  // etching tx (which our parser can't cheaply find from the inscription
  // side alone). Hex is the honest minimum.
  runeCommitmentHex: string | undefined;

  // Tag 17 (properties): galleries + inscription-level title + traits.
  // Resolved async; properties may be compressed (tag 19) so the parser's
  // getProperties is also async.
  properties$: Promise<InscriptionProperties | undefined> | undefined;

  // Gallery pager. Galleries are unbounded in the protocol -- the wild has
  // 10k-item PFP collections in a single gallery. Rendering all <li> rows
  // at once stalls the tx page. Same ngb-pagination pattern as the multi-
  // artifact pager on transaction.component.html.
  galleryPage = 1;
  readonly GALLERY_PAGE_SIZE = 20;

  // Bitmap claim height parsed from inscription text content. Drives the
  // side-by-side layout (preview left, bitmap render right) and the
  // bitmap-viewer's API call. Null when content isn't a `.bitmap` claim.
  bitmapHeight$: Observable<number | null> = of(null);

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
      this.note = undefined;
      this.runeCommitmentHex = undefined;
      this.properties$ = undefined;
      this.bitmapHeight$ = of(null);
      return;
    }

    this.bitmapHeight$ = from(inscription.getContent()).pipe(
      map(content => parseBitmapHeight(content ?? '')),
      catchError(() => of(null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.note = inscription.getNote();

    const rune = inscription.getRune();
    this.runeCommitmentHex = rune ? bytesToHex(rune) : undefined;

    this.properties$ = inscription.getProperties();
    this.galleryPage = 1;

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

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}
