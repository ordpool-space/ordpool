import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { catchError, of } from 'rxjs';

import { OrdpoolApiService, OrdpoolOtsCalendarStats } from '../../../services/ordinals/ordpool-api.service';

/*
Test cases:
- Live page: https://ordpool.space/ots/calendars
- Renders three boxes (you / calendar / bitcoin) on desktop, stacks vertical on mobile.
- Tooltips on each box explain the role in one sentence.
- The Calendar box is tinted by the freshest calendar's lastBlocktime:
  - <= 6h ago     -> green   (system healthy)
  - <= 24h ago    -> yellow  (slow but not broken)
  - > 24h or null -> red     (calendars are stuck or unreachable)
*/

type CalendarHealth = 'fresh' | 'aging' | 'stale' | 'unknown';

@Component({
  selector: 'app-ots-diagram',
  templateUrl: './ots-diagram.component.html',
  styleUrls: ['./ots-diagram.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class OtsDiagramComponent implements OnInit, OnDestroy {

  private api = inject(OrdpoolApiService);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  health: CalendarHealth = 'unknown';
  freshestNickname = '';
  freshestMinutesAgo: number | null = null;

  ngOnInit(): void {
    this.api.getOtsCalendars$()
      .pipe(catchError(() => of([] as OrdpoolOtsCalendarStats[])), takeUntil(this.destroy$))
      .subscribe(rows => {
        this.computeHealth(rows);
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private computeHealth(rows: OrdpoolOtsCalendarStats[]): void {
    if (!rows || rows.length === 0) {
      this.health = 'unknown';
      return;
    }
    let bestSecs = 0;
    let bestRow: OrdpoolOtsCalendarStats | null = null;
    for (const r of rows) {
      if (typeof r.lastBlocktime === 'number' && r.lastBlocktime > bestSecs) {
        bestSecs = r.lastBlocktime;
        bestRow = r;
      }
    }
    if (!bestRow || !bestSecs) {
      this.health = 'unknown';
      return;
    }
    const ageMs = Date.now() - bestSecs * 1000;
    const ageMin = Math.max(0, Math.round(ageMs / 60000));
    this.freshestMinutesAgo = ageMin;
    this.freshestNickname = bestRow.calendar;
    if (ageMs <= 6 * 60 * 60 * 1000)        this.health = 'fresh';
    else if (ageMs <= 24 * 60 * 60 * 1000)  this.health = 'aging';
    else                                    this.health = 'stale';
  }

  /** Human-readable health string for the tooltip. */
  healthLabel(): string {
    if (this.health === 'unknown') return 'Calendar status: unknown (no data yet).';
    const ago = this.freshestMinutesAgo ?? 0;
    const human =
      ago < 60 ? `${ago} min ago` :
      ago < 24 * 60 ? `${Math.round(ago / 60)} h ago` :
      `${Math.round(ago / (24 * 60))} d ago`;
    const flavour =
      this.health === 'fresh' ? 'system healthy' :
      this.health === 'aging' ? 'slow but not broken' :
      'calendars look stuck';
    return `Most recent calendar publish: ${this.freshestNickname} ${human} (${flavour}).`;
  }
}
