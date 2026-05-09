import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';

import {
  OtsLocalStamp,
  OtsStoreService,
  assembleOtsFile,
  base64ToBytes,
  bestCalendarBytes,
} from './ots-store.service';
import { OtsPollerService } from './ots-poller.service';

/*
Test cases:
- One pending stamp: row with 3 spinners, "Check now"/"Cancel" actions.
- Stamp flips to 'ready': row turns green, primary "Download me!" button shows.
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
  private poller = inject(OtsPollerService);
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

  shortHost(uri: string): string {
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

  isStuck(s: OtsLocalStamp): boolean {
    return s.status === 'queued' && Date.now() - s.submittedAt > 6 * 60 * 60 * 1000;
  }

  canClear(s: OtsLocalStamp): boolean {
    return this.store.canClear(s);
  }

  checkNow(stamp: OtsLocalStamp): void {
    this.poller.pokeNow(stamp.id);
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
    const subtrees = stamp.calendars.map(bestCalendarBytes);
    const fileHash = base64ToBytes(this.hexToBase64(stamp.fileHashHex));
    const bytes = assembleOtsFile(fileHash, subtrees);
    const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.opentimestamps' });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = stamp.filename + '.ots';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      // Revoke after a tick so the click has dispatched.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    this.store.update(stamp.id, s => ({
      ...s,
      downloadedAt: Date.now(),
      downloadCount: s.downloadCount + 1,
    }));
  }

  // Convert the stored hex to base64 so we can reuse base64ToBytes.
  private hexToBase64(hex: string): string {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
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
