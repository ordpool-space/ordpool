import { Component } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

/**
 * Export/paste dialog for watch-only (xpub) signing. Opened by
 * {@link PsbtExportPromptService} as the SDK's `promptForSignedPsbt` bridge:
 * the SDK hands us the unsigned PSBT, the user signs it in their own wallet
 * (Sparrow, Electrum, Coldcard, ...), and pastes the signed PSBT back. The
 * service resolves the mint's signing step with `activeModal.close(signed)`;
 * cancelling dismisses, which surfaces as a mint error.
 */
@Component({
  selector: 'app-psbt-export-prompt',
  templateUrl: './psbt-export-prompt.component.html',
  styleUrls: ['./psbt-export-prompt.component.scss'],
  standalone: false,
})
export class PsbtExportPromptComponent {

  /** Set imperatively by the opener before the modal renders. */
  unsigned: { base64: string; hex: string } = { base64: '', hex: '' };

  signedPsbt = '';

  constructor(public activeModal: NgbActiveModal) {}

  /**
   * Offer the unsigned PSBT as a file for wallets that import from disk.
   *
   * A `.psbt` file is a BINARY container (magic bytes `0x70 0x73 0x62 0x74
   * 0xff` = "psbt\xff"). Wallets that import a `.psbt` from disk read those
   * raw bytes and reject a file that holds the base64 TEXT instead. Decode
   * the base64 to its bytes here so the download is a real binary PSBT. The
   * copy-to-clipboard path stays base64, the text form wallets paste.
   */
  download(): void {
    const binary = atob(this.unsigned.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cat21-mint-unsigned.psbt';
    a.click();
    URL.revokeObjectURL(url);
  }

  submit(): void {
    const signed = this.signedPsbt.trim();
    if (signed) {
      this.activeModal.close(signed);
    }
  }
}
