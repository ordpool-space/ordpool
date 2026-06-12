/**
 * The ordpool-sdk reaches into sats-connect → @sats-connect/core →
 * bitcoin-address-validation → base58-js — a chain of ESM-only deps
 * that Jest's CJS-mode runner can't load. Mock the whole module at the
 * spec level so the component's `import { ... } from 'ordpool-sdk'`
 * resolves to lightweight class stubs. The component's runtime DI
 * targets the same class identities we provide via TestBed, so the
 * wiring stays intact.
 */
jest.mock('ordpool-sdk', () => {
  return {
    AUTO_SCAN_MAX_VALUE_SAT: 50_000,
    KnownOrdinalWalletType: {
      xverse: 'xverse' as const,
      leather: 'leather' as const,
      unisat: 'unisat' as const,
    },
    // Token-only classes — empty bodies are fine because TestBed
    // replaces them via { provide: X, useValue: stub }.
    Cat21ApiService: class Cat21ApiService {},
    Cat21MintOrchestrator: class Cat21MintOrchestrator {},
    UtxoContentScanner: class UtxoContentScanner {},
    WalletService: class WalletService {},
  };
});

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';

import {
  AUTO_SCAN_MAX_VALUE_SAT,
  Cat21ApiService,
  Cat21MintOrchestrator,
  KnownOrdinalWalletType,
  UtxoContentScanner,
  WalletService,
} from 'ordpool-sdk';

// Type-only shims for the mocked types we use in fixtures. Real shapes
// live in ordpool-sdk but the mock above doesn't carry them; we keep
// them minimal here.
type WalletInfo = {
  type: string;
  label: string;
  ordinalsAddress: string;
  paymentAddress: string;
  paymentPublicKey: string;
  ordinalsPublicKey: string;
  signingSupported?: boolean;
  onChainOrdinals?: boolean;
};
type TxnOutput = { txid: string; vout: number; value: number; status: { confirmed: boolean; block_height: number; block_hash: string; block_time: number } };
type SimulateTransactionResult = { finalTransactionFee: bigint; amountToRecipient: bigint; changeAmount: bigint; vsize: number; tx: object };
type UtxoSimulation = { utxo: TxnOutput; simulation: SimulateTransactionResult | null; insufficient: boolean };
type RecommendedFees = { fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number; minimumFee: number };
type UtxoScanState =
  | { kind: 'not-scanned' }
  | { kind: 'scanning' }
  | { kind: 'scanned-clean' }
  | { kind: 'scanned-with-assets'; content: { outpoint: string; inscriptionIds: string[]; runes: object | null; catIds: string[] } }
  | { kind: 'scan-failed'; message: string };

import { Cat21MintComponent } from './cat21-mint.component';
import { SeoService } from '../../../services/seo.service';
import { StateService } from '../../../services/state.service';

// -------------------------------------------------------------------------
// Fixture builders
// -------------------------------------------------------------------------

function utxo(over: Partial<TxnOutput> = {}): TxnOutput {
  return {
    txid: 'a'.repeat(64),
    vout: 0,
    value: 50_000,
    status: { confirmed: true, block_height: 800_000, block_hash: 'b'.repeat(64), block_time: 1_700_000_000 },
    ...over,
  } as TxnOutput;
}

function simulation(over: Partial<SimulateTransactionResult> = {}): SimulateTransactionResult {
  return {
    finalTransactionFee: 200n,
    amountToRecipient: 546n,
    changeAmount: 49_254n,
    vsize: 150,
    tx: {} as unknown as SimulateTransactionResult['tx'],
    ...over,
  } as SimulateTransactionResult;
}

