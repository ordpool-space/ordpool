import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { catchError, of, Subject, takeUntil } from 'rxjs';

import {
  OrdpoolApiService,
  OrdpoolOtsCalendarStats,
  OrdpoolOtsRow,
} from '../../../services/ordinals/ordpool-api.service';
import { SeoService } from '../../../services/seo.service';

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
export class OtsCalendarsComponent implements OnInit, OnDestroy {

  private api = inject(OrdpoolApiService);
  private cdr = inject(ChangeDetectorRef);
  private seo = inject(SeoService);
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
        this.cdr.markForCheck();
      });

    this.api.getOtsRecent$(50)
      .pipe(catchError(() => of([] as OrdpoolOtsRow[])), takeUntil(this.destroy$))
      .subscribe(rows => {
        this.recent = rows;
        this.recentLoaded = true;
        this.cdr.markForCheck();
      });
  }

  ngOnInit(): void {
    this.seo.setTitle('OpenTimestamps');
    this.seo.setDescription(
      'Anchor any file to Bitcoin and verify .ots receipts entirely in your browser. ' +
      'Multi-calendar fan-out, auto-upgrade, no third party in the loop. Free.',
    );
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.seo.resetTitle();
    this.seo.resetDescription();
  }
}
