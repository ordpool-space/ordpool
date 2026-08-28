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
  walletsSupporting: jest.fn(() => []),
  capabilityOf: jest.fn(() => ({ support: 'unsupported' })),
  walletMatrixEntry: jest.fn(() => undefined),
  scanWatchOnly: jest.fn(),
}));

import { ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Subject, of, throwError } from 'rxjs';

import {
  Cat21Service,
  KnownOrdinalWallets,
  WalletPlatform,
  WalletService,
  capabilityOf,
  scanWatchOnly,
  walletMatrixEntry,
  walletsSupporting,
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
    };
    http = { get: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: WalletService, useValue: walletService },
        { provide: Cat21Service, useValue: { pendingMints$: jest.fn(() => of([])) } },
        { provide: NgbModal, useValue: { open: jest.fn() } },
        { provide: HttpClient, useValue: http },
        { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn(), detectChanges: jest.fn() } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new WalletConnectComponent());
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

  it('confirmXpub connects with the confirmed selection, honoring a payment override', () => {
    const scan = fakeScan();
    component.xpubScanResult = scan as never;
    // User overrides the funding address to scanned index 0 (addr0).
    component.xpubPaymentIndex = 0;
    const close = jest.spyOn(component, 'close').mockImplementation(() => undefined);

    component.confirmXpub();

    expect(walletService.connectFakeWallet).toHaveBeenCalledWith({
      type: 'xpub',
      ordinalsAddress: 'addr0',
      ordinalsPublicKey: 'pk0',
      paymentAddress: 'addr0',
      paymentPublicKey: 'pk0',
      signingSupported: true,
    });
    expect(close).toHaveBeenCalled();
  });

  it('confirmXpub keeps the ordinals auto-pick while using the overridden payment address', () => {
    const scan = fakeScan();
    component.xpubScanResult = scan as never;
    component.xpubPaymentIndex = 1; // funding = addr1, ordinals stays addr0
    jest.spyOn(component, 'close').mockImplementation(() => undefined);

    component.confirmXpub();

    expect(walletService.connectFakeWallet).toHaveBeenCalledWith({
      type: 'xpub',
      ordinalsAddress: 'addr0',
      ordinalsPublicKey: 'pk0',
      paymentAddress: 'addr1',
      paymentPublicKey: 'pk1',
      signingSupported: true,
    });
  });

  it('reveals the account-type selector when the SDK reports script-type-ambiguous', async () => {
    (scanWatchOnly as jest.Mock).mockRejectedValue(
      new Error('Watch-only: this key prefix (xpub/tpub) is script-type-ambiguous; pass scriptType'),
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

  it('the probe reports funded + summed sats from the address utxo endpoint', async () => {
    (scanWatchOnly as jest.Mock).mockResolvedValue(fakeScan());
    http.get.mockReturnValue(of([{ value: 100 }, { value: 250 }]));
    component.xpubValue = 'zpub-key';

    component.scanXpub();
    const probe = (scanWatchOnly as jest.Mock).mock.calls[0][0].probe as (a: string) => Promise<{ funded: boolean; fundedSats: number }>;
    const result = await probe('bc1pexample');

    expect(http.get).toHaveBeenCalledWith(expect.stringContaining('/api/address/bc1pexample/utxo'));
    expect(result).toEqual({ funded: true, fundedSats: 350 });
  });
});

describe('WalletConnectComponent picker: platform + install-state detection', () => {

  let component: WalletConnectComponent;
  let getInstalledWallets: jest.Mock;

  beforeEach(() => {
    getInstalledWallets = jest.fn(() => ({ installedWallets: [], notInstalledWallets: [] }));
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
        { provide: NgbModal, useValue: { open: jest.fn() } },
        { provide: HttpClient, useValue: { get: jest.fn() } },
        { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn(), detectChanges: jest.fn() } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new WalletConnectComponent());

    // A hidden wallet (Phantom) and a normal one (Xverse), both mint-capable.
    (KnownOrdinalWallets as Record<string, unknown>).phantom = {
      label: 'Phantom', logo: 'p.png', downloadLink: 'dl-p', hiddenFromPicker: true,
    };
    (KnownOrdinalWallets as Record<string, unknown>).xverse = {
      label: 'Xverse', logo: 'x.png', downloadLink: 'dl-x', hiddenFromPicker: false,
    };
    (walletsSupporting as jest.Mock).mockReturnValue([
      { wallet: 'phantom', signingMode: 'injected' },
      { wallet: 'xverse', signingMode: 'injected' },
    ]);
    // Non-null matrix entry so buildWalletInfoPopover returns a popover (row kept).
    (walletMatrixEntry as jest.Mock).mockReturnValue({ label: 'W', platforms: [], signingMode: 'injected', note: undefined });
    (capabilityOf as jest.Mock).mockReturnValue({ support: 'proven' });
  });

  const setPlatform = (p: WalletPlatform) =>
    ((component as unknown as { platform: WalletPlatform }).platform = p);
  const buildRows = () =>
    (component as unknown as { buildPickerRows: () => { wallet: string; state: string }[] }).buildPickerRows();

  it('desktop picker drops hiddenFromPicker wallets', () => {
    setPlatform(WalletPlatform.Desktop);
    expect(buildRows().map((r) => r.wallet)).toEqual(['xverse']);
  });

  it('mobile picker keeps hiddenFromPicker wallets (Phantom/Binance belong there)', () => {
    setPlatform(WalletPlatform.Mobile);
    expect(buildRows().map((r) => r.wallet)).toEqual(['phantom', 'xverse']);
  });

  it('mobile: a DETECTED hidden wallet resolves to installed via the unfiltered getInstalledWallets, not the stripped wallets$', () => {
    setPlatform(WalletPlatform.Mobile);
    // Phantom's provider IS injected in its mobile in-app browser:
    // getInstalledWallets (unfiltered) lists it; wallets$ would have stripped it.
    getInstalledWallets.mockReturnValue({ installedWallets: [{ type: 'phantom' }], notInstalledWallets: [] });
    const phantom = buildRows().find((r) => r.wallet === 'phantom');
    expect(phantom?.state).toBe('installed');
  });

  it('desktop: an installed normal wallet resolves to installed from getInstalledWallets', () => {
    setPlatform(WalletPlatform.Desktop);
    getInstalledWallets.mockReturnValue({ installedWallets: [{ type: 'xverse' }], notInstalledWallets: [] });
    const xverse = buildRows().find((r) => r.wallet === 'xverse');
    expect(xverse?.state).toBe('installed');
  });
});
