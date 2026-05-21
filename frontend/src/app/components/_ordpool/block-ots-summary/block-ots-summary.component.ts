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
 * Self-hides on zero commits or API error -- the summary should never
 * block or clutter the block page.
 */
@Component({
  selector: 'app-block-ots-summary',
  templateUrl: './block-ots-summary.component.html',
  // HACK -- Ordpool: `display: contents` makes the host element transparent
  // to the parent's table layout, so the inner <thead>/<tbody> are treated
  // as direct children of <table>. Without this, the <th colspan="2">
  // shrinks to its text width instead of spanning the full table.
  host: { style: 'display: contents' },
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
