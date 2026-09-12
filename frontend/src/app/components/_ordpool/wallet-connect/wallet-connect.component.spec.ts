/**
 * Tests the watch-only (xpub) connect flow on the wallet picker. The SUT is
 * the component's logic; its collaborators (the SDK WalletService, HttpClient,
 * NgbModal, and the pure `scanWatchOnly` helper) are mocked. `ordpool-sdk` is
 * mocked at the module boundary both to inject a stub WalletService and to
 * dodge the sats-connect ESM chain, exactly as the sibling cat21-mint spec
 * does. The component is built via runInInjectionContext so we exercise the
 * connect logic without compiling the heavy template.
 */
jest.mock('ordpool-sdk', () => ({
  Cat21Service: class Cat21Service {},
  WalletService: class WalletService {},
  KnownOrdinalWallets: {},
  KnownOrdinalWalletType: { xverse: 'xverse', xpub: 'xpub' },
  WalletCapability: {
    Cat21Mint: 'cat21-mint',
    Cat21Transfer: 'cat21-transfer',
    Cat21OfferCreate: 'cat21-offer-create',
    Cat21OfferAccept: 'cat21-offer-accept',
    Inscription: 'inscription',
    InscriptionParentChild: 'inscription-parent-child',
    SignMessage: 'sign-message',
  },
  WalletPlatform: { Desktop: 'desktop', Mobile: 'mobile' },
  CapabilitySupport: { Proven: 'proven', Adapter: 'adapter', Unsupported: 'unsupported' },
  walletPickerRows: jest.fn(() => []),
  scanWatchOnly: jest.fn(),
  makeWatchOnlyProbe: jest.fn(() => jest.fn()),
  CONNECT_BUTTON_LABEL: 'Connect',
  CONNECT_BUTTON_ACCESSIBLE_NAME: 'Connect a wallet',
  CONNECT_PANEL_HEADING: 'Connect a wallet',
}));

import { ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Subject, of, throwError } from 'rxjs';

import {
  Cat21Service,
  WalletCapability,
  WalletService,
  scanWatchOnly,
  walletPickerRows,
} from 'ordpool-sdk';

import { WalletConnectComponent } from './wallet-connect.component';

/** Flush pending promise microtasks + one macrotask so `from(Promise)` emits. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A two-address scan result the review step renders + connects from. */
function fakeScan() {
  return {
    scanned: [
      { address: { address: 'addr0', publicKeyHex: 'pk0', path: '0/0', chain: 0, index: 0 }, probe: { funded: false, fundedSats: 0 } },
      { address: { address: 'addr1', publicKeyHex: 'pk1', path: '0/1', chain: 0, index: 1 }, probe: { funded: true, fundedSats: 5000 } },
    ],
    ordinals: { address: 'addr0', publicKeyHex: 'pk0', path: '0/0', chain: 0, index: 0 },
    payment: { address: 'addr1', publicKeyHex: 'pk1', path: '0/1', chain: 0, index: 1 },
    ordinalsReason: 'default',
    paymentReason: 'funds',
  };
}

