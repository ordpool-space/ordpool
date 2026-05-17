import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import {
  OtsNode,
  assembleOtsFile,
  errString,
  looksLikeOts,
  parseOtsFile,
  sha256Stream,
} from 'ordpool-parser';

import {
  OtsLocalCalendar,
  OtsStoreService,
  bytesToBase64,
  hexEncode,
} from './ots-store.service';
import { OtsCalendarPickerService } from './ots-calendar-picker.service';
import { environment } from 'src/environments/environment';

/*
Test cases:
- Drop a small text file: parallel POST to all configured calendars; a new
  row appears in the pending-queue below; drop-zone resets to idle.
- Drop a corrupt or empty file: shows a clear error message.
- Drop a .ots: rejected with "looks like a receipt, drop it in Verify."
*/

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'queued'; filename: string; calendars: string[] }
  | { kind: 'wrong-zone' }
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-ots-stamp',
  templateUrl: './ots-stamp.component.html',
  styleUrls: ['./ots-stamp.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class OtsStampComponent {

  private cdr = inject(ChangeDetectorRef);
  private store = inject(OtsStoreService);
  private picker = inject(OtsCalendarPickerService);

  status: Status = { kind: 'idle' };
  isDragging = false;
  localStorageAvailable = this.store.localStorageAvailable;

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (!this.isDragging) {
      this.isDragging = true;
      this.cdr.markForCheck();
    }
  }

  onDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragging = false;
    this.cdr.markForCheck();
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragging = false;
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.handleFile(file);
  }

  onPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.handleFile(file);
    input.value = '';
  }

  reset(): void {
    this.status = { kind: 'idle' };
    this.cdr.markForCheck();
  }

  private async handleFile(file: File): Promise<void> {
    try {
      // Peek the first 32 bytes to sniff the OTS magic header without
      // pulling the entire file into memory -- big-file streaming starts here.
      const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
      if (looksLikeOts(head)) {
        // Defensive routing -- a .ots dropped here is almost always a
        // user mistake (they meant Verify). Refuse and route them.
        this.status = { kind: 'wrong-zone' };
        this.cdr.markForCheck();
        return;
      }
      await this.stampFile(file);
    } catch (e) {
      this.status = { kind: 'error', message: errString(e) };
      this.cdr.markForCheck();
    }
  }

  private async stampFile(file: File): Promise<void> {
    this.status = { kind: 'busy', message: 'Hashing your file (stays in your browser)…' };
    this.cdr.markForCheck();

    // Streaming SHA-256 -- never holds more than one Blob chunk in memory,
    // so files of arbitrary size hash without spiking heap or blocking the
    // UI thread. Cross-validated against crypto.subtle.digest in the
    // ordpool-parser test suite.
    const digest = await sha256Stream(file);
    const fileHashHex = hexEncode(digest);

    const known = await this.picker.pick();
    this.status = { kind: 'busy', message: `Submitting to ${known.length} calendars…` };
    this.cdr.markForCheck();

    const now = Date.now();
    const replies = await Promise.allSettled(
      known.map(c => this.postDigestToCalendar(c.url, digest)),
    );

    const calendars: OtsLocalCalendar[] = await Promise.all(
      known.map(async (cal, i) => {
        const r = replies[i];
        if (r.status === 'fulfilled') {
          let commitmentHex = '';
          try {
            const oneCalOts = assembleOtsFile(digest, [r.value]);
            const parsed = await parseOtsFile(oneCalOts);
            commitmentHex = this.findPendingCommitmentHex(parsed.root, cal.url);
          } catch {
            commitmentHex = '';
          }
          return {
            nickname: cal.nickname,
            uri: cal.url,
            pendingBase64: bytesToBase64(r.value),
            commitmentHex,
            upgradedBase64: null,
            lastCheckedAt: now,
            lastResult: commitmentHex ? 'pending' as const : 'error' as const,
            errorMessage: commitmentHex ? null : 'failed to compute commitment',
          };
        }
        return {
          nickname: cal.nickname,
          uri: cal.url,
          pendingBase64: '',
          commitmentHex: '',
          upgradedBase64: null,
          lastCheckedAt: now,
          lastResult: 'error' as const,
          errorMessage: r.reason instanceof Error ? r.reason.message : 'submit failed',
        };
      })
    );

    if (calendars.every(c => !c.pendingBase64)) {
      throw new Error('All calendars rejected the submission. Check your network and try again.');
    }

    this.store.add({
      id: this.uuid(),
      filename: file.name,
      fileHashAlgo: 'sha256',
      fileHashHex,
      submittedAt: now,
      calendars,
      status: 'queued',
      readyAt: null,
      downloadedAt: null,
      downloadCount: 0,
    });

    this.maybeRequestNotificationPermission();

    this.status = {
      kind: 'queued',
      filename: file.name,
      calendars: calendars.filter(c => !!c.pendingBase64).map(c => c.nickname),
    };
    this.cdr.markForCheck();

    setTimeout(() => {
      if (this.status.kind === 'queued' && this.status.filename === file.name) {
        this.reset();
      }
    }, 6000);
  }

  private async postDigestToCalendar(uri: string, digest: Uint8Array): Promise<Uint8Array> {
    // Privacy: we route /digest through the ordpool backend instead of
    // hitting the calendar directly, so the calendar operator sees our
    // backend's IP rather than the user's. The /upgrade poll is already
    // proxied (CORS reason), and verify is fully local; this closes the
    // last hop where the user's IP could leak.
    const apiBase = environment.apiBaseUrl || '';
    const calendarHost = (() => {
      try { return new URL(uri).hostname; } catch { return ''; }
    })();
    const proxyUrl = `${apiBase}/api/v1/ordpool/ots/digest/${calendarHost}`;
    const resp = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: digest as BufferSource,
    });
    if (!resp.ok) throw new Error(uri + ' replied ' + resp.status);
    return new Uint8Array(await resp.arrayBuffer());
  }

  private findPendingCommitmentHex(root: OtsNode, calendarUri: string): string {
    const visit = (node: OtsNode): string => {
      for (const a of node.attestations) {
        if (a.kind === 'pending' && a.uri === calendarUri) return hexEncode(node.msg);
      }
      for (const c of node.children) {
        const r = visit(c.node);
        if (r) return r;
      }
      return '';
    };
    return visit(root);
  }

  private maybeRequestNotificationPermission(): void {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    try { void Notification.requestPermission(); } catch { /* some envs throw */ }
  }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
    return 'ots-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

}
