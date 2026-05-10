import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ParsedSrc101 } from 'ordpool-parser';

/**
 * SRC-101: Bitname domain-name registry on Bitcoin Stamps. JSON payload
 * encoded via OLGA P2WSH. First appeared at block 870,652.
 */
@Component({
  selector: 'app-src101-viewer',
  templateUrl: './src101-viewer.component.html',
  styleUrls: ['./src101-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class Src101ViewerComponent {

  _parsed: ParsedSrc101 | undefined;
  json: string | undefined;

  @Input() showDetails = false;

  @Input()
  set parsedSrc101(p: ParsedSrc101 | undefined) {
    if (this._parsed?.uniqueId === p?.uniqueId) {
      return;
    }
    this._parsed = p;
    this.json = p ? p.getContent() : undefined;
  }
}
