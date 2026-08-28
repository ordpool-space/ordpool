import { inject, Injectable } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { defer, from, Observable } from 'rxjs';

import { PsbtExportPromptComponent } from './psbt-export-prompt.component';

/**
 * The `promptForSignedPsbt` bridge for watch-only (xpub) wallets. A caller
 * passes {@link promptForSignedPsbt} to an SDK orchestrator action method
 * (e.g. `Cat21MintOrchestrator.mint(prompt)`); the SDK builds the PSBT and
 * invokes it, this opens the export/paste dialog, and the returned observable
 * resolves with the signed PSBT the user pasted back. Injected browser wallets
 * never invoke the callback (their SDK signer ignores it), so callers pass it
 * unconditionally.
 */
@Injectable({ providedIn: 'root' })
export class PsbtExportPromptService {

  private modal = inject(NgbModal);

  promptForSignedPsbt(unsigned: { base64: string; hex: string }): Observable<string> {
    // Cold: open the dialog on SUBSCRIBE, not on call. An orchestrator that
    // builds the pipeline but errors or is unsubscribed before the sign step
    // then leaves no orphaned modal on screen.
    return defer(() => {
      const ref = this.modal.open(PsbtExportPromptComponent, { centered: true, backdrop: 'static' });
      ref.componentInstance.unsigned = unsigned;
      // ref.result resolves with the pasted signed PSBT (close) or rejects on
      // dismiss; the rejection propagates as a mint error.
      return from(ref.result as Promise<string>);
    });
  }
}
