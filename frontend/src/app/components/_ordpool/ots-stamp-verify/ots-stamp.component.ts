import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import { OtsNode, parseOtsFile } from 'ordpool-parser';

import {
  OtsLocalCalendar,
  OtsStoreService,
  assembleOtsFile,
  bytesToBase64,
  hexEncode,
} from './ots-store.service';
import { OtsCalendarPickerService } from './ots-calendar-picker.service';

/*
Test cases:
- Drop a small text file: parallel POST to all configured calendars; a new
  row appears in the pending-queue below; drop-zone resets to idle.
- Drop a corrupt or empty file: shows a clear error message.
- Drop a .ots: rejected with "looks like a receipt, drop it in Verify."
*/

const HEADER_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

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
    if (file.size > 100 * 1024 * 1024) {
      this.status = { kind: 'error', message: 'File too large (max 100 MB).' };
      this.cdr.markForCheck();
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (this.looksLikeOts(bytes)) {
        // Defensive routing -- a .ots dropped here is almost always a
        // user mistake (they meant Verify). Refuse and route them.
        this.status = { kind: 'wrong-zone' };
        this.cdr.markForCheck();
        return;
      }
      await this.stampFile(bytes, file.name);
    } catch (e) {
      this.status = { kind: 'error', message: this.errString(e) };
      this.cdr.markForCheck();
    }
  }

  private looksLikeOts(bytes: Uint8Array): boolean {
    if (bytes.length < HEADER_MAGIC.length) return false;
    for (let i = 0; i < HEADER_MAGIC.length; i++) {
      if (bytes[i] !== HEADER_MAGIC[i]) return false;
    }
    return true;
  }

  private async stampFile(bytes: Uint8Array, filename: string): Promise<void> {
    this.status = { kind: 'busy', message: 'Hashing your file (stays in your browser)…' };
    this.cdr.markForCheck();

    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
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
      filename,
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
      filename,
      calendars: calendars.filter(c => !!c.pendingBase64).map(c => c.nickname),
    };
    this.cdr.markForCheck();

    setTimeout(() => {
      if (this.status.kind === 'queued' && this.status.filename === filename) {
        this.reset();
      }
    }, 6000);
  }

  private async postDigestToCalendar(uri: string, digest: Uint8Array): Promise<Uint8Array> {
    // text/plain is a CORS-safelisted content type, so no preflight is sent.
    // The OTS calendars don't validate Content-Type, they only read the body.
    const resp = await fetch(uri + '/digest', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
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

  private errString(e: unknown): string {
    if (e instanceof Error) return e.message;
    try { return String(e); } catch { return 'unknown error'; }
  }
}
