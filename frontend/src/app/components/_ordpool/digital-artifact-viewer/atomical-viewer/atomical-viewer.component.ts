import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ATOMICAL_OPERATION_LABELS, AtomicalFile, AtomicalOperation, ParsedAtomical } from 'ordpool-parser';

/**
 * Test cases:
 * https://ordpool.space/tx/1d2f39f54320631d0432fa495a45a4f298a2ca1b18adef8e4356e327d003a694 (dft "atom")
 * https://ordpool.space/tx/d8c96e3920f15dfbca4bcb3a3b2fce214484cb913fdca3055dd0f7069387edd3 (nft realm "terafab")
 * https://ordpool.space/tx/7c8527547cc99b39f9d02fa2e8d963d78a3d60692a05ad378a87b96abed4aab6 (nft toothy #7579, with embedded PNG)
 * https://ordpool.space/tx/5390e86df98982122175e18a7f24a1618d14e50e0b2242c7ca2c27730ffad700 (dmt mint of "atom")
 * https://ordpool.space/tx/329a9fae404e4ca014b975dbcc7cb5267f47cccd2851a45ffa06c70744ae12cd (splat / x)
 * https://ordpool.space/tx/054cc18a8162887917a1e6e5c60389bb4b6647167e6936d231466d7b2710f413 (split / y)
 * https://ordpool.space/tx/914a3f3575a1da92035a57bd758da8588fd11776927ab880915f97e66612f773 (custom-color / z)
 */
@Component({
  selector: 'app-atomical-viewer',
  templateUrl: './atomical-viewer.component.html',
  styleUrls: ['./atomical-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [DecimalPipe],
})
export class AtomicalViewerComponent {

  _atomical: ParsedAtomical | undefined;
  operation: AtomicalOperation | undefined;
  operationLabel = '';
  argEntries: { key: string; value: string }[] = [];
  files: AtomicalFile[] = [];
  filePreviews: { file: AtomicalFile; isImage: boolean; dataUri: string | undefined }[] = [];
  payloadSize = 0;

  @Input() showDetails = false;

  @Input()
  set parsedAtomical(parsedAtomical: ParsedAtomical | undefined) {
    if (this._atomical?.uniqueId === parsedAtomical?.uniqueId) {
      return;
    }
    this._atomical = parsedAtomical;
    if (!parsedAtomical) {
      this.operation = undefined;
      this.operationLabel = '';
      this.argEntries = [];
      this.files = [];
      this.filePreviews = [];
      this.payloadSize = 0;
      return;
    }
    this.operation = parsedAtomical.operation;
    this.operationLabel = ATOMICAL_OPERATION_LABELS[parsedAtomical.operation] ?? parsedAtomical.operation;
    this.payloadSize = parsedAtomical.getPayloadRaw().length;

    const args = parsedAtomical.getArgs();
    this.argEntries = args
      ? Object.entries(args).map(([key, value]) => ({ key, value: formatArgValue(value) }))
      : [];

    this.files = parsedAtomical.getFiles();
    this.filePreviews = this.files.map(file => {
      const isImage = file.contentType.startsWith('image/');
      return { file, isImage, dataUri: isImage ? file.getDataUri() : undefined };
    });
  }
}

function formatArgValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  // Uint8Array / objects: stringify as JSON. Show byte arrays as hex preview.
  if (value instanceof Uint8Array) {
    const preview = Array.from(value.slice(0, 32))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return value.length <= 32 ? preview : `${preview}... (${value.length} bytes)`;
  }
  try { return JSON.stringify(value); } catch { return String(value); }
}
