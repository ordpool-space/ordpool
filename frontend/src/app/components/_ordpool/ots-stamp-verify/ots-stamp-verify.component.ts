import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import {
  collectBitcoinAttestations,
  OtsAttestation,
  parseOtsFile,
} from 'ordpool-parser';
import { environment } from '@environments/environment';

/*
Test cases:
- Real-file stamp roundtrip: drop any small file, get a pending .ots, drop it
  back in to see "calendar pending" until next block.
- Real .ots verify: drop the well-known proof for OpenTimestamps' README,
  expect block 358391 with valid Merkle-root match.
- Wrong file: drop any .ots first, then drop a different file -- the file's
  hash should fail to match the .ots root msg.
*/

const HEADER_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

// Public OTS calendar. Returns a *pending* .ots binary for the given SHA-256
// digest. Sends Access-Control-Allow-Origin: *, so a browser POST works.
const STAMP_CALENDAR_URL = 'https://a.pool.opentimestamps.org/digest';

interface BitcoinAttestationView {
  blockheight: number;
  expectedMerkleRoot: string;       // hex (display order)
  blockHash: string | null;
  actualMerkleRoot: string | null;  // hex from esplora
  blockTime: number | null;
  match: boolean | null;            // null = lookup failed, true/false = compared
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
  | { kind: 'stamped'; filename: string; hashHex: string }
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

  status: Status = { kind: 'idle' };
  isDragging = false;
  private stampedBlobUrl: string | null = null;
  stampedDownload: { url: string; filename: string } | null = null;

  // Esplora base URL: same convention as the rest of the SPA. In dev this
  // is empty so requests go via the proxy; in prod it's api.ordpool.space.
  private apiBase = environment.apiBaseUrl || '';

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
    if (this.stampedBlobUrl) {
      URL.revokeObjectURL(this.stampedBlobUrl);
      this.stampedBlobUrl = null;
    }
    this.stampedDownload = null;
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

    this.status = { kind: 'busy', message: 'Asking the calendar for a timestamp…' };
    this.cdr.markForCheck();

    // The OTS protocol: POST the raw 32-byte digest, body type
    // application/vnd.opentimestamps.v1, response is a partial .ots
    // (just the calendar's pending attestation; the user upgrades it
    // later once Bitcoin confirms).
    const resp = await fetch(STAMP_CALENDAR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.opentimestamps.v1' },
      body: digest as BufferSource,
    });
    if (!resp.ok) {
      throw new Error(`Calendar replied ${resp.status} ${resp.statusText}`);
    }
    const calendarReply = new Uint8Array(await resp.arrayBuffer());

    // The calendar's reply is a *partial* timestamp (without the header
    // and without the file-hash). Wrap it into a complete .ots file.
    const complete = this.assembleOtsFile(digest, calendarReply);

    const blob = new Blob([complete as BlobPart], { type: 'application/vnd.opentimestamps' });
    if (this.stampedBlobUrl) URL.revokeObjectURL(this.stampedBlobUrl);
    this.stampedBlobUrl = URL.createObjectURL(blob);
    this.stampedDownload = {
      url: this.stampedBlobUrl,
      filename: filename + '.ots',
    };

    this.status = {
      kind: 'stamped',
      filename: filename + '.ots',
      hashHex: this.hex(digest),
    };
    this.cdr.markForCheck();
  }

  /**
   * Build a v1 .ots file from a SHA-256 file digest and the calendar's
   * partial reply.
   *
   * Layout:
   *   HEADER_MAGIC (31 bytes)
   *   major version (1 byte = 0x01)
   *   file-hash op tag (1 byte = 0x08 for sha256)
   *   file digest (32 bytes)
   *   calendar reply (the timestamp tree as the calendar serialised it)
   */
  private assembleOtsFile(digest: Uint8Array, calendarBody: Uint8Array): Uint8Array {
    const out = new Uint8Array(HEADER_MAGIC.length + 1 + 1 + digest.length + calendarBody.length);
    let p = 0;
    out.set(HEADER_MAGIC, p); p += HEADER_MAGIC.length;
    out[p++] = 0x01;             // major version
    out[p++] = 0x08;             // sha256 file-hash op
    out.set(digest, p);          p += digest.length;
    out.set(calendarBody, p);
    return out;
  }

  private async verifyOts(bytes: Uint8Array): Promise<void> {
    this.status = { kind: 'busy', message: 'Parsing the .ots receipt…' };
    this.cdr.markForCheck();

    const parsed = await parseOtsFile(bytes);
    const bitcoinAtts = collectBitcoinAttestations(parsed);

    // Walk the tree once to also collect non-bitcoin attestations for the
    // human-readable summary.
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
        fileHashHex: this.hex(parsed.fileHash),
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
    const expectedDisplayHex = this.hex(this.reverseBytes(expectedRootInternal));
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

  private hex(b: Uint8Array): string {
    let s = '';
    for (let i = 0; i < b.length; i++) {
      const h = b[i].toString(16);
      s += h.length === 1 ? '0' + h : h;
    }
    return s;
  }

  private errString(e: unknown): string {
    if (e instanceof Error) return e.message;
    try { return String(e); } catch { return 'unknown error'; }
  }
}
