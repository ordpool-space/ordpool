import { ChangeDetectionStrategy, Component } from '@angular/core';

/*
Test cases:
- Live page: https://ordpool.space/ots/calendars
- Renders three boxes (you / calendar / bitcoin) on desktop, stacks vertical on mobile.
- Tooltips on each box explain the role in one sentence.
*/

/**
 * Educational diagram for /ots/calendars: shows the three-stage pipeline
 * (your file -> public calendar -> Bitcoin) so the average visitor understands
 * what the drop-zone below is actually doing before they touch it.
 *
 * Pure presentation; no inputs, no state, no signals. The heavy lifting
 * happens in app-ots-stamp-verify.
 */
@Component({
  selector: 'app-ots-diagram',
  templateUrl: './ots-diagram.component.html',
  styleUrls: ['./ots-diagram.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class OtsDiagramComponent { }
