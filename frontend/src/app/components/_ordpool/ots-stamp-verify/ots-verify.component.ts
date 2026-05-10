import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import {
  collectBitcoinAttestations,
  OtsAttestation,
  errString,
  looksLikeOts,
  parseOtsFile,
  sha256Stream,
} from 'ordpool-parser';
import { environment } from '@environments/environment';

import { OtsCalendarPickerService } from './ots-calendar-picker.service';
import { hexEncode } from './ots-store.service';

/*
Test cases:
- Drop a real .ots: parses, fetches each Bitcoin attestation's block, shows
  Valid/Mismatch verdict, plus a sub-zone "drop the original file to confirm".
- Drop a real .ots and the original file together: hashes the file in the
  browser, compares to the .ots-recorded fileHash, gives a definitive
  verdict ("✓ this file existed by block N" / "✗ receipt is for a different
  file").
- Drop just a regular file (no .ots): friendly error explaining what's
  missing.
- Drop a corrupt or empty file: shows a clear error.
*/


interface BitcoinAttestationView {
  blockheight: number;
  expectedMerkleRoot: string;
  blockHash: string | null;
  actualMerkleRoot: string | null;
  blockTime: number | null;
  match: boolean | null;
}

interface ReceiptView {
  fileHashAlgo: string;
  fileHashHex: string;
  bitcoinAttestations: BitcoinAttestationView[];
  pendingCalendars: string[];
  litecoinHeights: number[];
  ethereumHeights: number[];
  unknownAttestations: number;
}

