import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, TemplateRef, ViewChild } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import {
  collectBitcoinAttestations,
  computeMerkleMath,
  estimatedBatchSize,
  MerkleMath,
  OtsAttestation,
  errString,
  looksLikeOts,
  parseOtsFile,
  sha256Stream,
} from 'ordpool-parser';
import { environment } from '@environments/environment';

import { firstValueFrom } from 'rxjs';

import { OrdpoolApiService } from '../../../services/ordinals/ordpool-api.service';
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
  /** Structural facts about the OTS proof path. */
  math: MerkleMath | null;
  /** Bounds on the calendar-tree batch size, derived from
   *  `math.calendar.depth`. Null when no calendar tree. */
  calendarBatchBounds: { min: bigint; max: bigint } | null;
  /** Bounds on the Bitcoin block's tx count, derived from
   *  `math.bitcoin.depth`. */
  blockTxCountBounds: { min: bigint; max: bigint } | null;
  /** Calendar nickname for this anchor, recovered when the verified
   *  receipt matches one of the user's own pending stamps in local
   *  storage. Null when the receipt is foreign (no matching local
   *  stamp record) -- in that case we fall back to "Anchor #N of M"
   *  in the UI using `subtreeIndex` + `subtreeCount`. */
  calendarNickname: string | null;
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
  | { kind: 'awaiting-receipt'; filename: string }   // user dropped the file first
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
  private api = inject(OrdpoolApiService);
  private modalService = inject(NgbModal);
  private apiBase = environment.apiBaseUrl || '';

  @ViewChild('cancelConfirm') cancelConfirmTemplate!: TemplateRef<unknown>;

  status: Status = { kind: 'idle' };
  isDragging = false;

  // Cache the most-recently-verified receipt so a follow-up file drop can
  // compare against it without re-parsing.
  private lastReceipt: { otsBytes: Uint8Array; recordedFileHashHex: string } | null = null;
  // Cache a file's hash when it's dropped BEFORE a receipt -- the next
  // .ots drop will then complete the match automatically. Both arrival
  // orders (file→receipt and receipt→file) end in the same verdict.
  private cachedFile: { hashHex: string; filename: string } | null = null;
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

  reset(): void {
    this.status = { kind: 'idle' };
    this.lastReceipt = null;
    this.cachedFile = null;
    this.cdr.markForCheck();
  }

  /** Pop a confirmation modal before discarding a hashed-but-unmatched
   *  file. Reuses the wallet-connect NgbModal pattern. */
  confirmCancelAwaiting(): void {
    const ref = this.modalService.open(this.cancelConfirmTemplate, { centered: true });
    ref.result.then(result => {
      if (result === 'discard') this.reset();
    }, () => { /* dismissed -- keep waiting */ });
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
        if (this.lastReceipt) {
          // Receipt already verified — second drop is the match step.
          await this.runFileMatch(cat.data[0]);
          return;
        }
        // No receipt yet: hash the file and hold it. When the user
        // drops the .ots next, verifyOts() will pick the cached hash
        // up and produce a match verdict in one go.
        await this.hashFileAndWaitForReceipt(cat.data[0]);
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

  /** File-before-receipt path: hash the file and wait. The next .ots
   *  drop will see `cachedFile` and produce the match verdict. */
  private async hashFileAndWaitForReceipt(file: File): Promise<void> {
    this.status = { kind: 'busy', message: 'Hashing your file (stays in your browser)…' };
    this.cdr.markForCheck();
    const digest = await sha256Stream(file);
    this.cachedFile = { hashHex: hexEncode(digest), filename: file.name };
    this.status = { kind: 'awaiting-receipt', filename: file.name };
    this.cdr.markForCheck();
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
    // computeMerkleMath walks the same tree in the same order as
    // collectBitcoinAttestations, so the i-th entry of each lines up.
    const merkleMathByIndex = computeMerkleMath(parsed);

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
    for (let i = 0; i < bitcoinAtts.length; i++) {
      const a = bitcoinAtts[i];
      this.status = {
        kind: 'busy',
        message: `Looking up Bitcoin block ${a.blockheight.toLocaleString()}…`,
      };
      this.cdr.markForCheck();
      const att = await this.checkAttestation(a.blockheight, a.expectedMerkleRoot);
      const math = merkleMathByIndex[i] ?? null;
      // Resolve calendar identity via our indexer when possible: the
      // bitcoin attestation tells us the block; math.bitcoin.leafIndex
      // tells us the calendar's anchor tx position within that block;
      // /ots/tx/:txid on our backend maps that tx to a calendar
      // nickname. When the backend has no row (foreign calendar, not
      // indexed yet, or a fixture that predates our indexer's start
      // block) we silently fall back to position-based labeling in the
      // UI -- never breaks the verify panel.
      const calendarNickname = await this.lookupCalendarFromAnchor(att.blockHash, math?.bitcoin?.leafIndex);
      view.push({
        ...att,
        math,
        calendarBatchBounds: math?.calendar ? estimatedBatchSize(math.calendar.depth) : null,
        blockTxCountBounds: math?.bitcoin ? estimatedBatchSize(math.bitcoin.depth) : null,
        calendarNickname,
      });
    }

    const recordedFileHashHex = hexEncode(parsed.fileHash);
    this.lastReceipt = { otsBytes: bytes, recordedFileHashHex };

    // If the user dropped the original file BEFORE the receipt, we
    // already hashed it. Resolve the match in the same status flip
    // (one verdict screen, no intermediate empty-fileMatch view).
    const fileMatch: FileMatchView | null = this.cachedFile
      ? {
          yourFileHashHex: this.cachedFile.hashHex,
          matchesReceipt: this.cachedFile.hashHex === recordedFileHashHex,
          filename: this.cachedFile.filename,
        }
      : null;

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
      fileMatch,
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
  ): Promise<Omit<BitcoinAttestationView, 'math' | 'calendarBatchBounds' | 'blockTxCountBounds' | 'calendarNickname'>> {
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

  /** Best-effort: identify the calendar that anchored a confirmed
   *  Bitcoin attestation. The merkle-math gives us the anchor tx's
   *  position in the block; mempool's /api/block/<hash>/txid/<pos>
   *  resolves position → txid; our /ots/tx/:txid backend returns the
   *  calendar nickname for known anchor txs. Any step that fails
   *  returns null and the caller renders a position-based fallback. */
  private async lookupCalendarFromAnchor(
    blockHash: string | null,
    anchorTxPosition: bigint | undefined,
  ): Promise<string | null> {
    if (!blockHash || anchorTxPosition === undefined) return null;
    try {
      const resp = await fetch(`${this.apiBase}/api/block/${blockHash}/txid/${anchorTxPosition}`);
      if (!resp.ok) return null;
      const txid = (await resp.text()).trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(txid)) return null;
      const row = await firstValueFrom(this.api.getOtsTx$(txid));
      return row?.calendar ?? null;
    } catch {
      return null;
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
