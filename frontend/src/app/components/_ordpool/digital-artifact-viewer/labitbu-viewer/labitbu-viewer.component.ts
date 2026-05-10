import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ParsedLabitbu } from 'ordpool-parser';

/**
 * Labitbu: 4096-byte WebP image stored in a Taproot witness control block,
 * keyed off a NUMS internal pubkey (SHA-256 of "Labitbu"). The 10,000
 * Labitbus were minted across blocks 908,072-908,196.
 */
@Component({
  selector: 'app-labitbu-viewer',
  templateUrl: './labitbu-viewer.component.html',
  styleUrls: ['./labitbu-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class LabitbuViewerComponent {

  _parsed: ParsedLabitbu | undefined;
  dataUri: string | undefined;
  fileSize = 0;

  @Input() showDetails = false;

  @Input()
  set parsedLabitbu(p: ParsedLabitbu | undefined) {
    if (this._parsed?.uniqueId === p?.uniqueId) {
      return;
    }
    this._parsed = p;
    if (!p) {
      this.dataUri = undefined;
      this.fileSize = 0;
      return;
    }
    this.fileSize = p.getDataRaw().length;
    this.dataUri = p.getDataUri();
  }
}