describe('WalletConnectComponent watch-only (xpub) flow', () => {

  let walletService: {
    wallets$: unknown;
    connectedWallet$: unknown;
    walletConnectRequested$: Subject<boolean>;
    isMainnet$: unknown;
    networkMismatch$: unknown;
    expectedNetworkGroup: string;
    network: string;
    connectFakeWallet: jest.Mock;
    connectFromScan: jest.Mock;
  };
  let http: { get: jest.Mock };
  let component: WalletConnectComponent;

  beforeEach(() => {
    (scanWatchOnly as jest.Mock).mockReset();
    walletService = {
      wallets$: of({ installedWallets: [], notInstalledWallets: [] }),
      connectedWallet$: of(null),
      walletConnectRequested$: new Subject<boolean>(),
      isMainnet$: of(true),
      networkMismatch$: of(false),
      expectedNetworkGroup: 'mainnet',
      network: 'mainnet',
      connectFakeWallet: jest.fn(),
      connectFromScan: jest.fn(() => of({ type: 'xpub' })),
    };
    http = { get: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: WalletService, useValue: walletService },
        { provide: Cat21Service, useValue: { pendingMints$: jest.fn(() => of([])) } },
        { provide: NgbModal, useValue: { open: jest.fn(), hasOpenModals: jest.fn(() => false) } },
        { provide: HttpClient, useValue: http },
        { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn(), detectChanges: jest.fn() } },
        { provide: Router, useValue: { url: '/cat21-mint' } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new WalletConnectComponent());
  });

  it('open() shows one dialog only: the static flag suppresses the second header instance', () => {
    (WalletConnectComponent as unknown as { connectModalOpen: boolean }).connectModalOpen = false; // isolate
    const modal = TestBed.inject(NgbModal) as unknown as { open: jest.Mock };
    modal.open.mockReturnValue({ result: new Promise<void>(() => { /* pending: flag stays set */ }) });
    // First header instance reacting to requestWalletConnect(): opens + sets the flag.
    component.open();
    expect(modal.open).toHaveBeenCalledTimes(1);
    // Second header instance reacting to the same emission: flag set -> skips.
    component.open();
    expect(modal.open).toHaveBeenCalledTimes(1); // still 1, not 2 stacked dialogs
    (WalletConnectComponent as unknown as { connectModalOpen: boolean }).connectModalOpen = false; // reset for other tests
  });

  it('startXpub opens the paste form; cancelXpub returns to the list', () => {
    component.xpubValue = 'leftover';
    component.startXpub();
    expect(component.xpubMode).toBe(true);
    expect(component.xpubValue).toBe('');

    component.xpubValue = 'xpub-typed';
    component.cancelXpub();
    expect(component.xpubMode).toBe(false);
    expect(component.xpubValue).toBe('');
  });

  it('scanXpub scans the pasted key with a probe and defaults to the auto-picked funding address', async () => {
    const scan = fakeScan();
    (scanWatchOnly as jest.Mock).mockResolvedValue(scan);
    component.xpubValue = '  zpub-key  ';

    component.scanXpub();
    await tick();

    expect(scanWatchOnly).toHaveBeenCalledWith(
      expect.objectContaining({ extendedPublicKey: 'zpub-key', network: 'mainnet', probe: expect.any(Function) }),
    );
    expect(component.xpubScanResult).toBe(scan);
    // auto-picked payment (addr1) sits at scanned index 1
    expect(component.xpubPaymentIndex).toBe(1);
    expect(component.xpubConnecting).toBe(false);
  });

  it('confirmXpub connects via the SDK connectFromScan with the confirmed selection, honoring a payment override', () => {
    const scan = fakeScan();
    component.xpubScanResult = scan as never;
    // User overrides the funding address to scanned index 0 (addr0).
    component.xpubPaymentIndex = 0;
    const close = jest.spyOn(component, 'close').mockImplementation(() => undefined);

    component.confirmXpub();

    expect(walletService.connectFromScan).toHaveBeenCalledWith(
      scan,
      { ordinals: scan.ordinals, payment: scan.scanned[0].address },
    );
    expect(close).toHaveBeenCalled();
  });

  it('confirmXpub keeps the ordinals auto-pick while using the overridden payment address', () => {
    const scan = fakeScan();
    component.xpubScanResult = scan as never;
    component.xpubPaymentIndex = 1; // funding = addr1, ordinals stays addr0
    jest.spyOn(component, 'close').mockImplementation(() => undefined);

    component.confirmXpub();

    expect(walletService.connectFromScan).toHaveBeenCalledWith(
      scan,
      { ordinals: scan.ordinals, payment: scan.scanned[1].address },
    );
  });

  it('reveals the account-type selector when the SDK reports script-type-ambiguous', async () => {
    // The SDK throws WatchOnlyDeriveError with a stable `code`; the component
    // matches on code, not the human-readable message.
    (scanWatchOnly as jest.Mock).mockRejectedValue(
      Object.assign(new Error('this key prefix is ambiguous; pass scriptType'), { code: 'script-type-ambiguous' }),
    );
    component.xpubValue = 'xpub-plain';

    component.scanXpub();
    await tick();

    expect(component.xpubScriptTypeNeeded).toBe(true);
    expect(component.xpubError).toContain('account type');
    expect(component.xpubConnecting).toBe(false);
    expect(component.xpubScanResult).toBeNull();
  });

  it('surfaces any other scan error verbatim without asking for a script type', async () => {
    (scanWatchOnly as jest.Mock).mockRejectedValue(new Error('electrs unreachable'));
    component.xpubValue = 'zpub-key';

    component.scanXpub();
    await tick();

    expect(component.xpubScriptTypeNeeded).toBe(false);
    expect(component.xpubError).toBe('electrs unreachable');
  });

  it('editXpubKey returns from the review step to the paste form, keeping the key', () => {
    component.xpubValue = 'zpub-key';
    component.xpubScanResult = fakeScan() as never;
    component.xpubError = 'stale';

    component.editXpubKey();

    expect(component.xpubScanResult).toBeNull();
    expect(component.xpubError).toBeNull();
    expect(component.xpubValue).toBe('zpub-key');
  });

});