function wallet(over: Partial<WalletInfo> = {}): WalletInfo {
  // Cast to `any` because the real WalletInfo from node_modules carries
  // ~10 fields we don't need to mirror in fixtures (signingSupported,
  // onChainOrdinals, etc.). The component only reads address fields +
  // type.
  return {
    type: KnownOrdinalWalletType.xverse,
    label: 'Xverse',
    ordinalsAddress: 'bc1p-ordinals-addr',
    paymentAddress: '3-payment-addr',
    paymentPublicKey: '02' + 'aa'.repeat(32),
    ordinalsPublicKey: '02' + 'bb'.repeat(32),
    ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function fees(over: Partial<RecommendedFees> = {}): RecommendedFees {
  return {
    fastestFee: 5,
    halfHourFee: 3,
    hourFee: 1,
    economyFee: 1,
    minimumFee: 1,
    ...over,
  } as RecommendedFees;
}

class OrchestratorStub {
  readonly connectedWallet: WritableSignal<WalletInfo | null> = signal(null);
  readonly state: WritableSignal<'idle' | 'loading-utxos' | 'ready' | 'minting' | 'success' | 'error'> = signal('idle');
  readonly errorMessage: WritableSignal<string | null> = signal(null);
  readonly successTxId: WritableSignal<string | null> = signal(null);
  readonly feeRate: WritableSignal<number | null> = signal(null);
  readonly selectedUtxo: WritableSignal<TxnOutput | null> = signal(null);

  readonly simulationsSubject = new BehaviorSubject<UtxoSimulation[]>([]);
  readonly simulations$ = this.simulationsSubject.asObservable();

  readonly recommendedFeesSubject = new Subject<RecommendedFees>();
  readonly recommendedFees$ = this.recommendedFeesSubject.asObservable();

  readonly mintReturn$ = new Subject<{ txId: string }>();
  mintImpl: () => Observable<{ txId: string }> = () => this.mintReturn$.asObservable();

  setFeeRate = jest.fn((r: number) => this.feeRate.set(r));
  setSelectedUtxo = jest.fn((u: TxnOutput | null) => this.selectedUtxo.set(u));
  mint = jest.fn(() => this.mintImpl());
  reset = jest.fn();
}

class ScannerStub {
  readonly statesSubject = new BehaviorSubject<ReadonlyMap<string, UtxoScanState>>(new Map());
  readonly states$ = this.statesSubject.asObservable();
  scan = jest.fn((_: string) => of<UtxoScanState>({ kind: 'scanned-clean' }));
  autoScan = jest.fn((_: unknown[]) => undefined);
  getState = jest.fn((outpoint: string): UtxoScanState => this.statesSubject.value.get(outpoint) ?? { kind: 'not-scanned' });

  setStates(states: Iterable<[string, UtxoScanState]>): void {
    this.statesSubject.next(new Map(states));
  }
}

class WalletServiceStub {
  readonly connectedWalletSubject = new BehaviorSubject<WalletInfo | null>(null);
  readonly connectedWallet$ = this.connectedWalletSubject.asObservable();
  readonly wallets$ = new BehaviorSubject({ installedWallets: [], notInstalledWallets: [] }).asObservable();
  connectWallet = jest.fn();
  disconnectWallet = jest.fn();
  requestWalletConnect = jest.fn();
}

class StateServiceStub {
  readonly recommendedFeesSubject = new Subject<RecommendedFees>();
  readonly recommendedFees$ = this.recommendedFeesSubject.asObservable();
}

class Cat21ApiServiceStub {
  getStatus = jest.fn(() => of(null));
  getLatestCatNumbers = jest.fn((_: number) => of({ catNumbers: [] as number[] }));
  getCatImageUrl = jest.fn((n: number) => `/api/cat/${n}/image.svg`);
}

class SeoServiceStub {
  setTitle = jest.fn();
  resetTitle = jest.fn();
  setDescription = jest.fn();
  resetDescription = jest.fn();
}

// -------------------------------------------------------------------------

describe('Cat21MintComponent (ordpool.space /cat21-mint)', () => {
  let orch: OrchestratorStub;
  let scanner: ScannerStub;
  let wallets: WalletServiceStub;
  let stateSvc: StateServiceStub;
  let cat21: Cat21ApiServiceStub;
  let fixture: ComponentFixture<Cat21MintComponent>;
  let component: Cat21MintComponent;

  // Same minimal sentinel template as the cat21.space spec uses. The
  // production template depends on a stack of upstream mempool
  // components (app-fees-box-clickable, app-clipboard, app-fiat, …)
  // we don't want to drag into a unit test; the component logic is
  // exercised through its public surface either way.
  const TEST_TEMPLATE = `
    @if (!(connectedWallet$ | async)) {
      <div data-testid="mint-cta">connect</div>
    } @else if (utxoLoading()) {
      <div data-testid="mint-loading">loading</div>
    } @else if (utxoError()) {
      <div data-testid="utxo-error">{{ utxoError() }}</div>
    } @else if (mintCat21Success()) {
      <div data-testid="mint-success">{{ mintCat21Success()?.txId }}</div>
    } @else {
      <div data-testid="ready">
        <span data-testid="funding">{{ recommendedFundingSats }}</span>
        <span data-testid="single-addr">{{ isSingleAddressWallet((connectedWallet$ | async) || undefined) }}</span>
        <span data-testid="bucket">{{ selectedPaymentOutput?.bucket }}</span>
        @if (mintCat21Error()) {<span data-testid="mint-error">{{ mintCat21Error() }}</span>}
      </div>
    }
  `;

  async function configure(): Promise<void> {
    orch = new OrchestratorStub();
    scanner = new ScannerStub();
    wallets = new WalletServiceStub();
    stateSvc = new StateServiceStub();
    cat21 = new Cat21ApiServiceStub();
    await TestBed.configureTestingModule({
      declarations: [Cat21MintComponent],
      providers: [
        { provide: Cat21MintOrchestrator, useValue: orch },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: wallets },
        { provide: StateService, useValue: stateSvc },
        { provide: Cat21ApiService, useValue: cat21 },
        { provide: SeoService, useValue: new SeoServiceStub() },
      ],
    })
      .overrideComponent(Cat21MintComponent, { set: { template: TEST_TEMPLATE } })
      .compileComponents();
    fixture = TestBed.createComponent(Cat21MintComponent);
    component = fixture.componentInstance;
    // Sync wallet to connectedWallet$ BEFORE first CD so the template
    // doesn't race the orchestrator's own bridge signal.
    wallets.connectedWalletSubject.next(null);
    fixture.detectChanges();
  }

  function pushRows(rows: { u: TxnOutput; scan: UtxoScanState }[]): void {
    scanner.setStates(rows.map((r) => [`${r.u.txid}:${r.u.vout}`, r.scan]));
    orch.simulationsSubject.next(rows.map((r) => ({ utxo: r.u, simulation: simulation(), insufficient: false })));
    // The auto-pick + autoScan side effects live in paymentOutputs$'s
    // `tap` operator and only fire when the observable is subscribed.
    // The slimmed test template doesn't bind the async pipe, so force
    // a manual subscribe here to drive the same side effects.
    component.paymentOutputs$.subscribe().unsubscribe();
    fixture.detectChanges();
  }

  function connectXverse(): void {
    const w = wallet();
    wallets.connectedWalletSubject.next(w);
    orch.connectedWallet.set(w);
    orch.state.set('ready');
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await configure();
  });

  // -------------------------------------------------------------------
  // A. Disconnected wallet
  // -------------------------------------------------------------------

  describe('A. wallet not connected', () => {
    it('A1: renders connect CTA, no ready block', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="mint-cta"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="ready"]')).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // B. Loading state — orchestrator.state = 'loading-utxos'
  // -------------------------------------------------------------------

  describe('B. wallet connected, loading UTXOs', () => {
    it('B1: utxoLoading() projects state==="loading-utxos"', () => {
      connectXverse();
      orch.state.set('loading-utxos');
      fixture.detectChanges();
      expect(component.utxoLoading()).toBe(true);
      expect(fixture.nativeElement.querySelector('[data-testid="mint-loading"]')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------
  // C. Error attribution
  // -------------------------------------------------------------------

  describe('C. error attribution (utxo-load vs mint)', () => {
    it('C1: error before mint attempt → utxoError populated', () => {
      connectXverse();
      orch.state.set('error');
      orch.errorMessage.set('utxo fetch failed');
      fixture.detectChanges();
      expect(component.utxoError()).toBe('utxo fetch failed');
      expect(component.mintCat21Error()).toBe('');
    });

    it('C2: error after mint attempt → mintCat21Error populated', () => {
      connectXverse();
      orch.feeRate.set(5);
      pushRows([{ u: utxo(), scan: { kind: 'scanned-clean' } }]);
      orch.mintImpl = () => throwError(() => new Error('user cancelled'));
      component.mintCat21(wallet() as any);
      orch.state.set('error');
      orch.errorMessage.set('user cancelled');
      fixture.detectChanges();
      expect(component.mintCat21Error()).toBe('user cancelled');
      expect(component.utxoError()).toBe('');
    });
  });

  // -------------------------------------------------------------------
  // D. recommendedFundingSats — dynamic floor on cfeeRate
  // -------------------------------------------------------------------

  describe('D. recommendedFundingSats — dynamic floor', () => {
    it('D1: default feeRate=1 → 800 sat', () => {
      expect(component.recommendedFundingSats).toBe(800);
    });

    it('D2: feeRate=5 → 1600 sat (546 + 200×5 = 1546 → 1600)', () => {
      component.cfeeRate.setValue(5);
      expect(component.recommendedFundingSats).toBe(1600);
    });

    it('D3: feeRate=100 → 20600 sat', () => {
      component.cfeeRate.setValue(100);
      expect(component.recommendedFundingSats).toBe(20600);
    });
  });

  // -------------------------------------------------------------------
  // E. Bucket-driven auto-pick (clean → unscanned → failed; never assets)
  // -------------------------------------------------------------------

  describe('E. auto-pick priority', () => {
    const big = (v: number) => utxo({ txid: String(v).repeat(64).slice(0, 64), value: v });

    beforeEach(fakeAsync(() => {
      connectXverse();
      orch.feeRate.set(5);
      tick();
    }));

    it('E1: all clean → largest clean wins', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: big(20_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(component.selectedPaymentOutput!.paymentOutput.value).toBe(80_000);
      expect(orch.selectedUtxo()!.value).toBe(80_000);
    });

    it('E2: assets is the biggest → clean below it wins', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'x:0', inscriptionIds: ['i'], runes: null, catIds: [] } } },
        { u: big(20_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(component.selectedPaymentOutput!.paymentOutput.value).toBe(20_000);
    });

    it('E3: all unscanned → largest unscanned', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'not-scanned' } },
        { u: big(20_000), scan: { kind: 'not-scanned' } },
      ]);
      expect(component.selectedPaymentOutput!.paymentOutput.value).toBe(80_000);
    });

    it('E4: mixed clean+unscanned+assets → clean wins', () => {
      pushRows([
        { u: big(90_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'a:0', inscriptionIds: ['i'], runes: null, catIds: [] } } },
        { u: big(70_000), scan: { kind: 'not-scanned' } },
        { u: big(5_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(component.selectedPaymentOutput!.paymentOutput.value).toBe(5_000);
    });

    it('E5: all assets → no auto-pick (selectedPaymentOutput undefined)', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'a:0', inscriptionIds: ['i'], runes: null, catIds: [] } } },
        { u: big(20_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'b:0', inscriptionIds: [], runes: { RUNE: {} }, catIds: [] } } },
      ]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(orch.selectedUtxo()).toBeNull();
    });

    it('E6: failed + unscanned → unscanned wins', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'scan-failed', message: 'oops' } },
        { u: big(20_000), scan: { kind: 'not-scanned' } },
      ]);
      expect(component.selectedPaymentOutput!.paymentOutput.value).toBe(20_000);
    });

    it('E7: only failed → largest failed picked (no safer fallback)', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'scan-failed', message: 'a' } },
        { u: big(20_000), scan: { kind: 'scan-failed', message: 'b' } },
      ]);
      expect(component.selectedPaymentOutput!.paymentOutput.value).toBe(80_000);
    });

    it('E8: user-explicit pick survives a row re-emit if still present', () => {
      const smaller = big(20_000);
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: smaller, scan: { kind: 'scanned-clean' } },
      ]);
      component.selectPaymentOutput({ paymentOutput: smaller, simulation: simulation(), scan: { kind: 'scanned-clean' }, bucket: 'clean' } as any);
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: smaller, scan: { kind: 'scanned-clean' } },
      ]);
      expect(component.selectedPaymentOutput!.paymentOutput.value).toBe(20_000);
    });

    it('E9: user pick disappears → re-picks per priority', () => {
      const gone = big(20_000);
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: gone, scan: { kind: 'scanned-clean' } },
      ]);
      component.selectPaymentOutput({ paymentOutput: gone, simulation: simulation(), scan: { kind: 'scanned-clean' }, bucket: 'clean' } as any);
      pushRows([{ u: big(80_000), scan: { kind: 'scanned-clean' } }]);
      expect(component.selectedPaymentOutput!.paymentOutput.value).toBe(80_000);
    });

    it('E10: empty row list → selectedPaymentOutput cleared', () => {
      pushRows([{ u: big(80_000), scan: { kind: 'scanned-clean' } }]);
      // Drive paymentOutputs$ for the empty re-emit too — the auto-pick
      // tap also handles the "clear on empty" branch.
      orch.simulationsSubject.next([]);
      component.paymentOutputs$.subscribe().unsubscribe();
      fixture.detectChanges();
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(orch.selectedUtxo()).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // F. Scanner integration
  // -------------------------------------------------------------------

  describe('F. scanner integration', () => {
    beforeEach(() => {
      connectXverse();
      orch.feeRate.set(5);
      fixture.detectChanges();
    });

    it('F1: autoScan called with the {txid, vout, value} list on every row change', () => {
      pushRows([
        { u: utxo({ txid: 'a'.repeat(64), vout: 0, value: 5_000 }), scan: { kind: 'not-scanned' } },
        { u: utxo({ txid: 'b'.repeat(64), vout: 1, value: 90_000 }), scan: { kind: 'not-scanned' } },
      ]);
      expect(scanner.autoScan).toHaveBeenCalled();
      const calls = (scanner.autoScan as jest.Mock).mock.calls;
      const lastCall = calls[calls.length - 1][0] as { value: number }[];
      expect(lastCall.map((u) => u.value).sort()).toEqual([5_000, 90_000]);
    });

    it('F2: scanRow(row) delegates to scanner.scan with the outpoint', () => {
      const u = utxo({ txid: 'c'.repeat(64), vout: 7 });
      pushRows([{ u, scan: { kind: 'not-scanned' } }]);
      component.scanRow({ paymentOutput: u, simulation: simulation(), scan: { kind: 'not-scanned' }, bucket: 'unscanned' } as any);
      expect(scanner.scan).toHaveBeenCalledWith(`${'c'.repeat(64)}:7`);
    });
  });

  // -------------------------------------------------------------------
  // G. Bucket label rendering
  // -------------------------------------------------------------------

  describe('G. bucket labels on selectedPaymentOutput', () => {
    beforeEach(() => {
      connectXverse();
      orch.feeRate.set(5);
      fixture.detectChanges();
    });

    const u = utxo();

    it.each<[UtxoScanState['kind'], string]>([
      ['not-scanned', 'unscanned'],
      ['scanned-clean', 'clean'],
      ['scan-failed', 'failed'],
    ])('G1: scan kind %s → bucket %s (auto-picked)', (kind, bucket) => {
      const scan = kind === 'scan-failed'
        ? { kind: 'scan-failed' as const, message: 'x' }
        : { kind } as UtxoScanState;
      pushRows([{ u, scan }]);
      expect(component.selectedPaymentOutput!.bucket).toBe(bucket);
    });

    it('G2: scanned-with-assets requires explicit user pick', () => {
      const scan: UtxoScanState = { kind: 'scanned-with-assets', content: { outpoint: 'x:0', inscriptionIds: ['x'], runes: null, catIds: [] } };
      pushRows([{ u, scan }]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      component.selectPaymentOutput({ paymentOutput: u, simulation: simulation(), scan, bucket: 'assets' } as any);
      expect(component.selectedPaymentOutput!.bucket).toBe('assets');
    });

    it('G3: scanning row never auto-picks but is selectable', () => {
      pushRows([{ u, scan: { kind: 'scanning' } }]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      component.selectPaymentOutput({ paymentOutput: u, simulation: simulation(), scan: { kind: 'scanning' }, bucket: 'scanning' } as any);
      expect(component.selectedPaymentOutput!.bucket).toBe('scanning');
    });
  });

  // -------------------------------------------------------------------
  // H. isSingleAddressWallet detection
  // -------------------------------------------------------------------

  describe('H. isSingleAddressWallet', () => {
    it('H1: same addresses → true', () => {
      expect(component.isSingleAddressWallet(wallet({ ordinalsAddress: 'x', paymentAddress: 'x' }) as any)).toBe(true);
    });

    it('H2: different addresses → false', () => {
      expect(component.isSingleAddressWallet(wallet({ ordinalsAddress: 'a', paymentAddress: 'b' }) as any)).toBe(false);
    });

    it('H3: null / undefined → false', () => {
      expect(component.isSingleAddressWallet(null)).toBe(false);
      expect(component.isSingleAddressWallet(undefined)).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // I. ngOnInit — auto-seed fastestFee from recommendedFees$
  // -------------------------------------------------------------------

  describe('I. ngOnInit auto-seed fastestFee', () => {
    it('I1: first recommendedFees emission sets cfeeRate to fastestFee', () => {
      stateSvc.recommendedFeesSubject.next(fees({ fastestFee: 7, hourFee: 2 }));
      expect(component.cfeeRate.value).toBe(7);
      expect(orch.setFeeRate).toHaveBeenCalledWith(7);
    });

    it('I2: minRequiredFee is set to hourFee', () => {
      stateSvc.recommendedFeesSubject.next(fees({ hourFee: 4 }));
      expect(component.minRequiredFee).toBe(4);
    });

    it('I3: typing a new fee rate forwards to the orchestrator', () => {
      stateSvc.recommendedFeesSubject.next(fees({ fastestFee: 5, hourFee: 1 }));
      orch.setFeeRate.mockClear();
      component.cfeeRate.setValue(2);
      expect(orch.setFeeRate).toHaveBeenLastCalledWith(2);
    });
  });

  // -------------------------------------------------------------------
  // J. updateMinRequiredFee gate
  // -------------------------------------------------------------------

  describe('J. updateMinRequiredFee', () => {
    it('J1: raises validator floor; below-floor fee is bumped up to it', () => {
      component.cfeeRate.setValue(2);
      component.updateMinRequiredFee(10);
      expect(component.minRequiredFee).toBe(10);
      expect(component.cfeeRate.value).toBe(10);
    });

    it('J2: 0 disables the floor entirely', () => {
      component.cfeeRate.setValue(0.5);
      component.updateMinRequiredFee(0);
      expect(component.minRequiredFee).toBe(0);
      // 0.5 stays — the validator no longer rejects it
      expect(component.cfeeRate.value).toBe(0.5);
      expect(component.cfeeRate.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // K. Mint command flow
  // -------------------------------------------------------------------

  describe('K. mintCat21()', () => {
    beforeEach(() => {
      connectXverse();
      orch.feeRate.set(5);
      pushRows([{ u: utxo(), scan: { kind: 'scanned-clean' } }]);
    });

    it('K1: mintCat21() invokes orchestrator.mint', () => {
      component.mintCat21(wallet() as any);
      expect(orch.mint).toHaveBeenCalledTimes(1);
    });

    it('K2: mintCat21() error is swallowed (no throw)', () => {
      orch.mintImpl = () => throwError(() => new Error('user cancelled'));
      expect(() => component.mintCat21(wallet() as any)).not.toThrow();
    });

    it('K3: error after mintCat21 attributes to mintCat21Error not utxoError', () => {
      component.mintCat21(wallet() as any);
      orch.state.set('error');
      orch.errorMessage.set('cancelled');
      fixture.detectChanges();
      expect(component.mintCat21Error()).toBe('cancelled');
      expect(component.utxoError()).toBe('');
    });
  });

  // -------------------------------------------------------------------
  // L. Success state
  // -------------------------------------------------------------------

  describe('L. mintCat21Success', () => {
    it('L1: success state + txId → mintCat21Success returns {txId}', () => {
      connectXverse();
      orch.state.set('success');
      orch.successTxId.set('deadbeef'.repeat(8));
      fixture.detectChanges();
      expect(component.mintCat21Success()).toEqual({ txId: 'deadbeef'.repeat(8) });
      expect(fixture.nativeElement.querySelector('[data-testid="mint-success"]')!.textContent).toContain('deadbeef'.repeat(8));
    });

    it('L2: success without txId → undefined', () => {
      connectXverse();
      orch.state.set('success');
      orch.successTxId.set(null);
      fixture.detectChanges();
      expect(component.mintCat21Success()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // M. Helpers
  // -------------------------------------------------------------------

  describe('M. helpers', () => {
    it('M1: runeNames extracts keys; null runes → empty array', () => {
      expect(component.runeNames({ outpoint: 'x:0', inscriptionIds: [], runes: null, catIds: [] })).toEqual([]);
      expect(component.runeNames({ outpoint: 'x:0', inscriptionIds: [], runes: { ALPHA: {}, BETA: {} }, catIds: [] }).sort()).toEqual(['ALPHA', 'BETA']);
    });

    it('M2: autoScanThreshold matches the SDK constant', () => {
      expect(component.autoScanThreshold).toBe(AUTO_SCAN_MAX_VALUE_SAT);
    });

    it('M3: toNumber converts bigint → number', () => {
      expect(component.toNumber(0n)).toBe(0);
      expect(component.toNumber(1234n)).toBe(1234);
    });

    it('M4: smallUtxoWarningThreshold is 10,000 sat', () => {
      expect(component.smallUtxoWarningThreshold).toBe(10_000);
    });

    it('M5: ordReviewBase / cat21OrdReviewBase point at our ord instances', () => {
      expect(component.ordReviewBase).toBe('https://ord.ordpool.space');
      expect(component.cat21OrdReviewBase).toBe('https://ord.cat21.space');
    });
  });
});
