import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';

import { assembleOtsFile } from 'ordpool-parser';

import {
  OtsLocalStamp,
  OtsStoreService,
  base64ToBytes,
  bestCalendarBytes,
} from './ots-store.service';

/*
Test cases:
- One pending stamp: row with 3 spinners, "Cancel & forget" action.
- Stamp flips to 'ready': row turns green, primary "Download .ots file" button shows.
- After download: button calms, "Clear this entry" appears.
- Two pending stamps: both rows visible, polling advances both.
- 'failed' stamp (48h): row greyed, "Re-stamp" / "Cancel & forget" actions.
*/

@Component({
  selector: 'app-ots-pending-queue',
  templateUrl: './ots-pending-queue.component.html',
  styleUrls: ['./ots-pending-queue.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class OtsPendingQueueComponent implements OnInit, OnDestroy {

  private store = inject(OtsStoreService);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  stamps: OtsLocalStamp[] = [];

  ngOnInit(): void {
    this.store.stamps$()
      .pipe(takeUntil(this.destroy$))
      .subscribe(s => {
        this.stamps = s;
        this.updateTabTitle(s);
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.resetTabTitle();
  }

  /** Legacy helper kept for any old localStorage row that pre-dates the
   *  nickname field; new rows always carry `nickname` directly. */
  private shortHost(uri: string): string {
    try { return new URL(uri).hostname.split('.')[0]; }
    catch { return uri; }
  }

  calendarStatusLabel(c: OtsLocalStamp['calendars'][number]): string {
    if (c.upgradedBase64) return 'published';
    if (c.lastResult === 'never-checked') return 'queued';
    if (c.lastResult === 'pending') return 'still pending';
    if (c.lastResult === 'error') return c.errorMessage ?? 'error';
    return 'queued';
  }

  readyCount(s: OtsLocalStamp): number {
    return s.calendars.filter(c => !!c.upgradedBase64).length;
  }

  pendingHosts(s: OtsLocalStamp): string {
    return s.calendars
      .filter(c => !c.upgradedBase64)
      .map(c => c.nickname || this.shortHost(c.uri))
      .join(', ');
  }

  isStuck(s: OtsLocalStamp): boolean {
    return s.status === 'queued' && Date.now() - s.submittedAt > 6 * 60 * 60 * 1000;
  }

  canClear(s: OtsLocalStamp): boolean {
    return this.store.canClear(s);
  }

  cancel(stamp: OtsLocalStamp): void {
    if (!confirm(`Forget the pending stamp for "${stamp.filename}"? This cannot be undone.`)) return;
    this.store.remove(stamp.id);
  }

  clear(stamp: OtsLocalStamp): void {
    if (!this.canClear(stamp)) return;
    if (!confirm(`Clear "${stamp.filename}" from this list? Make sure you've saved the .ots file somewhere safe -- once cleared, the row is gone.`)) return;
    this.store.remove(stamp.id);
  }

  download(stamp: OtsLocalStamp): void {
    const subtrees = stamp.calendars
      .map(bestCalendarBytes)
      .filter(b => b.length > 0);
    if (subtrees.length === 0) return;
    const fileHash = this.hexToBytes(stamp.fileHashHex);
    const bytes = assembleOtsFile(fileHash, subtrees);
    this.triggerDownload(bytes, stamp.filename + '.ots');
    this.store.update(stamp.id, s => ({
      ...s,
      downloadedAt: Date.now(),
      downloadCount: s.downloadCount + 1,
    }));
  }

  /** Power-user export: every calendar's raw pending body, no upgrades. */
  downloadPendingRaw(stamp: OtsLocalStamp): void {
    const subtrees = stamp.calendars
      .filter(c => !!c.pendingBase64)
      .map(c => base64ToBytes(c.pendingBase64));
    if (subtrees.length === 0) return;
    const fileHash = this.hexToBytes(stamp.fileHashHex);
    const bytes = assembleOtsFile(fileHash, subtrees);
    this.triggerDownload(bytes, stamp.filename + '.pending.ots');
  }

  private triggerDownload(bytes: Uint8Array, filename: string): void {
    const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.opentimestamps' });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  private hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  private updateTabTitle(stamps: OtsLocalStamp[]): void {
    if (typeof document === 'undefined') return;
    const queued = stamps.filter(s => s.status === 'queued').length;
    const ready  = stamps.filter(s => s.status === 'ready' && s.downloadCount === 0).length;
    const base = (document.title || 'mempool - Bitcoin Explorer').replace(/^\([^)]+\)\s*/, '');
    if (ready > 0) {
      document.title = `(${ready} stamp${ready === 1 ? '' : 's'} ready) ` + base;
    } else if (queued > 0) {
      document.title = `(${queued} stamp${queued === 1 ? '' : 's'} pending) ` + base;
    } else {
      document.title = base;
    }
  }

  private resetTabTitle(): void {
    if (typeof document === 'undefined') return;
    document.title = (document.title || '').replace(/^\([^)]+\)\s*/, '');
  }
}
