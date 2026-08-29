import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnDestroy, TemplateRef, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { NgbModal, NgbModalRef, NgbPopover } from '@ng-bootstrap/ng-bootstrap';
import { from, map, of, Subscription, switchMap } from 'rxjs';

import { Cat21Service } from 'ordpool-sdk';
import { WalletService } from 'ordpool-sdk';
import {
  KnownOrdinalWallets,
  KnownOrdinalWalletType,
  WalletInfo,
} from 'ordpool-sdk';
import {
  WalletCapability,
  WalletPlatform,
  WatchOnlyScanResult,
  WatchOnlyScriptType,
  makeWatchOnlyProbe,
  scanWatchOnly,
  walletsSupporting,
} from 'ordpool-sdk';

import { environment } from '../../../../environments/environment';
import { buildWalletInfoPopover, WalletInfoPopover } from './wallet-capability-display';

/**
 * How a mint-capable wallet can be reached right now.
 * - `installed`: provider injected, so offer Connect.
 * - `not-installed`: offer the download link.
 * - `watch-only`: signs out-of-band (xpub); the row opens a paste-key flow
 *   that scans the key (`scanWatchOnly`), lets the user confirm/override the
 *   funding address, then connects the assembled watch-only identity.
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
export class WalletConnectComponent implements OnDestroy {

  // just for debugging
  showFakeWallet = false;

  connectButtonDisabled = false;

  modalService = inject(NgbModal);
  walletService = inject(WalletService);
  cat21Service = inject(Cat21Service);
  private cd = inject(ChangeDetectorRef);
  private router = inject(Router);

  // Watch-only (xpub) connect flow, shown in place of the wallet list when
  // the user picks the watch-only row.
  xpubMode = false;
  xpubValue = '';
  /** Undefined until the SDK reports the pasted key is script-type-ambiguous. */
  xpubScriptType: WatchOnlyScriptType | undefined;
  xpubScriptTypeNeeded = false;
  xpubConnecting = false;
  xpubError: string | null = null;

  // Scan-review step (shared UX doc: "show which address was auto-picked and
  // let the user override"). The paste form scans the account key, then this
  // holds the derived receive window + the SDK's auto-picks so the user can
  // confirm (or override) which address funds the mint before connecting.
  xpubScanResult: WatchOnlyScanResult | null = null;
  /** Index into {@link WatchOnlyScanResult.scanned} for the chosen funding (payment) address. */
  xpubPaymentIndex = 0;
  /** In-flight scan; torn down by resetXpub() on flow reset, on modal close or
   *  dismiss (open() wires modalRef.result), and on component destroy. */
  private scanSub?: Subscription;
  /** Aborts the in-flight probe fetches when the scan is torn down. */
  private scanAbort?: AbortController;

  /**
   * The capability the current page needs a wallet for. The connect modal is
   * GLOBAL (opened from the header and from any page via
   * `requestWalletConnect()`), so the action is derived from the route:
   * `/inscribe` needs Inscription, everything else (the mint page + the header
   * CTA) defaults to Cat21Mint. `walletsSupporting` then scopes the picker to
   * wallets that can do THAT action on this platform, and the info popover's
   * "what this action needs" row reflects it.
   */
  private get pageAction(): WalletCapability {
    return this.router.url.includes('/inscribe')
      ? WalletCapability.Inscription
      : WalletCapability.Cat21Mint;
  }

  /** Human label for the current page action, used in the modal intro copy. */
  get pageActionLabel(): string {
    return this.pageAction === WalletCapability.Inscription ? 'inscribe a file' : 'mint a cat';
  }

  /** Platform the SDK provider path is reachable on right now. */
  private readonly platform: WalletPlatform =
    (typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
      ? WalletPlatform.Mobile
      : WalletPlatform.Desktop;

  /** Picker rows, matrix-scoped to Cat21Mint and marked by live detection.
   *  wallets$ is only the re-emit trigger; install-state comes from the
   *  UNFILTERED getInstalledWallets() inside buildPickerRows (see there). */
  pickerRows$ = this.walletService.wallets$.pipe(
    map(() => this.buildPickerRows()),
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
  // wallet. Cross-device aware (a mint started from phone surfaces here on
  // the next 30s poll) and shows only what's actually pending; once mined,
  // the tx drops out of the mempool feed and the user finds it on cat21.space.
  //
  // The switchMap stops the previous polling chain whenever the wallet changes
  // and starts a fresh one for the new addresses, so a disconnect + reconnect
  // with a different wallet does not keep polling the old one.
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
    // takeUntilDestroyed (constructor injection context): this component is the
    // header's persistent <app-wallet-connect>, so the subscription to the root
    // service outlives nothing in practice, but tearing it down on destroy keeps
    // the teardown contract honest.
    this.walletConnectRequested$.pipe(takeUntilDestroyed()).subscribe(() => this.open());
  }

  ngOnDestroy(): void {
    // Abort any in-flight watch-only scan (scanAbort) and drop its subscription
    // if the component is torn down mid-scan.
    this.resetXpub();
  }

  /**
   * Compose the picker: every wallet the matrix says can mint on this
   * platform, cross-referenced with runtime detection for install state.
   */
  private buildPickerRows(): PickerRow[] {
    // Install-state comes from the UNFILTERED detection. wallets$ strips
    // hiddenFromPicker (Phantom/Binance) on every platform, but on a mobile
    // in-app browser those providers ARE injected and the row must read as
    // installed; the matrix `platforms` list already governs which rows show.
    const installed = new Set(
      this.walletService.getInstalledWallets().installedWallets.map((w) => w.type),
    );
    const rows: PickerRow[] = [];

    for (const entry of walletsSupporting(this.pageAction, { platform: this.platform })) {
      const meta = KnownOrdinalWallets[entry.wallet];
      // `hiddenFromPicker` (Phantom, Binance) is a DESKTOP-only convenience:
      // it drops wallets whose desktop binary can't drive the SDK's flows.
      // On a mobile in-app picker those same wallets DO belong (the shared
      // UX doc: a mobile picker reads `walletsForPlatform(Mobile)` and must
      // not consult `hiddenFromPicker`), so the skip is gated on Desktop.
      if (this.platform === WalletPlatform.Desktop && meta.hiddenFromPicker) {
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
    // Tear down any in-flight watch-only scan on BOTH modal outcomes: result
    // resolves on close, rejects on dismiss (X button, ESC, backdrop click).
    // Without this a scan started then dismissed leaves scanAbort un-aborted.
    this.modalRef.result.then(() => this.resetXpub(), () => this.resetXpub());
  }

  private resetXpub(): void {
    this.scanSub?.unsubscribe();
    this.scanSub = undefined;
    this.scanAbort?.abort();
    this.scanAbort = undefined;
    this.xpubMode = false;
    this.xpubValue = '';
    this.xpubScriptType = undefined;
    this.xpubScriptTypeNeeded = false;
    this.xpubConnecting = false;
    this.xpubError = null;
    this.xpubScanResult = null;
    this.xpubPaymentIndex = 0;
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

  /** From the scan-review step back to the paste form (keeps the pasted key). */
  editXpubKey(): void {
    this.xpubScanResult = null;
    this.xpubError = null;
  }

  /**
   * Scan a pasted account extended public key. The SDK derives the receive
   * window and probes each address (via our electrs UTXO endpoint) to
   * auto-pick the ordinals + payment identities. The result is held in
   * {@link xpubScanResult} so {@link confirmXpub} can show the picks and let
   * the user override which address funds the mint before connecting.
   *
   * A plain xpub/tpub is script-type-ambiguous: the SDK throws, and we reveal
   * the account-type selector for a second attempt.
   */
  scanXpub(): void {
    const key = this.xpubValue.trim();
    if (!key || this.xpubConnecting) {
      return;
    }
    this.xpubConnecting = true;
    this.xpubError = null;
    this.xpubScanResult = null;

    // One authoritative ordinals-safe probe (SDK): funded/fundedSats count only
    // UTXOs proven clean (no inscription, rune, cat, or rare sat) and hasCat
    // comes from the cat index, so the ordinals auto-pick finds a cat at any
    // receive index (the Genesis Cat is not at index 0). No size heuristics.
    this.scanAbort = new AbortController();
    const probe = makeWatchOnlyProbe({
      esploraApiUrl: `${environment.apiBaseUrl}/api`,
      ordApiUrl: environment.ordBaseUrls[0],
      cat21OrdApiUrl: environment.cat21OrdBaseUrl,
      signal: this.scanAbort.signal,
    });

    this.scanSub = from(scanWatchOnly({
      extendedPublicKey: key,
      network: this.walletService.network,
      scriptType: this.xpubScriptType,
      probe,
    })).subscribe({
      next: (scan) => {
        this.xpubConnecting = false;
        this.xpubScanResult = scan;
        // Default the funding pick to the SDK's auto-picked payment address;
        // the user can change it in the review step.
        const picked = scan.scanned.findIndex((s) => s.address.address === scan.payment.address);
        this.xpubPaymentIndex = picked >= 0 ? picked : 0;
        this.cd.markForCheck();
      },
      error: (err: unknown) => {
        this.xpubConnecting = false;
        // Match the SDK's stable WatchOnlyDeriveError.code, not the
        // human-readable message (which is free to change). A plain string
        // field is cross-realm safe, unlike instanceof.
        const code = (err as { code?: string })?.code;
        if (code === 'script-type-ambiguous') {
          this.xpubScriptTypeNeeded = true;
          this.xpubError = 'This key could be a Taproot or a legacy account. '
            + 'Pick the account type below (Taproot is recommended for cats), then scan again.';
        } else {
          this.xpubError = err instanceof Error ? err.message : String(err);
        }
        this.cd.markForCheck();
      },
    });
  }

  /**
   * Connect the watch-only wallet with the confirmed / overridden selection.
   * The ordinals identity stays the SDK's auto-pick (the cat-bearing address);
   * the payment identity is whichever scanned address the user confirmed as the
   * mint's funding source. The SDK's `connectFromScan` assembles the WalletInfo
   * and emits it on `connectedWallet$` (guarding that both addresses are in the
   * scan, so a watch-only identity is never an on-chain-lookup value), so every
   * mint flow runs unchanged and signs through the export/paste bridge.
   */
  confirmXpub(): void {
    const scan = this.xpubScanResult;
    if (!scan) {
      return;
    }
    const payment = scan.scanned[this.xpubPaymentIndex]?.address ?? scan.payment;
    this.walletService.connectFromScan(scan, { ordinals: scan.ordinals, payment }).subscribe({
      next: () => this.close(),
      error: (err: unknown) => {
        this.xpubError = err instanceof Error ? err.message : String(err);
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
