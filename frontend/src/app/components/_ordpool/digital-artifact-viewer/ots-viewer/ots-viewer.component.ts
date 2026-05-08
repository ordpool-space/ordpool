import { ChangeDetectionStrategy, Component, inject, Input, OnDestroy } from '@angular/core';
import { catchError, of, Subject, switchMap, takeUntil } from 'rxjs';

import { OrdpoolApiService, OrdpoolOtsRow } from '../../../../services/ordinals/ordpool-api.service';

/*
Test cases:

- Calendar commit (alice): https://ordpool.space/tx/8d8ce7ac7b68335a040243f31e7e3a2ba8fb82166ca569e7c8b80361b90e8b9f
- Random non-OTS tx (no panel): https://ordpool.space/tx/2bb85f4b004be6da54f766c17c1e855187327112c231ef2ff35ebad0ea67c69e
*/

/**
 * Tiny tx-page panel that renders ONLY when the tx is a known
 * OpenTimestamps calendar commit. Talks to /api/v1/ordpool/ots/tx/:txid;
 * silent on 404 (tx isn't OTS) so the panel disappears for non-OTS txs.
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
  private destroy$ = new Subject<void>();
  private txid$ = new Subject<string>();

  row: OrdpoolOtsRow | null = null;
  loaded = false;

  @Input()
  set txid(value: string | undefined) {
    if (!value) {
      this.row = null;
      this.loaded = true;
      return;
    }
    this.loaded = false;
    this.txid$.next(value);
  }

  constructor() {
    this.txid$.pipe(
      switchMap(txid => this.api.getOtsTx$(txid).pipe(
        catchError(() => of(null)),  // 404 / 5xx → just don't render the panel
      )),
      takeUntil(this.destroy$),
    ).subscribe(row => {
      this.row = row;
      this.loaded = true;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
