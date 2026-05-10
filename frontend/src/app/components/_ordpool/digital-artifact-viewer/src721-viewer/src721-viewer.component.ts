import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ParsedSrc721 } from 'ordpool-parser';

/**
 * SRC-721: composable layered NFTs on Bitcoin Stamps. Payload is a JSON
 * envelope referencing other stamps by ID. Render the JSON; an actual
 * composed-image renderer would need to recursively fetch the referenced
 * stamps -- out of scope for the basic viewer.
 */
@Component({
  selector: 'app-src721-viewer',
  templateUrl: './src721-viewer.component.html',
  styleUrls: ['./src721-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class Src721ViewerComponent {

  _parsed: ParsedSrc721 | undefined;
  json: string | undefined;

  @Input() showDetails = false;

  @Input()
  set parsedSrc721(p: ParsedSrc721 | undefined) {
    if (this._parsed?.uniqueId === p?.uniqueId) {
      return;
    }
    this._parsed = p;
    this.json = p ? p.getContent() : undefined;
  }
}
