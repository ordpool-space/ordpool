import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import {
  collectBitcoinAttestations,
  OtsAttestation,
  parseOtsFile,
} from 'ordpool-parser';
import { environment } from '@environments/environment';

import {
  OTS_CALENDARS,
  OtsLocalCalendar,
  OtsStoreService,
  bytesToBase64,
  hexEncode,
} from './ots-store.service';

/*
Test cases:
- Drop a small text file: parallel POST to all 3 calendars, then a new row
  appears in the pending-queue below; drop-zone resets to idle.
- Drop a real .ots: parses, fetches each Bitcoin attestation's block,
  shows valid/mismatch verdict.
- Drop a corrupt or empty file: shows a clear error.
*/

const HEADER_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

interface BitcoinAttestationView {
  blockheight: number;
  expectedMerkleRoot: string;
  blockHash: string | null;
  actualMerkleRoot: string | null;
  blockTime: number | null;
  match: boolean | null;
}

interface VerifyResult {
  fileHashAlgo: string;
  fileHashHex: string;
  bitcoinAttestations: BitcoinAttestationView[];
  pendingCalendars: string[];
  unknownAttestations: number;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'queued'; filename: string }
  | { kind: 'verified'; result: VerifyResult }
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-ots-stamp-verify',
  templateUrl: './ots-stamp-verify.component.html',
  styleUrls: ['./ots-stamp-verify.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class OtsStampVerifyComponent {

  private cdr = inject(ChangeDetectorRef);
  private store = inject(OtsStoreService);
  private apiBase = environment.apiBaseUrl || '';

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
        await this.verifyOts(bytes);
      } else {
        await this.stampFile(bytes, file.name);
      }
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

    this.status = { kind: 'busy', message: 'Submitting to 3 calendars…' };
    this.cdr.markForCheck();

    const now = Date.now();

    // Parallel POST to all 3 calendars. We tolerate per-calendar failures:
    // if alice is down but bob/finney accept, we still queue a usable stamp.
    const replies = await Promise.allSettled(
      OTS_CALENDARS.map(uri => this.postDigestToCalendar(uri, digest)),
    );

    const calendars: OtsLocalCalendar[] = OTS_CALENDARS.map((uri, i) => {
      const r = replies[i];
      if (r.status === 'fulfilled') {
        return {
          uri,
          pendingBase64: bytesToBase64(r.value),
          upgradedBase64: null,
          lastCheckedAt: now,
          lastResult: 'pending',
          errorMessage: null,
        };
      }
      return {
        uri,
        pendingBase64: '',
        upgradedBase64: null,
        lastCheckedAt: now,
        lastResult: 'error',
        errorMessage: r.reason instanceof Error ? r.reason.message : 'submit failed',
      };
    });

    // If every calendar failed, surface that. Otherwise queue with the
    // surviving calendars; the rest stays in 'error' state in the row.
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

    // Ask for desktop-notification permission once; we'll fire a single
    // Notification per stamp when it flips to 'ready'. Skips silently if
    // the API isn't available or already decided.
    this.maybeRequestNotificationPermission();

    this.status = { kind: 'queued', filename };
    this.cdr.markForCheck();

    // Auto-reset after a short pause so the dropzone is ready for the next file.
    setTimeout(() => {
      if (this.status.kind === 'queued' && this.status.filename === filename) {
        this.reset();
      }
    }, 6000);
  }

  private async postDigestToCalendar(uri: string, digest: Uint8Array): Promise<Uint8Array> {
    // text/plain is a CORS-safelisted content type, so no preflight is sent.
    // The OTS calendars don't validate Content-Type, they only read the body.
    // If we send 'application/vnd.opentimestamps.v1' (the protocol-canonical
    // value) the browser preflights with OPTIONS, the calendars 404 the
    // OPTIONS, and the POST never happens. Verified live against alice.
    const resp = await fetch(uri + '/digest', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: digest as BufferSource,
    });
    if (!resp.ok) throw new Error(uri + ' replied ' + resp.status);
    return new Uint8Array(await resp.arrayBuffer());
  }

  private async verifyOts(bytes: Uint8Array): Promise<void> {
    this.status = { kind: 'busy', message: 'Parsing the .ots receipt…' };
    this.cdr.markForCheck();

    const parsed = await parseOtsFile(bytes);
    const bitcoinAtts = collectBitcoinAttestations(parsed);

    const pendingCalendars: string[] = [];
    let unknown = 0;
    const visit = (node: { attestations: OtsAttestation[]; children: any[] }) => {
      for (const a of node.attestations) {
        if (a.kind === 'pending') pendingCalendars.push(a.uri);
        else if (a.kind === 'unknown') unknown++;
      }
      for (const c of node.children) visit(c.node);
    };
    visit(parsed.root);

    const view: BitcoinAttestationView[] = [];
    for (const a of bitcoinAtts) {
      this.status = {
        kind: 'busy',
        message: `Looking up Bitcoin block ${a.blockheight.toLocaleString()}…`,
      };
      this.cdr.markForCheck();
      view.push(await this.checkAttestation(a.blockheight, a.expectedMerkleRoot));
    }

    this.status = {
      kind: 'verified',
      result: {
        fileHashAlgo: parsed.fileHashAlgo,
        fileHashHex: hexEncode(parsed.fileHash),
        bitcoinAttestations: view,
        pendingCalendars,
        unknownAttestations: unknown,
      },
    };
    this.cdr.markForCheck();
  }

  private async checkAttestation(
    blockheight: number,
    expectedRootInternal: Uint8Array,
  ): Promise<BitcoinAttestationView> {
    const expectedDisplayHex = hexEncode(this.reverseBytes(expectedRootInternal));
    try {
      const hashResp = await fetch(this.apiBase + '/api/block-height/' + blockheight);
      if (!hashResp.ok) throw new Error('block-height ' + hashResp.status);
      const blockHash = (await hashResp.text()).trim();

      const blockResp = await fetch(this.apiBase + '/api/block/' + blockHash);
      if (!blockResp.ok) throw new Error('block ' + blockResp.status);
      const block = await blockResp.json() as { merkle_root?: string; timestamp?: number };

      const actual = (block.merkle_root || '').toLowerCase();
      return {
        blockheight,
        expectedMerkleRoot: expectedDisplayHex,
        blockHash,
        actualMerkleRoot: actual,
        blockTime: block.timestamp ?? null,
        match: !!actual && actual === expectedDisplayHex,
      };
    } catch {
      return {
        blockheight,
        expectedMerkleRoot: expectedDisplayHex,
        blockHash: null,
        actualMerkleRoot: null,
        blockTime: null,
        match: null,
      };
    }
  }

  private reverseBytes(b: Uint8Array): Uint8Array {
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b[b.length - 1 - i];
    return out;
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
