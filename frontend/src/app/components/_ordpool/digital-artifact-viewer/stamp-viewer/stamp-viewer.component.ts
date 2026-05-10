import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ParsedStamp } from 'ordpool-parser';

/**
 * Test cases:
 * https://ordpool.space/tx/50aeb77245a9483a5b077e4e7506c331dc2f628c22046e7d2b4c6ad6c6236ae1
 *   (pre-OLGA stamps appear as Counterparty issuance; the Stamp parser
 *    only fires for OLGA / P2WSH-encoded stamps from block 833000+)
 */
@Component({
  selector: 'app-stamp-viewer',
  templateUrl: './stamp-viewer.component.html',
  styleUrls: ['./stamp-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class StampViewerComponent {

  _parsed: ParsedStamp | undefined;
  dataUri: string | undefined;
  text: string | undefined;
  fileSize = 0;

  @Input() showDetails = false;

  @Input()
  set parsedStamp(p: ParsedStamp | undefined) {
    if (this._parsed?.uniqueId === p?.uniqueId) {
      return;
    }
    this._parsed = p;
    if (!p) {
      this.dataUri = undefined;
      this.text = undefined;
      this.fileSize = 0;
      return;
    }
    this.fileSize = p.getDataRaw().length;
    if (this.isText) {
      this.text = p.getContent();
      this.dataUri = undefined;
    } else {
      this.dataUri = p.getDataUri();
      this.text = undefined;
    }
  }

  get isImage(): boolean {
    return !!this._parsed?.contentType?.startsWith('image/');
  }

  get isText(): boolean {
    const ct = this._parsed?.contentType ?? '';
    return ct.startsWith('text/') || ct === 'image/svg+xml';
  }
}
