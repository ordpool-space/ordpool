import { ChangeDetectionStrategy, Component, inject, OnDestroy } from '@angular/core';
import { catchError, of, Subject, takeUntil } from 'rxjs';

import {
  OrdpoolApiService,
  OrdpoolOtsCalendarStats,
  OrdpoolOtsRow,
} from '../../../services/ordinals/ordpool-api.service';

/*
Test cases:
- Live dashboard: https://ordpool.space/ots/calendars
*/

/**
 * Per-calendar liveness + recent-commits dashboard at /ots/calendars.
 *
 * Backend feeds:
 *   GET /api/v1/ordpool/ots/calendars  -> per-calendar summary
 *   GET /api/v1/ordpool/ots/recent     -> last N confirmed commits
 *
 * Renders even when one of the two endpoints fails (graceful degradation
 * via catchError → empty observable).
 */
@Component({
  selector: 'app-ots-calendars',
  templateUrl: './ots-calendars.component.html',
  styleUrls: ['./ots-calendars.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class OtsCalendarsComponent implements OnDestroy {

  private api = inject(OrdpoolApiService);
  private destroy$ = new Subject<void>();

  calendars: OrdpoolOtsCalendarStats[] = [];
  recent: OrdpoolOtsRow[] = [];
  calendarsLoaded = false;
  recentLoaded = false;

  constructor() {
    this.api.getOtsCalendars$()
      .pipe(catchError(() => of([] as OrdpoolOtsCalendarStats[])), takeUntil(this.destroy$))
      .subscribe(rows => {
        this.calendars = rows;
        this.calendarsLoaded = true;
      });

    this.api.getOtsRecent$(50)
      .pipe(catchError(() => of([] as OrdpoolOtsRow[])), takeUntil(this.destroy$))
      .subscribe(rows => {
        this.recent = rows;
        this.recentLoaded = true;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
