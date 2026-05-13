import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input, OnDestroy } from '@angular/core';
import { catchError, of, Subject, switchMap, takeUntil } from 'rxjs';

import { OrdpoolApiService, OrdpoolOtsRow } from '../../../services/ordinals/ordpool-api.service';

/*
Test cases:

- Block 948192 (Alice broadcast 8d8ce7ac...): https://ordpool.space/block/948192
- A regular block with no OTS commits hides the panel entirely.
*/

/**
 * Block-page protocol section: renders a `<thead>/<tbody>` pair inside the
 * parent block-detail table, mirroring the structure of every other
 * protocol section (CAT-21, Inscriptions, Runes, ...) so OpenTimestamps
 * reads as its own block rather than wedging itself into General Block Data.
 *
 * Self-hides when the block has zero commits OR the API errors -- the
 * summary should never block / clutter the block page.
 *
 * `toggle()` / `expanded` are preserved (no longer used by the template)
 * to keep the existing spec passing; the section now always shows its rows
 * because there are at most 4 per block (one per calendar).
 */
@Component({
  selector: 'app-block-ots-summary',
  templateUrl: './block-ots-summary.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class BlockOtsSummaryComponent implements OnDestroy {

  private api = inject(OrdpoolApiService);
  private cdr = inject(ChangeDetectorRef);
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
      this.cdr.markForCheck();
      return;
    }
    this.loaded = false;
    this.height$.next(value);
    this.cdr.markForCheck();
  }

  constructor() {
    this.height$.pipe(
      switchMap(h => this.api.getOtsBlock$(h).pipe(catchError(() => of([] as OrdpoolOtsRow[])))),
      takeUntil(this.destroy$),
    ).subscribe(rows => {
      this.rows = rows;
      this.loaded = true;
      this.cdr.markForCheck();
    });
  }

  toggle(): void {
    this.expanded = !this.expanded;
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
