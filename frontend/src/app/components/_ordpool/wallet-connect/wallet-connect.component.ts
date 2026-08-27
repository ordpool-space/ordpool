import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, TemplateRef, ViewChild } from '@angular/core';
import { NgbModal, NgbModalRef, NgbPopover } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom, map, of, switchMap } from 'rxjs';

import { Cat21Service } from 'ordpool-sdk';
import { WalletService } from 'ordpool-sdk';
import {
  KnownOrdinalWallet,
  KnownOrdinalWallets,
  KnownOrdinalWalletType,
  WalletInfo,
} from 'ordpool-sdk';

/** Shape of {@link WalletService.wallets$} (anonymous in the SDK types). */
interface DetectedWallets {
  installedWallets: KnownOrdinalWallet[];
  notInstalledWallets: KnownOrdinalWallet[];
}
import {
  WalletCapability,
  WalletPlatform,
  WatchOnlyScriptType,
  walletsSupporting,
} from 'ordpool-sdk';

import { environment } from '../../../../environments/environment';
import { buildWalletInfoPopover, WalletInfoPopover } from './wallet-capability-display';

/**
 * How a mint-capable wallet can be reached right now.
 * - `installed`: provider injected, so offer Connect.
 * - `not-installed`: offer the download link.
 * - `watch-only`: signs out-of-band (xpub); the row opens a paste-key flow
 *   that connects via `WalletService.connectXpub`.
 */
type PickerRowState = 'installed' | 'not-installed' | 'watch-only';

interface PickerRow {
  wallet: KnownOrdinalWalletType;
  label: string;
  subLabel?: string;
  logo: string;
  downloadLink: string;
  state: PickerRowState;
  info: WalletInfoPopover;
}