describe('WalletConnectComponent picker: platform + install-state detection', () => {

  let component: WalletConnectComponent;
  let getInstalledWallets: jest.Mock;
  let router: { url: string };

  beforeEach(() => {
    getInstalledWallets = jest.fn(() => ({ installedWallets: [], notInstalledWallets: [] }));
    router = { url: '/cat21-mint' };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: WalletService,
          useValue: {
            wallets$: of({ installedWallets: [], notInstalledWallets: [] }),
            connectedWallet$: of(null),
            walletConnectRequested$: new Subject<boolean>(),
            isMainnet$: of(true),
            networkMismatch$: of(false),
            expectedNetworkGroup: 'mainnet',
            network: 'mainnet',
            getInstalledWallets,
          },
        },
        { provide: Cat21Service, useValue: { pendingMints$: jest.fn(() => of([])) } },
        { provide: NgbModal, useValue: { open: jest.fn(), hasOpenModals: jest.fn(() => false) } },
        { provide: HttpClient, useValue: { get: jest.fn() } },
        { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn(), detectChanges: jest.fn() } },
        { provide: Router, useValue: router },
      ],
    });
    component = TestBed.runInInjectionContext(() => new WalletConnectComponent());

  });

  const buildRows = () =>
    (component as unknown as { buildPickerRows: () => unknown[] }).buildPickerRows();

  // Row shape, install-state, and the button action+label belong to the SDK's
  // walletPickerRows (tested there). Platform is the SDK's job too: it reads the
  // DEVICE from `win`, so the component passes `win` and never a platform. The
  // component's own logic is (a) hand the SDK's rows back verbatim and (b) scope
  // the picker to the capability the current route needs.
  it('delegates the picker rows to the SDK walletPickerRows, passing win and never a platform', () => {
    const rows = [{ wallet: 'xverse', label: 'Xverse', logo: 'x', installed: true, action: 'connect', actionLabel: 'Connect' }];
    (walletPickerRows as jest.Mock).mockReturnValue(rows);
    router.url = '/cat21-mint';

    expect(buildRows()).toBe(rows);
    const opts = (walletPickerRows as jest.Mock).mock.calls[0][0];
    expect(opts.win).toBe(window);
    expect(opts.currentUrl).toBe('/cat21-mint');
    // No local platform detection: deriving it here (e.g. from a viewport
    // breakpoint) is exactly what b508ec9's detectWalletPlatform(win) replaces.
    expect(opts.platform).toBeUndefined();
  });

  const lastCapability = () => {
    const calls = (walletPickerRows as jest.Mock).mock.calls;
    return calls[calls.length - 1][0].capability;
  };

  it('scopes the picker to the route capability: /inscribe needs Inscription, everything else Cat21Mint', () => {
    (walletPickerRows as jest.Mock).mockReturnValue([]);

    router.url = '/inscribe';
    buildRows();
    expect(lastCapability()).toBe(WalletCapability.Inscription);

    router.url = '/cat21-mint';
    buildRows();
    expect(lastCapability()).toBe(WalletCapability.Cat21Mint);
  });

});
