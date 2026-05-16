import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input, OnDestroy } from '@angular/core';
import { catchError, distinctUntilChanged, of, Subject, switchMap, takeUntil } from 'rxjs';

import { OrdpoolApiService, OrdpoolOtsRow } from '../../../../services/ordinals/ordpool-api.service';
import { OTS_FALLBACK_CALENDARS } from '../../ots-stamp-verify/ots-store.service';

/*
Test cases:

- Calendar commit (alice): https://ordpool.space/tx/8d8ce7ac7b68335a040243f31e7e3a2ba8fb82166ca569e7c8b80361b90e8b9f
- Random non-OTS tx (no panel): https://ordpool.space/tx/2bb85f4b004be6da54f766c17c1e855187327112c231ef2ff35ebad0ea67c69e
*/

/** Static nickname → calendar URL map. The fallback list in
 *  ots-store.service mirrors the backend's ots-calendars.json, so it's
 *  the right source for a stable lookup without a second network round
 *  trip. */
const CALENDAR_URL_BY_NICKNAME = new Map<string, string>(
  OTS_FALLBACK_CALENDARS.map(c => [c.nickname, c.url]),
);

/**
 * Tiny tx-page panel that renders ONLY when the tx is a known
 * OpenTimestamps calendar commit. Talks to /api/v1/ordpool/ots/tx/:txid;
 * silent on null answers so the panel disappears for non-OTS txs.
 */
@Component({
  selector: 'app-ots-viewer',
  templateUrl: './ots-viewer.component.html',
  styleUrls: ['./ots-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class OtsViewerComponent implements OnDestroy {

  private api = inject(OrdpoolApiService);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();
  private txid$ = new Subject<string>();

  row: OrdpoolOtsRow | null = null;
  loaded = false;
  private _txid: string | undefined;
  private _isOtsCommit: boolean | null | undefined = undefined;

  /** When `false`, skip the lookup entirely (strip-fill already
   *  confirmed the tx is NOT an OTS commit). */
  @Input() set isOtsCommit(v: boolean | null | undefined) {
    this._isOtsCommit = v;
    this.maybeLookup();
  }

  @Input() set txid(v: string | undefined) {
    this._txid = v;
    this.maybeLookup();
  }

  private maybeLookup(): void {
    if (!this._txid || this._isOtsCommit === false) {
      this.row = null;
      this.loaded = true;
      this.cdr.markForCheck();
      return;
    }
    this.loaded = false;
    this.txid$.next(this._txid);
    this.cdr.markForCheck();
  }

  constructor() {
    this.txid$.pipe(
      distinctUntilChanged(),
      switchMap(txid => this.api.getOtsTx$(txid).pipe(
        catchError(() => of(null)),
      )),
      takeUntil(this.destroy$),
    ).subscribe(row => {
      this.row = row;
      this.loaded = true;
      this.cdr.markForCheck();
    });
  }

  /** Public homepage URL of the calendar that broadcast this commit
   *  (e.g., `https://bob.btc.calendar.opentimestamps.org`), or null
   *  when we don't recognise the nickname. */
  get calendarUrl(): string | null {
    return this.row ? (CALENDAR_URL_BY_NICKNAME.get(this.row.calendar) ?? null) : null;
  }

  /** Human-readable elapsed time between `firstSeenAt` (mempool entry)
   *  and `confirmedAt` (block landing). Returns null for unconfirmed
   *  commits. Format: "1d 4h" / "23m 7s" / "42s". */
  get confirmationLatency(): string | null {
    if (!this.row?.firstSeenAt || !this.row?.confirmedAt) return null;
    const ms = new Date(this.row.confirmedAt).getTime() - new Date(this.row.firstSeenAt).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${sec % 60}s`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ${min % 60}m`;
    const day = Math.floor(hr / 24);
    return `${day}d ${hr % 24}h`;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
