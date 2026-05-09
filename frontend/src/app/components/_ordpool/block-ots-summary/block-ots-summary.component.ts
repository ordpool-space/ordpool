import { ChangeDetectionStrategy, Component, inject, Input, OnDestroy } from '@angular/core';
import { catchError, of, Subject, switchMap, takeUntil } from 'rxjs';

import { OrdpoolApiService, OrdpoolOtsRow } from '../../../services/ordinals/ordpool-api.service';

/*
Test cases:

- Block 948192 (Alice broadcast 8d8ce7ac...): https://ordpool.space/block/948192
- A regular block with no OTS commits hides the panel entirely.
*/

/**
 * Tiny block-page summary: "N OpenTimestamps commits in this block",
 * with an expandable list of txids + their calendar attribution.
 *
 * Self-hides when the block has zero commits OR the API errors -- the
 * summary should never block / clutter the block page.
 */
@Component({
  selector: 'app-block-ots-summary',
  templateUrl: './block-ots-summary.component.html',
  styleUrls: ['./block-ots-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class BlockOtsSummaryComponent implements OnDestroy {

  private api = inject(OrdpoolApiService);
  private destroy$ = new Subject<void>();
  private height$ = new Subject<number>();

  rows: OrdpoolOtsRow[] = [];
  loaded = false;
  expanded = false;

  @Input()
  set blockHeight(value: number | null | undefined) {
    if (value === null || value === undefined) {
      this.rows = [];
      this.loaded = true;
      return;
    }
    this.loaded = false;
    this.height$.next(value);
  }

  constructor() {
    this.height$.pipe(
      switchMap(h => this.api.getOtsBlock$(h).pipe(catchError(() => of([] as OrdpoolOtsRow[])))),
      takeUntil(this.destroy$),
    ).subscribe(rows => {
      this.rows = rows;
      this.loaded = true;
    });
  }

  toggle(): void {
    this.expanded = !this.expanded;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