@Component({
  selector: 'app-wallet-connect',
  templateUrl: './wallet-connect.component.html',
  styleUrls: ['./wallet-connect.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class WalletConnectComponent {

  // just for debugging
  showFakeWallet = false;

  connectButtonDisabled = false;

  modalService = inject(NgbModal);
  walletService = inject(WalletService);
  cat21Service = inject(Cat21Service);
  private http = inject(HttpClient);
  private cd = inject(ChangeDetectorRef);

  // Watch-only (xpub) connect flow, shown in place of the wallet list when
  // the user picks the watch-only row.
  xpubMode = false;
  xpubValue = '';
  /** Undefined until the SDK reports the pasted key is script-type-ambiguous. */
  xpubScriptType: WatchOnlyScriptType | undefined;
  xpubScriptTypeNeeded = false;
  xpubConnecting = false;
  xpubError: string | null = null;

  /**
   * The only reason to connect a wallet on ordpool.space is to mint a cat,
   * so the picker is scoped to that one capability. `walletsSupporting`
   * already excludes wallets that can't mint or aren't reachable on this
   * platform; runtime provider detection (`wallets$`) then marks each as
   * installed vs "get the extension".
   */
  readonly pageAction = WalletCapability.Cat21Mint;

  /** Platform the SDK provider path is reachable on right now. */
  private readonly platform: WalletPlatform =
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      ? WalletPlatform.Mobile
      : WalletPlatform.Desktop;

  /** Picker rows, matrix-scoped to Cat21Mint and marked by live detection. */
  pickerRows$ = this.walletService.wallets$.pipe(
    map((wallets) => this.buildPickerRows(wallets)),
  );

  connectedWallet$ = this.walletService.connectedWallet$;
  walletConnectRequested$ = this.walletService.walletConnectRequested$;
  isMainnet$ = this.walletService.isMainnet$;
  // HACK -- Ordpool: connected wallet's network mismatch + expected group.
  // Drives the wrong-network red banner in the popover. Backed by the
  // SDK's getAddressNetwork / isAddressCompatibleWithNetwork helpers.
  networkMismatch$ = this.walletService.networkMismatch$;
  expectedNetworkGroup = this.walletService.expectedNetworkGroup;

  // Live feed of CAT-21 mints in the mempool addressed to the connected
  // wallet. Replaces the old localStorage-backed lastCat21Mints$:
  //   - cross-device aware (a mint started from phone surfaces here on
  //     the next 30s poll)
  //   - only shows what's actually pending; once mined, the tx drops
  //     out of the mempool feed and the user finds it on cat21.space
  //
  // The switchMap stops the previous polling chain whenever the wallet
  // changes and starts a fresh one for the new addresses — exactly
  // what we want when the user disconnects + reconnects with a
  // different wallet.
  pendingCats$ = this.connectedWallet$.pipe(
    switchMap(w => w
      ? this.cat21Service.pendingMints$([w.ordinalsAddress, w.paymentAddress])
      : of([])
    )
  );

  knownOrdinalWallets = KnownOrdinalWallets;

  @ViewChild('connect') connectTemplateRef: TemplateRef<any>;
  modalRef: NgbModalRef | undefined;

  constructor() {
    this.walletConnectRequested$.subscribe(() => this.open());
  }

  /**
   * Compose the picker: every wallet the matrix says can mint on this
   * platform, cross-referenced with runtime detection for install state.
   */
  private buildPickerRows(wallets: DetectedWallets): PickerRow[] {
    const installed = new Set(wallets.installedWallets.map((w) => w.type));
    const rows: PickerRow[] = [];

    for (const entry of walletsSupporting(this.pageAction, { platform: this.platform })) {
      const meta = KnownOrdinalWallets[entry.wallet];
      if (meta.hiddenFromPicker) {
        continue;
      }
      const info = buildWalletInfoPopover(entry.wallet, this.pageAction);
      if (!info) {
        continue;
      }
      const state: PickerRowState =
        entry.signingMode === 'watch-only'
          ? 'watch-only'
          : installed.has(entry.wallet)
            ? 'installed'
            : 'not-installed';

      rows.push({
        wallet: entry.wallet,
        label: meta.label,
        subLabel: meta.subLabel,
        logo: meta.logo,
        downloadLink: meta.downloadLink,
        state,
        info,
      });
    }
    return rows;
  }

  open(): void {
    this.connectButtonDisabled = false;
    this.resetXpub();

    this.modalRef = this.modalService.open(this.connectTemplateRef, {
      ariaLabelledBy: 'modal-basic-title',
      centered: true
    });
  }

  private resetXpub(): void {
    this.xpubMode = false;
    this.xpubValue = '';
    this.xpubScriptType = undefined;
    this.xpubScriptTypeNeeded = false;
    this.xpubConnecting = false;
    this.xpubError = null;
  }

  /** Switch the modal body to the watch-only paste form. */
  startXpub(): void {
    this.resetXpub();
    this.xpubMode = true;
  }

  /** Back to the wallet list. */
  cancelXpub(): void {
    this.resetXpub();
  }

  /**
   * Connect a watch-only wallet from a pasted account extended public key.
   * The SDK derives + scans (via our electrs probe) and pushes a normal
   * WalletInfo onto `connectedWallet$`; the mint flow then runs unchanged,
   * signing through the export/paste bridge. A plain xpub/tpub is
   * script-type-ambiguous: the SDK throws, and we reveal the account-type
   * selector for a second attempt.
   */
  connectXpub(): void {
    const key = this.xpubValue.trim();
    if (!key || this.xpubConnecting) {
      return;
    }
    this.xpubConnecting = true;
    this.xpubError = null;

    const probe = (address: string) => firstValueFrom(
      this.http
        .get<{ value: number }[]>(`${environment.apiBaseUrl}/api/address/${address}/utxo`)
        .pipe(map((utxos) => ({
          funded: utxos.length > 0,
          fundedSats: utxos.reduce((sum, u) => sum + u.value, 0),
        }))),
    );

    this.walletService
      .connectXpub({ extendedPublicKey: key, scriptType: this.xpubScriptType, probe })
      .subscribe({
        next: () => {
          this.xpubConnecting = false;
          this.close();
        },
        error: (err: unknown) => {
          this.xpubConnecting = false;
          const msg = err instanceof Error ? err.message : String(err);
          if (/script-type-ambiguous/i.test(msg)) {
            this.xpubScriptTypeNeeded = true;
            this.xpubError = 'This key could be a Taproot or a legacy account. '
              + 'Pick the account type below (Taproot is recommended for cats), then connect again.';
          } else {
            this.xpubError = msg;
          }
          this.cd.markForCheck();
        },
      });
  }

  close(): void {
    this.modalRef?.close();
    this.connectButtonDisabled = false;
  }

  disconnect(popover: NgbPopover): void {

    // Close the popover
    popover.close();

    this.walletService.disconnectWallet();
  }

  connectWallet(key: KnownOrdinalWalletType): void {

    // Unisat docs:
    // https://docs.unisat.io/dev/unisat-developer-service/unisat-wallet
    // 1. You should only initiate a connection request in response to direct user action, such as clicking a button.
    // 2. You should always disable the 'connect' button while the connection request is pending.
    // 3. You should never initiate a connection request on page load.

    if (key !== KnownOrdinalWalletType.leather) { // leather has no cancel event
      this.connectButtonDisabled = true;
    }

    this.walletService.connectWallet(key).pipe().subscribe({
      next: () => this.close(),
      error: (err) => {
        console.log('*** Error while connecting ***', err);
        this.close(); }
    });
  }

  connectFakeWallet(): void {

    const walletInfo: WalletInfo = {
      type: KnownOrdinalWalletType.xverse,
      ordinalsAddress: 'bc1p64fa7mjsvlfcutnfapwhxyuvchxgk22l4at7xsh4z02tuuqwaj5syt6x2e',
      ordinalsPublicKey: '5df12ac222a1cd78dd4681c7c7a56f3e273884a086b2b6100957d20c73be3c37',
      paymentAddress: '3Ec1WB9ihWTxAfZSpGmQpNq4pr4goi3KgP',
      paymentPublicKey: '0278875d226dd610b06c41d698c9fe0ea4915c797ddc31a3310299d9acd07ff37b',
      signingSupported: true,
    };

    this.walletService.connectFakeWallet(walletInfo);
    this.close();
  }
}
