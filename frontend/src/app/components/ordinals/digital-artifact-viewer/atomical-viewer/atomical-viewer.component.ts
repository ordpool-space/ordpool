import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ParsedAtomical } from 'ordpool-parser';

/**
 * Test cases:
 * http://localhost:4200/tx/1d2f39f54320631d0432fa495a45a4f298a2ca1b18adef8e4356e327d003a694 (etching Z•Z•Z•Z•Z•FEHU•Z•Z•Z•Z•Z)
 */
@Component({
  selector: 'app-atomical-viewer',
  templateUrl: './atomical-viewer.component.html',
  styleUrls: ['./atomical-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AtomicalViewerComponent {

  private _atomical: ParsedAtomical | undefined;

  @Input() showDetails = false;

  @Input()
  public set parsedAtomical(parsedAtomical: ParsedAtomical | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._atomical?.uniqueId === parsedAtomical?.uniqueId) {
      return;
    }

    this._atomical = parsedAtomical;
  }
}