interface FileMatchView {
  yourFileHashHex: string;
  matchesReceipt: boolean;
  filename: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'verified'; receipt: ReceiptView; fileMatch: FileMatchView | null }
  | { kind: 'file-only' }                // user dropped a non-.ots without a receipt
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-ots-verify',
  templateUrl: './ots-verify.component.html',
  styleUrls: ['./ots-verify.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class OtsVerifyComponent {

  private cdr = inject(ChangeDetectorRef);
  private picker = inject(OtsCalendarPickerService);
  private apiBase = environment.apiBaseUrl || '';

  status: Status = { kind: 'idle' };
  isDragging = false;

  // Cache the most-recently-verified receipt so a follow-up file drop can
  // compare against it without re-parsing.
  private lastReceipt: { otsBytes: Uint8Array; recordedFileHashHex: string } | null = null;
  private knownNicknameByUri = new Map<string, string>();

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
    const files = Array.from(ev.dataTransfer?.files ?? []);
    if (files.length) this.handleFiles(files);
  }

  onPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length) this.handleFiles(files);
    input.value = '';
  }

  /** Drop the secondary "match against the original file" zone (only shown
   *  after a .ots-only verify). */
  onMatchDrop(ev: DragEvent): void {
    ev.preventDefault();
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.matchAgainstReceipt(file);
  }

  onMatchPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.matchAgainstReceipt(file);
    input.value = '';
  }

  reset(): void {
    this.status = { kind: 'idle' };
    this.lastReceipt = null;
    this.cdr.markForCheck();
  }

  private async handleFiles(files: File[]): Promise<void> {
    try {
      // Categorise by magic-bytes sniff. We only need the first 32 bytes of
      // each file to identify a .ots; the data file stays as a streaming
      // File handle so big-file hashing later doesn't allocate a heap copy.
      const cat: { ots: { name: string; bytes: Uint8Array }[]; data: File[] } = { ots: [], data: [] };
      for (const f of files) {
        const head = new Uint8Array(await f.slice(0, 32).arrayBuffer());
        if (looksLikeOts(head)) {
          // .ots receipts are tiny (a few hundred bytes typically). Reading
          // the whole thing into memory is fine.
          cat.ots.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
        } else {
          cat.data.push(f);
        }
      }

      if (cat.ots.length === 0 && cat.data.length === 1) {
        this.status = { kind: 'file-only' };
        this.cdr.markForCheck();
        return;
      }
      if (cat.ots.length > 1) {
        this.status = { kind: 'error', message: 'Drop one .ots receipt at a time.' };
        this.cdr.markForCheck();
        return;
      }
      if (cat.ots.length === 1) {
        try {
          await this.verifyOts(cat.ots[0].bytes);
        } catch (e) {
          const msg = errString(e);
          // Specific mismatch: the receipt uses an op we don't implement
          // (typically KECCAK256, which is Ethereum-side only). Educate the
          // user instead of dumping the raw error.
          if (/not yet implemented|KECCAK256|RIPEMD160/i.test(msg)) {
            this.status = {
              kind: 'error',
              message: 'This receipt uses cryptographic ops only valid for non-Bitcoin chains (Ethereum / Litecoin) which ordpool does not verify. Bitcoin-only receipts work fine; for multi-chain receipts use the official `ots` CLI.',
            };
            this.cdr.markForCheck();
            return;
          }
          throw e;
        }
        // If a data file was dropped alongside, run the match step too.
        if (cat.data.length === 1 && this.status.kind === 'verified') {
          await this.runFileMatch(cat.data[0]);
        }
        return;
      }
      this.status = { kind: 'error', message: 'Drop a .ots receipt to verify.' };
      this.cdr.markForCheck();
    } catch (e) {
      this.status = { kind: 'error', message: errString(e) };
      this.cdr.markForCheck();
    }
  }

  /** Used by the secondary "match against original file" sub-zone after a
   *  .ots-only verify. */
  private async matchAgainstReceipt(file: File): Promise<void> {
    if (!this.lastReceipt) return;
    try {
      // Peek the first 32 bytes only. Defensively reject if the user
      // accidentally drops a .ots here.
      const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
      if (looksLikeOts(head)) {
        this.status = { kind: 'error', message: 'This sub-zone wants the ORIGINAL FILE, not another .ots.' };
        this.cdr.markForCheck();
        return;
      }
      await this.runFileMatch(file);
    } catch (e) {
      this.status = { kind: 'error', message: errString(e) };
      this.cdr.markForCheck();
    }
  }

  private async verifyOts(bytes: Uint8Array): Promise<void> {
    this.status = { kind: 'busy', message: 'Parsing the .ots receipt…' };
    this.cdr.markForCheck();

    if (this.knownNicknameByUri.size === 0) {
      try {
        for (const c of await this.picker.pick()) this.knownNicknameByUri.set(c.url, c.nickname);
      } catch { /* picker has its own fallback */ }
    }

    const parsed = await parseOtsFile(bytes);
    const bitcoinAtts = collectBitcoinAttestations(parsed);

    const pendingCalendars: string[] = [];
    const litecoinHeights: number[] = [];
    const ethereumHeights: number[] = [];
    let unknown = 0;
    const visit = (node: { attestations: OtsAttestation[]; children: any[] }) => {
      for (const a of node.attestations) {
        if (a.kind === 'pending')         pendingCalendars.push(a.uri);
        else if (a.kind === 'litecoin')   litecoinHeights.push(a.height);
        else if (a.kind === 'ethereum')   ethereumHeights.push(a.height);
        else if (a.kind === 'unknown')    unknown++;
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

    const recordedFileHashHex = hexEncode(parsed.fileHash);
    this.lastReceipt = { otsBytes: bytes, recordedFileHashHex };
    this.status = {
      kind: 'verified',
      receipt: {
        fileHashAlgo: parsed.fileHashAlgo,
        fileHashHex: recordedFileHashHex,
        bitcoinAttestations: view,
        pendingCalendars,
        litecoinHeights,
        ethereumHeights,
        unknownAttestations: unknown,
      },
      fileMatch: null,
    };
    this.cdr.markForCheck();
  }

  private async runFileMatch(file: File): Promise<void> {
    if (!this.lastReceipt) return;
    // Capture the receipt view BEFORE we flip into busy so we don't lose it.
    const receipt = this.status.kind === 'verified' ? this.status.receipt : null;
    if (!receipt) return;

    this.status = { kind: 'busy', message: 'Hashing your file (stays in your browser)…' };
    this.cdr.markForCheck();

    // Streaming SHA-256 -- handles arbitrarily large files without
    // materialising them as a single ArrayBuffer.
    const digest = await sha256Stream(file);
    const yourHashHex = hexEncode(digest);
    const matches = yourHashHex === this.lastReceipt.recordedFileHashHex;

    this.status = {
      kind: 'verified',
      receipt,
      fileMatch: { yourFileHashHex: yourHashHex, matchesReceipt: matches, filename: file.name },
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

  pendingCalendarsLabel(uris: string[]): string {
    return uris.map(u => this.knownNicknameByUri.get(u.replace(/\/+$/, ''))
      ?? (() => { try { return new URL(u).hostname.split('.')[0]; } catch { return u; } })()
    ).join(', ');
  }

  private reverseBytes(b: Uint8Array): Uint8Array {
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b[b.length - 1 - i];
    return out;
  }

}
