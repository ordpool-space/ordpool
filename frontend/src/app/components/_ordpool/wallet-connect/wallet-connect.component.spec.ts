/**
 * Tests the watch-only (xpub) connect flow on the wallet picker. The SUT is
 * the component's logic; its collaborators (the SDK WalletService, HttpClient,
 * NgbModal) are mocked. `ordpool-sdk` is mocked at the module boundary both to
 * inject a stub WalletService and to dodge the sats-connect ESM chain, exactly
 * as the sibling cat21-mint spec does. The component is built via
 * runInInjectionContext so we exercise the connect logic without compiling the
 * heavy template.
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
}));

import { ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Subject, of, throwError } from 'rxjs';

import { Cat21Service, WalletService } from 'ordpool-sdk';

import { WalletConnectComponent } from './wallet-connect.component';

describe('WalletConnectComponent watch-only (xpub) flow', () => {

  let walletService: {
    wallets$: unknown;
    connectedWallet$: unknown;
    walletConnectRequested$: Subject<boolean>;
    isMainnet$: unknown;
    networkMismatch$: unknown;
    expectedNetworkGroup: string;
    connectXpub: jest.Mock;
  };
  let http: { get: jest.Mock };
  let component: WalletConnectComponent;

  beforeEach(() => {
    walletService = {
      wallets$: of({ installedWallets: [], notInstalledWallets: [] }),
      connectedWallet$: of(null),
      walletConnectRequested$: new Subject<boolean>(),
      isMainnet$: of(true),
      networkMismatch$: of(false),
      expectedNetworkGroup: 'mainnet',
      connectXpub: jest.fn(),
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

  it('connectXpub passes the pasted key + a probe to the SDK and closes on success', () => {
    walletService.connectXpub.mockReturnValue(of({ type: 'xpub' }));
    const close = jest.spyOn(component, 'close').mockImplementation(() => undefined);
    component.xpubValue = '  zpub-key  ';

    component.connectXpub();

    expect(walletService.connectXpub).toHaveBeenCalledWith(
      expect.objectContaining({ extendedPublicKey: 'zpub-key', probe: expect.any(Function) }),
    );
    expect(close).toHaveBeenCalled();
    expect(component.xpubConnecting).toBe(false);
  });

  it('reveals the account-type selector when the SDK reports script-type-ambiguous', () => {
    walletService.connectXpub.mockReturnValue(
      throwError(() => new Error('Watch-only: this key prefix (xpub/tpub) is script-type-ambiguous; pass scriptType')),
    );
    component.xpubValue = 'xpub-plain';

    component.connectXpub();

    expect(component.xpubScriptTypeNeeded).toBe(true);
    expect(component.xpubError).toContain('account type');
    expect(component.xpubConnecting).toBe(false);
  });

  it('surfaces any other connect error verbatim without asking for a script type', () => {
    walletService.connectXpub.mockReturnValue(throwError(() => new Error('electrs unreachable')));
    component.xpubValue = 'zpub-key';

    component.connectXpub();

    expect(component.xpubScriptTypeNeeded).toBe(false);
    expect(component.xpubError).toBe('electrs unreachable');
  });

  it('the probe reports funded + summed sats from the address utxo endpoint', async () => {
    walletService.connectXpub.mockReturnValue(of({ type: 'xpub' }));
    jest.spyOn(component, 'close').mockImplementation(() => undefined);
    http.get.mockReturnValue(of([{ value: 100 }, { value: 250 }]));
    component.xpubValue = 'zpub-key';

    component.connectXpub();
    const probe = walletService.connectXpub.mock.calls[0][0].probe as (a: string) => Promise<{ funded: boolean; fundedSats: number }>;
    const result = await probe('bc1pexample');

    expect(http.get).toHaveBeenCalledWith(expect.stringContaining('/api/address/bc1pexample/utxo'));
    expect(result).toEqual({ funded: true, fundedSats: 350 });
  });
});
