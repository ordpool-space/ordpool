/**
 * The component runs against the REAL SDK: `ordpool-sdk/core` is the same code
 * as the main entry minus the stateful service classes, and loads without the
 * wallet connectors' ESM chain that Jest's CJS runner cannot take. The real
 * `Cat21MintOrchestrator`, funding policy, fee simulator, buckets, caveat and
 * candidate-fee classifier all run here, so a change to any of them reaches
 * these assertions.
 *
 * Faked, and only these, because each is network IO or the wallet:
 * - electrs: the `Cat21Service.getUtxos` port (the `utxos` array)
 * - the content scan: the `UtxoContentScanner.classify` port (the `verdicts`
 *   map, clean when unlisted) handed to the orchestrator, plus its `states$`
 *   stream that drives the picker's per-row bucket
 * - the rune-etching lookup (`lookupRuneEtching`)
 * - the wallet: `orchestrator.mint` (signing + broadcast)
 * The three service classes are DI tokens only; TestBed supplies the doubles.
 *
 * Snapshots only the wallet can produce (minting progress, a success txid, a
 * mint rejection, the SDK's per-coin candidateFees / resolved verdict) are set
 * through `emit`, whose base is the REAL orchestrator's current snapshot and
 * whose override is typed `Partial<MintSnapshot>`, so a renamed or removed SDK
 * field fails here.
 */
jest.mock('ordpool-sdk', () => {
  const core = jest.requireActual('ordpool-sdk/core');
  // The auto-scan threshold lives beside the stateful scanner, outside /core;
  // read the real constant from that module rather than restating it.
  const scannerModule = jest.requireActual(
    require('path').join(require.resolve('ordpool-sdk/core'), '..', 'cat21-mint', 'utxo-content-scanner.service.js'),
  );
  return {
    ...core,
    AUTO_SCAN_MAX_VALUE_SAT: scannerModule.AUTO_SCAN_MAX_VALUE_SAT,
    // Token-only classes — TestBed replaces them via { provide: X, useValue }.
    Cat21ApiService: class Cat21ApiService {},
    Cat21Service: class Cat21Service {},
    UtxoContentScanner: class UtxoContentScanner {},
    WalletService: class WalletService {},
    // IO: the rune-etching lookup. Defaults to 'unavailable' (no link,
    // deterministic) so panel-render tests stay stable; F3/F4 spy on it.
    lookupRuneEtching: jest.fn(async () => ({ kind: 'unavailable' as const })),
    // Observed, not replaced: the real clamp-and-delegate helper runs and the
    // D-block reads the rate it was handed (the SDK owns the vsize number).
    calculateRecommendedFundingSats: jest.fn(core.calculateRecommendedFundingSats),
  };
});

import * as fs from 'fs';
import * as path from 'path';
import type { WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';

import { secp256k1 } from '@noble/curves/secp256k1';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import {
  AUTO_SCAN_MAX_VALUE_SAT, Cat21ApiService, Cat21MintOrchestrator, Cat21Service, KnownOrdinalWalletType,
  calculateRecommendedFundingSats, lookupRuneEtching, UtxoContentScanner, WalletService, singleAddressCaveat,
  type MintSnapshot, type RecommendedFees, type SimulateTransactionResult, type TxnOutput, type UtxoAssetDetail,
  type UtxoClassification, type UtxoScanBucket, type UtxoScanState, type WalletInfo,
} from 'ordpool-sdk';
import { bitcoinNetwork, cat21Config } from '@app/services/ordinals/sdk-tokens';

import { Cat21MintComponent, ViableSimulation } from './cat21-mint.component';
import { SeoService } from '../../../services/seo.service';
import { StateService } from '../../../services/state.service';

// -------------------------------------------------------------------------
// Real keys, so the real simulator and funding policy accept the wallet.
// -------------------------------------------------------------------------

const PAYMENT_PRIV = new Uint8Array(32).fill(1);
const ORDINALS_PRIV = new Uint8Array(32).fill(2);
const PAYMENT_PUB = secp256k1.getPublicKey(PAYMENT_PRIV, true);
const ORDINALS_PUB = secp256k1.getPublicKey(ORDINALS_PRIV, true);
const PAYMENT_ADDRESS = btc.p2wpkh(PAYMENT_PUB).address as string;
const ORDINALS_ADDRESS = btc.p2tr(ORDINALS_PUB.slice(1)).address as string;

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
  };
}

function simulation(over: Partial<SimulateTransactionResult> = {}): SimulateTransactionResult {
  return {
    finalTransactionFee: 200n,
    amountToRecipient: 546n,
    singleInputAmount: 50_000n,
    changeAmount: 49_254n,
    vsize: 150,
    tx: {} as SimulateTransactionResult['tx'],
    ...over,
  };
}

function wallet(over: Partial<WalletInfo> = {}): WalletInfo {
  return {
    type: KnownOrdinalWalletType.xverse,
    ordinalsAddress: ORDINALS_ADDRESS,
    paymentAddress: PAYMENT_ADDRESS,
    paymentPublicKey: hex.encode(PAYMENT_PUB),
    ordinalsPublicKey: hex.encode(ORDINALS_PUB),
    signingSupported: true,
    ...over,
  } as WalletInfo;
}

function fees(over: Partial<RecommendedFees> = {}): RecommendedFees {
  return { fastestFee: 5, halfHourFee: 3, hourFee: 1, economyFee: 1, minimumFee: 1, ...over };
}

const outpoint = (u: TxnOutput) => `${u.txid}:${u.vout}`;

/** An `AnnotatedFundingUtxo`: a coin carrying the SDK's content bucket (+ assets),
 *  the shape `fundingRecommendation.candidates`/`recommended` hold. */
type Annotated = TxnOutput & { bucket: UtxoScanBucket; assets?: UtxoAssetDetail };
function annotatedCoin(u: TxnOutput, bucket: UtxoScanBucket = 'clean', assets?: UtxoAssetDetail): Annotated {
  return { ...u, bucket, ...(assets ? { assets } : {}) };
}

// Wired as the constructed orchestrator's `getUtxos` + `broadcast` ports.
class Cat21ServiceStub {
  utxos: TxnOutput[] = [];
  getUtxos = jest.fn((_: string) => of(this.utxos));
  postTransaction = jest.fn((_: string) => of('t'.repeat(64)));
}

// The content-scan port (orchestrator `scan`) AND the picker's per-row bucket
// source (`states$`). `classify` reads `verdicts` (clean when unlisted).
class ScannerStub {
  readonly statesSubject = new BehaviorSubject<ReadonlyMap<string, UtxoScanState>>(new Map());
  readonly states$ = this.statesSubject.asObservable();
  verdicts = new Map<string, UtxoClassification>();
  scan = jest.fn((_: string) => of<UtxoScanState>({ kind: 'scanned-clean' }));
  autoScan = jest.fn((_: unknown[]) => undefined);
  reset = jest.fn(() => { this.statesSubject.next(new Map()); this.verdicts.clear(); });
  getState = jest.fn((o: string): UtxoScanState => this.statesSubject.value.get(o) ?? { kind: 'not-scanned' });
  classify = jest.fn(async (o: string): Promise<UtxoClassification> => this.verdicts.get(o) ?? 'clean');

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

const calcSpy = calculateRecommendedFundingSats as unknown as jest.Mock;

// -------------------------------------------------------------------------

describe('Cat21MintComponent (ordpool.space /cat21-mint)', () => {
  let orchestrator: Cat21MintOrchestrator;
  let scanner: ScannerStub;
  let wallets: WalletServiceStub;
  let stateSvc: StateServiceStub;
  let cat21: Cat21ServiceStub;
  let cat21Api: Cat21ApiServiceStub;
  let fixture: ComponentFixture<Cat21MintComponent>;
  let component: Cat21MintComponent;
  let mintSpy: jest.SpyInstance;

  // Same minimal sentinel template as the cat21.space spec uses.
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

  /**
   * Set a snapshot the orchestrator cannot be driven into through its IO ports
   * alone (minting progress, a success txid, a mint error, the per-coin
   * candidateFees, a resolved verdict). Base = the REAL snapshot, override typed
   * `Partial<MintSnapshot>`, so an SDK field rename fails to compile here.
   */
  function emit(over: Partial<MintSnapshot>): void {
    (component as unknown as { snap: WritableSignal<MintSnapshot> }).snap.set({ ...orchestrator.getSnapshot(), ...over });
    (component as unknown as { simulationsSubject: BehaviorSubject<MintSnapshot['simulations']> })
      .simulationsSubject.next((over.simulations ?? orchestrator.getSnapshot().simulations));
    fixture.detectChanges();
  }

  /** Lets the real orchestrator's async UTXO load + recompute settle. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); }
    fixture.detectChanges();
  }

  async function configure(): Promise<void> {
    scanner = new ScannerStub();
    wallets = new WalletServiceStub();
    stateSvc = new StateServiceStub();
    cat21 = new Cat21ServiceStub();
    cat21Api = new Cat21ApiServiceStub();
    await TestBed.configureTestingModule({
      declarations: [Cat21MintComponent],
      providers: [
        { provide: Cat21Service, useValue: cat21 },
        { provide: bitcoinNetwork, useValue: 'mainnet' },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: wallets },
        { provide: StateService, useValue: stateSvc },
        { provide: Cat21ApiService, useValue: cat21Api },
        { provide: SeoService, useValue: new SeoServiceStub() },
        {
          provide: cat21Config,
          useValue: {
            mempoolApiUrl: 'http://test-mempool', cat21ApiUrl: 'http://test-cat21',
            ordApiUrl: 'http://test-ord', cat21OrdApiUrl: 'http://test-cat21-ord',
          },
        },
      ],
    })
      .overrideComponent(Cat21MintComponent, { set: { template: TEST_TEMPLATE } })
      .compileComponents();
    fixture = TestBed.createComponent(Cat21MintComponent);
    component = fixture.componentInstance;
    orchestrator = (component as unknown as { orchestrator: Cat21MintOrchestrator }).orchestrator;
    // The wallet is the only mocked method: signing + broadcast.
    mintSpy = jest.spyOn(orchestrator, 'mint').mockResolvedValue(
      { txId: 't'.repeat(64) } as Awaited<ReturnType<Cat21MintOrchestrator['mint']>>,
    );
    wallets.connectedWalletSubject.next(null);
    fixture.detectChanges();
  }

  /** Connect the default xverse wallet and let the orchestrator settle to ready. */
  async function connect(w: WalletInfo = wallet()): Promise<void> {
    wallets.connectedWalletSubject.next(w);
    await settle();
  }

  /**
   * Fund the orchestrator through its real IO: give electrs these coins (clean
   * unless named in `verdicts`), connect `w`, set the fee, let it simulate and
   * classify. Also mirrors each coin's scan state into the picker's `states$`.
   */
  const walletKey = (w: WalletInfo | null) =>
    w ? `${w.type}|${w.ordinalsAddress}|${w.paymentAddress}|${w.paymentPublicKey}` : null;

  async function fund(
    coins: { u: TxnOutput; scan?: UtxoScanState; verdict?: UtxoClassification }[],
    w: WalletInfo = wallet(),
    feeRate = 5,
  ): Promise<void> {
    cat21.utxos = coins.map((c) => c.u);
    coins.forEach((c) => { if (c.verdict) { scanner.verdicts.set(outpoint(c.u), c.verdict); } });
    // If this identity is already connected (a describe beforeEach connected it),
    // the component dedupes a re-emission, so reload through the orchestrator's
    // own refresh (what the funding poll does) instead of re-pushing the wallet.
    if (walletKey(wallets.connectedWalletSubject.value) === walletKey(w)) {
      await orchestrator.refreshUtxos();
    } else {
      wallets.connectedWalletSubject.next(w);
    }
    await settle();
    component.setFeeRate(feeRate);
    await settle();
    scanner.setStates(coins.map((c) => [outpoint(c.u), c.scan ?? { kind: 'scanned-clean' }]));
    component.paymentOutputs$.subscribe().unsubscribe();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    calcSpy.mockClear();
    (lookupRuneEtching as jest.Mock).mockClear();
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
  // B. Loading state
  // -------------------------------------------------------------------

  describe('B. wallet connected, loading UTXOs', () => {
    it('B1: utxoLoading() projects state==="loading-utxos"', async () => {
      await connect();
      emit({ state: 'loading-utxos' });
      expect(component.utxoLoading()).toBe(true);
      expect(fixture.nativeElement.querySelector('[data-testid="mint-loading"]')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------
  // C. Error attribution
  // -------------------------------------------------------------------

  describe('C. error attribution (utxo-load vs mint)', () => {
    it('C1: error before mint attempt → utxoError populated', async () => {
      await connect();
      emit({ state: 'error', errorMessage: 'utxo fetch failed' });
      expect(component.utxoError()).toBe('utxo fetch failed');
      expect(component.mintCat21Error()).toBe('');
    });

    it('C2: error after mint attempt → mintCat21Error populated', async () => {
      await fund([{ u: utxo() }]);
      component.mintCat21(wallet());
      emit({ state: 'error', errorMessage: 'user cancelled' });
      expect(component.mintCat21Error()).toBe('user cancelled');
      expect(component.utxoError()).toBe('');
    });
  });

  // -------------------------------------------------------------------
  // D. recommendedFundingSats — the component clamps the fee rate, then
  //    delegates to the real SDK helper (wrapped in a spy so the clamp is
  //    observable without pinning the SDK's vsize formula).
  // -------------------------------------------------------------------

  describe('D. recommendedFundingSats — clamp + delegate', () => {
    it('D1: passes a valid fee rate straight through to the SDK helper', () => {
      component.cfeeRate.setValue(5);
      void component.recommendedFundingSats;
      expect(calcSpy).toHaveBeenLastCalledWith(5);
    });

    it('D2: clamps a non-positive fee rate to 1 before calling the helper', () => {
      component.cfeeRate.setValue(0);
      void component.recommendedFundingSats;
      expect(calcSpy).toHaveBeenLastCalledWith(1);
    });

    it('D3: clamps a non-finite fee rate to 1 before calling the helper', () => {
      component.cfeeRate.setValue(null as unknown as number);
      void component.recommendedFundingSats;
      expect(calcSpy).toHaveBeenLastCalledWith(1);
    });
  });

  // -------------------------------------------------------------------
  // E. No consumer-side funding auto-pick (defers to the SDK safe-auto)
  // -------------------------------------------------------------------

  describe('E. no consumer-side funding auto-pick (defers to the SDK safe-auto)', () => {
    const big = (v: number) => utxo({ txid: String(v).repeat(64).slice(0, 64), value: v });

    it('E1: does NOT auto-pick when only clean coins are present', async () => {
      await fund([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: big(20_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(orchestrator.getSnapshot().selectedUtxo).toBeNull();
    });

    it('E2: does NOT auto-pick an unscanned coin (the exact footgun)', async () => {
      await fund([
        { u: big(80_000), scan: { kind: 'not-scanned' } },
        { u: big(20_000), scan: { kind: 'not-scanned' } },
      ]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(orchestrator.getSnapshot().selectedUtxo).toBeNull();
    });

    it('E3: does NOT auto-pick across a mixed clean+unscanned+assets list', async () => {
      await fund([
        { u: big(90_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'a:0', inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null } } },
        { u: big(70_000), scan: { kind: 'not-scanned' } },
        { u: big(5_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(orchestrator.getSnapshot().selectedUtxo).toBeNull();
    });

    it('E4: does NOT auto-pick when only asset-bearing coins are present', async () => {
      await fund([
        { u: big(80_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'a:0', inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null } } },
        { u: big(20_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'b:0', inscriptionIds: [], runes: { RUNE: {} }, catIds: [], catSat: null, rareSat: null } } },
      ]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(orchestrator.getSnapshot().selectedUtxo).toBeNull();
    });

    it('E5: an explicit user pick is honored and forwarded to the orchestrator', async () => {
      const chosen = big(20_000);
      await fund([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: chosen, scan: { kind: 'scanned-clean' } },
      ]);
      component.selectPaymentOutput({ paymentOutput: chosen, simulation: simulation(), available: true, scan: { kind: 'scanned-clean' }, bucket: 'clean' });
      await settle();
      expect(component.selectedPaymentOutput!.paymentOutput.value).toBe(20_000);
      expect(orchestrator.getSnapshot().selectedUtxo!.value).toBe(20_000);
    });

    it('E6: an explicit user pick survives a row re-emit if still present', async () => {
      const smaller = big(20_000);
      await fund([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: smaller, scan: { kind: 'scanned-clean' } },
      ]);
      component.selectPaymentOutput({ paymentOutput: smaller, simulation: simulation(), available: true, scan: { kind: 'scanned-clean' }, bucket: 'clean' });
      await settle();
      await orchestrator.refreshUtxos();
      await settle();
      scanner.setStates([
        [outpoint(big(80_000)), { kind: 'scanned-clean' }],
        [outpoint(smaller), { kind: 'scanned-clean' }],
      ]);
      component.paymentOutputs$.subscribe().unsubscribe();
      fixture.detectChanges();
      expect(component.selectedPaymentOutput!.paymentOutput.value).toBe(20_000);
      expect(orchestrator.getSnapshot().selectedUtxo!.value).toBe(20_000);
    });

    it('E7: a user pick the SDK drops as gone clears the local display without a consumer-side re-drive', async () => {
      const setSelSpy = jest.spyOn(orchestrator, 'setSelectedUtxo');
      const gone = big(20_000);
      await fund([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: gone, scan: { kind: 'scanned-clean' } },
      ]);
      component.selectPaymentOutput({ paymentOutput: gone, simulation: simulation(), available: true, scan: { kind: 'scanned-clean' }, bucket: 'clean' });
      await settle();
      expect(setSelSpy).toHaveBeenCalledTimes(1);
      // The coin leaves the wallet; the SDK recompute names the dropped pick.
      cat21.utxos = [big(80_000)];
      await orchestrator.refreshUtxos();
      await settle();
      scanner.setStates([[outpoint(big(80_000)), { kind: 'scanned-clean' }]]);
      component.paymentOutputs$.subscribe().unsubscribe();
      fixture.detectChanges();
      expect(component.selectedPaymentOutput).toBeUndefined();
      // The consumer does NOT re-decide the selection: no second setSelectedUtxo.
      expect(setSelSpy).toHaveBeenCalledTimes(1);
    });

    it('E8: empty row list clears any pick', async () => {
      await fund([{ u: big(80_000), scan: { kind: 'scanned-clean' } }]);
      cat21.utxos = [];
      await orchestrator.refreshUtxos();
      await settle();
      scanner.setStates([]);
      component.paymentOutputs$.subscribe().unsubscribe();
      fixture.detectChanges();
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(orchestrator.getSnapshot().selectedUtxo).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // E-FUND. funding-status gating (mint-button enable + notices). The
  //   component DERIVES the CTA from the snapshot's resolved verdict +
  //   recommendation; those SDK-shaped values are injected via emit so the
  //   derivation (not the policy, which the SDK + the sibling specs pin) is
  //   what is tested.
  // -------------------------------------------------------------------

  describe('E-FUND. funding-status gating', () => {
    type Rec = MintSnapshot['fundingRecommendation'];
    const rec = (status: Rec['status'], over: Partial<Rec> = {}) =>
      emit({ fundingRecommendation: { status, recommended: null, candidates: [], ...over } as Rec });
    const resolved = (status: MintSnapshot['resolvedFundingStatus'], u: TxnOutput | null = null) =>
      emit({ resolvedFundingStatus: status, resolvedFundingUtxo: u });

    beforeEach(async () => { await connect(); });

    it('fundingStatus() mirrors the orchestrator recommendation (raw topology mirror)', () => {
      rec('expert-required');
      expect(component.fundingStatus()).toBe('expert-required');
      rec('insufficient');
      expect(component.fundingStatus()).toBe('insufficient');
    });

    it('hasFundingSource() is true on resolved status ready (safe-auto funds, no manual pick needed)', () => {
      resolved('ready');
      expect(component.hasFundingSource()).toBe(true);
      expect(component.fundingCta().kind).toBe('ready');
    });

    it('hasFundingSource() is true on resolved asset-notice (a dirty coin WILL be spent, CTA enabled WITH notice)', () => {
      resolved('asset-notice');
      expect(component.hasFundingSource()).toBe(true);
      expect(component.fundingCta().kind).toBe('notice');
    });

    it('hasFundingSource() is false on resolved expert-required (mint button stays disabled)', () => {
      resolved('expert-required');
      expect(component.hasFundingSource()).toBe(false);
      expect(component.fundingCta().kind).toBe('warning');
    });

    it('hasFundingSource() is false on resolved insufficient / scanning / null (pre-scan)', () => {
      resolved('insufficient');
      expect(component.hasFundingSource()).toBe(false);
      resolved('scanning');
      expect(component.hasFundingSource()).toBe(false);
      expect(component.fundingCta().kind).toBe('scanning');
      resolved(null);
      expect(component.hasFundingSource()).toBe(false);
      expect(component.fundingCta().kind).toBe('scanning');
    });

    it('the CTA follows the RESOLVED coin verdict, not the topology recommendation: a manual dirty pick that recomputes to asset-notice is enabled WITH the assets named (no silent short-circuit to ready)', () => {
      rec('expert-required');
      resolved('expert-required');
      expect(component.hasFundingSource()).toBe(false);
      const dirty = utxo({ value: 50_000 });
      const annotated = annotatedCoin(dirty, 'assets', { inscriptionIds: ['abci0'], runeNames: [], catIds: [], rareSat: null });
      emit({
        fundingRecommendation: { status: 'expert-required', recommended: null, candidates: [annotated] },
        resolvedFundingStatus: 'asset-notice', resolvedFundingUtxo: dirty,
      });
      expect(component.hasFundingSource()).toBe(true);
      expect(component.fundingCta().kind).toBe('notice');
      expect(component.assetNotice()?.inscriptionIds).toEqual(['abci0']);
    });
  });

  // -------------------------------------------------------------------
  // F. Scanner integration
  // -------------------------------------------------------------------

  describe('F. scanner integration', () => {
    beforeEach(async () => { await connect(); component.setFeeRate(5); });

    it('F1: autoScan called with the {txid, vout, value} list on every row change', async () => {
      await fund([
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
      component.scanRow({ paymentOutput: u, simulation: simulation(), available: true, scan: { kind: 'not-scanned' }, bucket: 'unscanned' });
      expect(scanner.scan).toHaveBeenCalledWith(`${'c'.repeat(64)}:7`);
    });

    it('F3: rune-etching resolution kicks off from the row pipe on a scanned-with-assets row', async () => {
      const mockResolve = lookupRuneEtching as jest.Mock;
      mockResolve.mockClear();
      const u = utxo({ txid: 'd'.repeat(64), vout: 0, value: 90_000 });
      await fund([{ u, scan: { kind: 'scanned-with-assets', content: { outpoint: `${'d'.repeat(64)}:0`, inscriptionIds: [], runes: { ANARCHY: { amount: 1, divisibility: 0, symbol: 'X' } }, catIds: [], catSat: null, rareSat: null } } }]);
      expect(mockResolve).toHaveBeenCalledWith('ANARCHY', expect.objectContaining({ ordBaseUrl: 'http://test-ord' }));
    });

    it('F4: runeTxEtching is a pure read — repeated calls trigger NO extra lookups (guards the per-CD refetch bug)', async () => {
      const mockResolve = lookupRuneEtching as jest.Mock;
      const u = utxo({ txid: 'e'.repeat(64), vout: 0, value: 90_000 });
      await fund([{ u, scan: { kind: 'scanned-with-assets', content: { outpoint: `${'e'.repeat(64)}:0`, inscriptionIds: [], runes: { UNCOMMON: { amount: 1, divisibility: 0, symbol: null } }, catIds: [], catSat: null, rareSat: null } } }]);
      await new Promise((r) => setTimeout(r, 0));
      const callsAfterScan = mockResolve.mock.calls.length;
      component.runeTxEtching('UNCOMMON');
      component.runeTxEtching('UNCOMMON');
      component.runeTxEtching('UNCOMMON');
      expect(mockResolve.mock.calls.length).toBe(callsAfterScan);
    });
  });

  // -------------------------------------------------------------------
  // G. Bucket label rendering
  // -------------------------------------------------------------------

  describe('G. bucket labels on selectedPaymentOutput', () => {
    beforeEach(async () => { await connect(); component.setFeeRate(5); });

    const u = utxo();

    it.each<[UtxoScanState['kind'], string]>([
      ['not-scanned', 'unscanned'],
      ['scanned-clean', 'clean'],
      ['scan-failed', 'failed'],
    ])('G1: a manual pick of a %s row carries bucket %s (no auto-pick)', async (kind, bucket) => {
      const scan = kind === 'scan-failed'
        ? { kind: 'scan-failed' as const, message: 'x' }
        : { kind } as UtxoScanState;
      await fund([{ u, scan }]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      component.selectPaymentOutput({ paymentOutput: u, simulation: simulation(), available: true, scan, bucket: bucket as ViableSimulation['bucket'] });
      await settle();
      expect(component.selectedPaymentOutput!.bucket).toBe(bucket);
    });

    it('G2: scanned-with-assets requires explicit user pick', async () => {
      const scan: UtxoScanState = { kind: 'scanned-with-assets', content: { outpoint: 'x:0', inscriptionIds: ['x'], runes: null, catIds: [], catSat: null, rareSat: null } };
      await fund([{ u, scan }]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      component.selectPaymentOutput({ paymentOutput: u, simulation: simulation(), available: true, scan, bucket: 'assets' });
      await settle();
      expect(component.selectedPaymentOutput!.bucket).toBe('assets');
    });

    it('G3: scanning row never auto-picks but is selectable', async () => {
      await fund([{ u, scan: { kind: 'scanning' } }]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      component.selectPaymentOutput({ paymentOutput: u, simulation: simulation(), available: true, scan: { kind: 'scanning' }, bucket: 'scanning' });
      await settle();
      expect(component.selectedPaymentOutput!.bucket).toBe('scanning');
    });
  });

  // -------------------------------------------------------------------
  // H. isSingleAddressWallet detection
  // -------------------------------------------------------------------

  describe('H. isSingleAddressWallet', () => {
    it('H1: same addresses → true', () => {
      expect(component.isSingleAddressWallet(wallet({ ordinalsAddress: 'x', paymentAddress: 'x' }))).toBe(true);
    });

    it('H2: different addresses → false', () => {
      expect(component.isSingleAddressWallet(wallet({ ordinalsAddress: 'a', paymentAddress: 'b' }))).toBe(false);
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
      const setFeeSpy = jest.spyOn(orchestrator, 'setFeeRate');
      stateSvc.recommendedFeesSubject.next(fees({ fastestFee: 7, hourFee: 2 }));
      expect(component.cfeeRate.value).toBe(7);
      expect(setFeeSpy).toHaveBeenCalledWith(7);
    });

    it('I2: typing a new fee rate forwards to the orchestrator', () => {
      stateSvc.recommendedFeesSubject.next(fees({ fastestFee: 5, hourFee: 1 }));
      const setFeeSpy = jest.spyOn(orchestrator, 'setFeeRate');
      component.cfeeRate.setValue(2);
      expect(setFeeSpy).toHaveBeenLastCalledWith(2);
    });
  });

  // -------------------------------------------------------------------
  // J. fee-rate validator (0.1 sat/vB floor matching Bitcoin Core)
  // -------------------------------------------------------------------

  describe('J. fee-rate validator', () => {
    it('J1: accepts 0.1 sat/vB (Bitcoin Core relay floor since v29.1 / v30)', () => {
      component.cfeeRate.setValue(0.1);
      expect(component.cfeeRate.valid).toBe(true);
    });

    it('J2: rejects values below 0.1 sat/vB (would not relay)', () => {
      component.cfeeRate.setValue(0.05);
      expect(component.cfeeRate.valid).toBe(false);
      expect(component.cfeeRate.hasError('min')).toBe(true);
    });

    it('J3: accepts arbitrary rates the user types without an upper safeguard', () => {
      component.cfeeRate.setValue(0.5);
      expect(component.cfeeRate.valid).toBe(true);
      component.cfeeRate.setValue(1000);
      expect(component.cfeeRate.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // K. fee-rate text input: locale-agnostic decimal entry
  // -------------------------------------------------------------------

  describe('K. fee-rate decimal entry', () => {
    it('K1: a dot decimal sets the numeric control value', () => {
      const setFeeSpy = jest.spyOn(orchestrator, 'setFeeRate');
      component.onFeeRateInput('0.2');
      expect(component.cfeeRate.value).toBe(0.2);
      expect(component.feeRateDisplay).toBe('0.2');
      expect(setFeeSpy).toHaveBeenLastCalledWith(0.2);
    });

    it('K2: a comma decimal (non-English browser) yields the same number, raw string preserved', () => {
      const setFeeSpy = jest.spyOn(orchestrator, 'setFeeRate');
      component.onFeeRateInput('0,2');
      expect(component.cfeeRate.value).toBe(0.2);
      expect(setFeeSpy).toHaveBeenLastCalledWith(0.2);
      expect(component.feeRateDisplay).toBe('0,2');
    });

    it('K3: empty input clears to null and flags required', () => {
      component.onFeeRateInput('');
      expect(component.cfeeRate.value).toBeNull();
      expect(component.cfeeRate.hasError('required')).toBe(true);
    });

    it('K4: non-numeric input clears to null and flags required (never a silent NaN)', () => {
      component.onFeeRateInput('abc');
      expect(component.cfeeRate.value).toBeNull();
      expect(component.cfeeRate.hasError('required')).toBe(true);
    });

    it('K5: below-floor and above-ceiling still validate after text entry', () => {
      component.onFeeRateInput('0,05');
      expect(component.cfeeRate.hasError('min')).toBe(true);
      component.onFeeRateInput('2000');
      expect(component.cfeeRate.hasError('max')).toBe(true);
    });

    it('K6: clicking a fee preset syncs the display to a dot string', () => {
      component.setFeeRate(1.71);
      expect(component.cfeeRate.value).toBe(1.71);
      expect(component.feeRateDisplay).toBe('1.71');
    });
  });

  // -------------------------------------------------------------------
  // L. total-spend summary
  // -------------------------------------------------------------------

  describe('L. total mint spend', () => {
    it('L1: null until the SDK resolves a coin to spend', () => {
      expect(component.totalMintSpendSats()).toBeNull();
    });

    it('L2: once the SDK spends a picked coin, it is the miner fee plus the cat postage, not just one', () => {
      const picked = utxo({ value: 80_000 });
      emit({
        simulations: [{ utxo: picked, simulation: simulation(), insufficient: false }],
        resolvedFundingUtxo: picked,
      });
      expect(component.totalMintSpendSats()).toBe(746);
    });

    it('L3: tracks the fee, so it is a real total and not a hardcoded 546', () => {
      const picked = utxo({ value: 80_000 });
      emit({
        simulations: [{ utxo: picked, simulation: simulation({ finalTransactionFee: 1_454n }), insufficient: false }],
        resolvedFundingUtxo: picked,
      });
      expect(component.totalMintSpendSats()).toBe(2_000);
    });

    it('L4: uses the AUTO-recommended source when the user has not picked (so it shows in the collapsed default)', () => {
      const r = utxo({ txid: 'r'.repeat(64), vout: 1, value: 80_000 });
      emit({
        simulations: [{ utxo: r, simulation: simulation(), insufficient: false }],
        fundingRecommendation: { status: 'auto', recommended: annotatedCoin(r), candidates: [annotatedCoin(r)] },
        resolvedFundingUtxo: r,
      });
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(component.totalMintSpendSats()).toBe(746);
      expect(component.catPostageSats()).toBe(546);
    });
  });

  // -------------------------------------------------------------------
  // K. Mint command flow
  // -------------------------------------------------------------------

  describe('K. mintCat21()', () => {
    beforeEach(async () => { await fund([{ u: utxo(), scan: { kind: 'scanned-clean' } }]); });

    it('K1: mintCat21() invokes orchestrator.mint', () => {
      component.mintCat21(wallet());
      expect(mintSpy).toHaveBeenCalledTimes(1);
    });

    it('K2: mintCat21() error is swallowed (no throw)', () => {
      mintSpy.mockRejectedValueOnce(new Error('user cancelled'));
      expect(() => component.mintCat21(wallet())).not.toThrow();
    });

    it('K3: error after mintCat21 attributes to mintCat21Error not utxoError', () => {
      component.mintCat21(wallet());
      emit({ state: 'error', errorMessage: 'cancelled' });
      expect(component.mintCat21Error()).toBe('cancelled');
      expect(component.utxoError()).toBe('');
    });
  });

  // -------------------------------------------------------------------
  // L. Success state
  // -------------------------------------------------------------------

  describe('L. mintCat21Success', () => {
    it('L1: success state + txId → mintCat21Success returns {txId}', async () => {
      await connect();
      emit({ state: 'success', successTxId: 'deadbeef'.repeat(8) });
      expect(component.mintCat21Success()).toEqual({ txId: 'deadbeef'.repeat(8) });
      expect(fixture.nativeElement.querySelector('[data-testid="mint-success"]')!.textContent).toContain('deadbeef'.repeat(8));
    });

    it('L2: success without txId → undefined', async () => {
      await connect();
      emit({ state: 'success', successTxId: null });
      expect(component.mintCat21Success()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // M. Helpers
  // -------------------------------------------------------------------

  describe('M. helpers', () => {
    it('M1: runeNames extracts keys; null runes → empty array', () => {
      expect(component.runeNames({ outpoint: 'x:0', inscriptionIds: [], runes: null, catIds: [], catSat: null, rareSat: null })).toEqual([]);
      expect(component.runeNames({ outpoint: 'x:0', inscriptionIds: [], runes: { ALPHA: {}, BETA: {} }, catIds: [], catSat: null, rareSat: null }).sort()).toEqual(['ALPHA', 'BETA']);
    });

    it('M1b: txidFromInscriptionId strips the i<index> suffix (single- and multi-digit)', () => {
      const txid = 'a'.repeat(64);
      expect(component.txidFromInscriptionId(`${txid}i0`)).toBe(txid);
      expect(component.txidFromInscriptionId(`${txid}i15`)).toBe(txid);
      expect(component.txidFromInscriptionId(txid)).toBe(txid);
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

    it('M5: ordReviewBase / cat21OrdReviewBase mirror the injected cat21Config URLs', () => {
      expect(component.ordReviewBase).toBe('http://test-ord');
      expect(component.cat21OrdReviewBase).toBe('http://test-cat21-ord');
    });
  });

  // -------------------------------------------------------------------
  // MATRIX section
  // -------------------------------------------------------------------

  describe('MATRIX-A. wallet lifecycle', () => {
    it('MATRIX-A5(B): wallet swap resets scanner', () => {
      const w1 = wallet({ ordinalsAddress: 'addr-1', paymentAddress: 'pay-1' });
      const w2 = wallet({ ordinalsAddress: 'addr-2', paymentAddress: 'pay-2' });
      wallets.connectedWalletSubject.next(w1);
      fixture.detectChanges();
      scanner.reset.mockClear();
      wallets.connectedWalletSubject.next(w2);
      fixture.detectChanges();
      expect(scanner.reset).toHaveBeenCalledTimes(1);
    });

    it('MATRIX-A6(B): initial null → wallet emission does NOT reset the scanner', () => {
      scanner.reset.mockClear();
      wallets.connectedWalletSubject.next(wallet());
      fixture.detectChanges();
      expect(scanner.reset).not.toHaveBeenCalled();
    });

    it('MATRIX-A7(O): a duplicate same-identity re-emission does NOT re-drive setWallet', () => {
      const setWalletSpy = jest.spyOn(orchestrator, 'setWallet');
      const w = wallet();
      wallets.connectedWalletSubject.next(w);
      fixture.detectChanges();
      const callsAfterFirst = setWalletSpy.mock.calls.length;
      wallets.connectedWalletSubject.next({ ...w });
      fixture.detectChanges();
      expect(setWalletSpy.mock.calls.length).toBe(callsAfterFirst);
    });

    it('MATRIX-A8(O): a real identity change DOES re-drive setWallet', () => {
      const setWalletSpy = jest.spyOn(orchestrator, 'setWallet');
      const w1 = wallet({ ordinalsAddress: 'addr-1', paymentAddress: 'pay-1' });
      wallets.connectedWalletSubject.next(w1);
      fixture.detectChanges();
      const callsAfterFirst = setWalletSpy.mock.calls.length;
      const w2 = wallet({ ordinalsAddress: 'addr-2', paymentAddress: 'pay-2' });
      wallets.connectedWalletSubject.next(w2);
      fixture.detectChanges();
      expect(setWalletSpy.mock.calls.length).toBe(callsAfterFirst + 1);
    });

    it('MATRIX-A9(B): disconnect returns to idle state', async () => {
      await connect();
      emit({ state: 'ready' });
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="ready"]')).toBeTruthy();
      wallets.connectedWalletSubject.next(null);
      await settle();
      expect(el.querySelector('[data-testid="mint-cta"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="ready"]')).toBeNull();
    });
  });

  describe('MATRIX-B. fee-rate-driven viability', () => {
    it('MATRIX-B5(O): fee-rate validator accepts 0.1 sat/vB (Bitcoin Core relay floor)', () => {
      component.cfeeRate.setValue(0.1);
      expect(component.cfeeRate.valid).toBe(true);
    });

    it('MATRIX-B6(O): fee-rate validator rejects 0.05 sat/vB (below relay floor)', () => {
      component.cfeeRate.setValue(0.05);
      expect(component.cfeeRate.valid).toBe(false);
      expect(component.cfeeRate.hasError('min')).toBe(true);
    });

    it('MATRIX-B14(B): recommendedFundingSats delegates to the SDK helper for every fee tier', () => {
      for (const rate of [1, 5, 50, 100]) {
        component.cfeeRate.setValue(rate);
        void component.recommendedFundingSats;
        expect(calcSpy).toHaveBeenLastCalledWith(rate);
      }
    });
  });

  describe('MATRIX-D. bucket-driven UI', () => {
    const big = (v: number) => utxo({ txid: String(v).repeat(64).slice(0, 64), value: v });

    beforeEach(async () => { await connect(); component.setFeeRate(5); });

    it('MATRIX-D15(B): viable row list is capped at 10 entries', async () => {
      await fund(Array.from({ length: 25 }, (_, i) => ({ u: big(50_000 + i), scan: { kind: 'scanned-clean' } as UtxoScanState })));
      let captured: ViableSimulation[] | undefined;
      component.paymentOutputs$.subscribe((rs) => (captured = rs)).unsubscribe();
      expect(captured!.length).toBe(10);
    });

    it('MATRIX-D16(B): viable rows sorted strictly descending by UTXO value', async () => {
      await fund([
        { u: big(10_000), scan: { kind: 'scanned-clean' } },
        { u: big(50_000), scan: { kind: 'scanned-clean' } },
        { u: big(30_000), scan: { kind: 'scanned-clean' } },
      ]);
      let captured: ViableSimulation[] | undefined;
      component.paymentOutputs$.subscribe((rs) => (captured = rs)).unsubscribe();
      const values = captured!.map((r) => r.paymentOutput.value);
      expect(values).toEqual([50_000, 30_000, 10_000]);
    });
  });

  describe('MATRIX-E. expert-panel visibility (THE 2026-06-12 regression group)', () => {
    const big = (v: number) => utxo({ txid: String(v).repeat(64).slice(0, 64), value: v });

    beforeEach(async () => { await connect(); component.setFeeRate(5); });

    it('MATRIX-E1(B): expert panel renders when viableRows > 0 AND a row is selected (baseline)', async () => {
      const u1 = big(50_000);
      await fund([{ u: u1, scan: { kind: 'scanned-clean' } }]);
      let rows: ViableSimulation[] | undefined;
      component.paymentOutputs$.subscribe((rs) => (rows = rs)).unsubscribe();
      expect(rows!.length).toBeGreaterThan(0);
      component.selectPaymentOutput({ paymentOutput: u1, simulation: simulation(), available: true, scan: { kind: 'scanned-clean' }, bucket: 'clean' });
      await settle();
      expect(component.selectedPaymentOutput).toBeDefined();
    });

    it('MATRIX-E2(B): **THE REGRESSION** — assets-only scenario must still expose the picker (viable rows > 0 even if no selection)', async () => {
      const assetsScan: UtxoScanState = { kind: 'scanned-with-assets', content: { outpoint: 'x:0', inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null } };
      await fund([{ u: big(50_000), scan: assetsScan }]);
      let rows: ViableSimulation[] | undefined;
      component.paymentOutputs$.subscribe((rs) => (rows = rs)).unsubscribe();
      expect(rows!.length).toBeGreaterThan(0);
      expect(component.selectedPaymentOutput).toBeUndefined();
    });

    it('MATRIX-E3(B): expert panel hidden when there are no viable rows', async () => {
      await connect();
      cat21.utxos = [];
      await orchestrator.refreshUtxos();
      await settle();
      scanner.setStates([]);
      let rows: ViableSimulation[] | undefined;
      component.paymentOutputs$.subscribe((rs) => (rows = rs)).unsubscribe();
      expect(rows!.length).toBe(0);
    });

    it('MATRIX-E11(B): mint button disabled when there is no row selection', async () => {
      const assetsScan: UtxoScanState = { kind: 'scanned-with-assets', content: { outpoint: 'a:0', inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null } };
      await fund([{ u: big(50_000), scan: assetsScan }]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(component.form.invalid || !component.selectedPaymentOutput).toBe(true);
    });

    it('MATRIX-E12(B): mint button re-enables after the user explicitly picks an assets row ("Use anyway")', async () => {
      const u1 = big(50_000);
      const assetsScan: UtxoScanState = { kind: 'scanned-with-assets', content: { outpoint: `${u1.txid}:0`, inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null } };
      await fund([{ u: u1, scan: assetsScan }]);
      expect(component.selectedPaymentOutput).toBeUndefined();
      component.selectPaymentOutput({ paymentOutput: u1, simulation: simulation(), available: true, scan: assetsScan, bucket: 'assets' });
      await settle();
      expect(component.selectedPaymentOutput).toBeDefined();
      expect(component.selectedPaymentOutput!.bucket).toBe('assets');
    });
  });

  describe('MATRIX-I. edge cases', () => {
    it('MATRIX-I20(B): runeNames returns [] for null runes (no crash)', () => {
      const empty = component.runeNames({ outpoint: 'x:0', inscriptionIds: [], runes: null, catIds: [], catSat: null, rareSat: null });
      expect(empty).toEqual([]);
    });

    it('MATRIX-I21(B): bucketTooltip returns a non-empty string for every bucket kind (no undefined flicker)', () => {
      const buckets = ['clean', 'unscanned', 'assets', 'scanning', 'failed'] as const;
      for (const b of buckets) {
        const tip = component.bucketTooltip(b);
        expect(typeof tip).toBe('string');
        expect(tip.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------
  // N. per-coin fee column (FAMILY_UX three-state). Reads the SDK's shared
  //    candidateFees (keyed by outpoint), injected via emit.
  // -------------------------------------------------------------------

  describe('N. per-coin fee column', () => {
    const big = (v: number) => utxo({ txid: String(v).repeat(64).slice(0, 64), value: v });
    const row = (u: TxnOutput): ViableSimulation =>
      ({ paymentOutput: u, simulation: simulation(), available: true, scan: { kind: 'scanned-clean' }, bucket: 'clean' });
    const feeRow = (u: TxnOutput, over: Partial<{ finalFeeSats: number | null; vsize: number | null; absorbedSubDustSats: number | null }> = {}) =>
      ({ txid: u.txid, vout: u.vout, finalFeeSats: 200, vsize: 150, absorbedSubDustSats: 0, ...over });
    type Fees = MintSnapshot['candidateFees'];

    beforeEach(async () => { await connect(); component.setFeeRate(5); });

    it('N0: feeClass routes the four states through the shared classifier (no drift)', () => {
      const normal = big(50_001), over = big(50_002), unknown = big(50_003), unavail = big(50_004);
      emit({ candidateFees: [
        feeRow(normal, { finalFeeSats: 200, absorbedSubDustSats: 0 }),
        feeRow(over, { finalFeeSats: 1_400, absorbedSubDustSats: 1_200 }),
        feeRow(unknown, { finalFeeSats: 200, absorbedSubDustSats: null }),
        feeRow(unavail, { finalFeeSats: null, absorbedSubDustSats: null }),
      ] as Fees });
      expect(component.feeClass(row(normal))).toBe('normal');
      expect(component.feeClass(row(over))).toBe('overpay');
      expect(component.feeClass(row(unknown))).toBe('overpay-unknown');
      expect(component.overPaidSats(row(unknown))).toBeNull();
      expect(component.feeClass(row(unavail))).toBe('unavailable');
    });

    it('N1: overPaidSats is the folded sats when a coin over-pays (absorbedSubDustSats > 0)', () => {
      const u = big(50_000);
      emit({ candidateFees: [feeRow(u, { finalFeeSats: 1_400, absorbedSubDustSats: 1_200 })] as Fees });
      expect(component.overPaidSats(row(u))).toBe(1_200);
    });

    it('N2: overPaidSats is null when the coin emits change (absorbedSubDustSats === 0) — NOT 0', () => {
      const u = big(50_000);
      emit({ candidateFees: [feeRow(u, { absorbedSubDustSats: 0 })] as Fees });
      expect(component.overPaidSats(row(u))).toBeNull();
    });

    it('N3: overPaidSats is null when the fee cannot be computed (absorbedSubDustSats === null)', () => {
      const u = big(50_000);
      emit({ candidateFees: [feeRow(u, { finalFeeSats: null, vsize: null, absorbedSubDustSats: null })] as Fees });
      expect(component.overPaidSats(row(u))).toBeNull();
    });

    it('N4: overPaidSats is null when this coin has no candidateFees row yet', () => {
      const u = big(50_000);
      emit({ candidateFees: [] as Fees });
      expect(component.overPaidSats(row(u))).toBeNull();
    });

    it('N5: candidateFee joins the shared row by outpoint (not by index/order)', () => {
      const a = big(50_000);
      const b = big(30_000);
      emit({ candidateFees: [feeRow(b, { finalFeeSats: 900 }), feeRow(a, { finalFeeSats: 300 })] as Fees });
      expect(component.candidateFee(row(a))?.finalFeeSats).toBe(300);
      expect(component.candidateFee(row(b))?.finalFeeSats).toBe(900);
    });

    it('N6: isRecommendedRow marks the coin selection would auto-pick, and only that one', () => {
      const r = big(40_000);
      const other = big(50_000);
      emit({ fundingRecommendation: { status: 'auto', recommended: annotatedCoin(r), candidates: [annotatedCoin(r), annotatedCoin(other)] } });
      expect(component.isRecommendedRow(row(r))).toBe(true);
      expect(component.isRecommendedRow(row(other))).toBe(false);
    });

    it('N7: isRecommendedRow is false for every row when there is no recommendation', () => {
      emit({ fundingRecommendation: { status: 'scanning', recommended: null, candidates: [] } });
      expect(component.isRecommendedRow(row(big(50_000)))).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // P. show-the-row (FAMILY_UX): an insufficient coin is SHOWN (available:false),
  //    not filtered out, and is unpickable.
  // -------------------------------------------------------------------

  describe('P. show-the-row (unavailable coins)', () => {
    const big = (v: number) => utxo({ txid: String(v).repeat(64).slice(0, 64), value: v });

    beforeEach(async () => { await connect(); component.setFeeRate(5); });

    it('P1: the insufficient coin is SHOWN as available:false, not filtered out', async () => {
      const covering = big(80_000);
      const small = big(500);
      await fund([
        { u: covering, scan: { kind: 'scanned-clean' } },
        { u: small, scan: { kind: 'not-scanned' } },
      ]);
      let captured: ViableSimulation[] | undefined;
      component.paymentOutputs$.subscribe((rs) => (captured = rs)).unsubscribe();
      expect(captured!.map((r) => r.paymentOutput.value).sort((a, b) => a - b)).toEqual([500, 80_000]);
      const smallRow = captured!.find((r) => r.paymentOutput.txid === small.txid)!;
      const coveringRow = captured!.find((r) => r.paymentOutput.txid === covering.txid)!;
      expect(smallRow.available).toBe(false);
      expect(smallRow.simulation).toBeNull();
      expect(coveringRow.available).toBe(true);
    });

    it('P2: selectPaymentOutput REFUSES an unavailable row (handler is the authority)', async () => {
      const small = big(500);
      await fund([{ u: big(80_000), scan: { kind: 'scanned-clean' } }, { u: small, scan: { kind: 'not-scanned' } }]);
      const unavailableRow: ViableSimulation = { paymentOutput: small, simulation: null, available: false, scan: { kind: 'not-scanned' }, bucket: 'unscanned' };
      component.selectPaymentOutput(unavailableRow);
      await settle();
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(orchestrator.getSnapshot().selectedUtxo).toBeNull();
    });

    it('P4: the unavailable tail is capped at 3 (a wallet of dust is not a wall)', async () => {
      const covering = big(80_000);
      const dust = Array.from({ length: 7 }, (_, i) => big(300 + i));
      await fund([
        { u: covering, scan: { kind: 'scanned-clean' } },
        ...dust.map((d) => ({ u: d, scan: { kind: 'not-scanned' } as UtxoScanState })),
      ]);
      let captured: ViableSimulation[] | undefined;
      component.paymentOutputs$.subscribe((rs) => (captured = rs)).unsubscribe();
      const shownUnavailable = captured!.filter((r) => !r.available);
      expect(shownUnavailable.length).toBe(3);
      expect(captured!.filter((r) => r.available).length).toBe(1);
      expect(shownUnavailable.map((r) => r.paymentOutput.value).sort((a, b) => b - a)).toEqual([306, 305, 304]);
      expect(component.totalCoinCount()).toBe(8);
      expect(captured!.length).toBe(4);
    });

    it('P3: a pick the SDK drops as below-requirement clears the local display without a consumer-side re-drive', async () => {
      const setSelSpy = jest.spyOn(orchestrator, 'setSelectedUtxo');
      const chosen = big(80_000);
      await fund([{ u: chosen, scan: { kind: 'scanned-clean' } }]);
      component.selectPaymentOutput({ paymentOutput: chosen, simulation: simulation(), available: true, scan: { kind: 'scanned-clean' }, bucket: 'clean' });
      await settle();
      expect(component.selectedPaymentOutput).toBeDefined();
      expect(setSelSpy).toHaveBeenCalledTimes(1);
      // Raise the rate so the coin no longer covers: the SDK drops the pick.
      component.setFeeRate(1000);
      await settle();
      scanner.setStates([[outpoint(chosen), { kind: 'scanned-clean' }]]);
      component.paymentOutputs$.subscribe().unsubscribe();
      fixture.detectChanges();
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(setSelSpy).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// wallet-ux-round3 §7.3 / §7.8: the single-address custody caveat, asserted
// against the REAL production template (read live from the .html).
// ---------------------------------------------------------------------------

@Pipe({ name: 'relativeUrl' })
class RelativeUrlStubPipe implements PipeTransform {
  transform(value: unknown): unknown { return value; }
}

describe('Cat21MintComponent — single-address custody caveat, REAL template (wallet-ux-round3)', () => {
  const REAL_TEMPLATE = fs.readFileSync(path.join(__dirname, 'cat21-mint.component.html'), 'utf8');

  let orchestrator: Cat21MintOrchestrator;
  let scanner: ScannerStub;
  let wallets: WalletServiceStub;
  let stateSvc: StateServiceStub;
  let cat21: Cat21ServiceStub;
  let fixture: ComponentFixture<Cat21MintComponent>;
  let component: Cat21MintComponent;

  function emit(over: Partial<MintSnapshot>): void {
    (component as unknown as { snap: WritableSignal<MintSnapshot> }).snap.set({ ...orchestrator.getSnapshot(), ...over });
    (component as unknown as { simulationsSubject: BehaviorSubject<MintSnapshot['simulations']> })
      .simulationsSubject.next(over.simulations ?? orchestrator.getSnapshot().simulations);
    fixture.detectChanges();
  }

  function viable(over: Partial<ViableSimulation> = {}): ViableSimulation {
    return {
      paymentOutput: utxo(), simulation: simulation(), available: true,
      scan: { kind: 'scanned-clean' } as UtxoScanState, bucket: 'clean', ...over,
    } as ViableSimulation;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); }
    fixture.detectChanges();
  }

  /** Connect `w` and let the async setWallet settle so the picker (ready state) renders. */
  async function connectReal(w: WalletInfo): Promise<void> {
    wallets.connectedWalletSubject.next(w);
    await settle();
  }

  async function configureReal(): Promise<void> {
    try { localStorage.clear(); } catch { /* jsdom */ }
    scanner = new ScannerStub();
    wallets = new WalletServiceStub();
    stateSvc = new StateServiceStub();
    cat21 = new Cat21ServiceStub();
    await TestBed.configureTestingModule({
      declarations: [Cat21MintComponent],
      imports: [CommonModule, ReactiveFormsModule, FormsModule, RelativeUrlStubPipe],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: Cat21Service, useValue: cat21 },
        { provide: bitcoinNetwork, useValue: 'mainnet' },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: wallets },
        { provide: StateService, useValue: stateSvc },
        { provide: Cat21ApiService, useValue: new Cat21ApiServiceStub() },
        { provide: SeoService, useValue: new SeoServiceStub() },
        { provide: cat21Config, useValue: { mempoolApiUrl: 'http://m', cat21ApiUrl: 'http://c', ordApiUrl: 'http://o', cat21OrdApiUrl: 'http://co' } },
      ],
    })
      .overrideComponent(Cat21MintComponent, { set: { template: REAL_TEMPLATE } })
      .compileComponents();
    fixture = TestBed.createComponent(Cat21MintComponent);
    component = fixture.componentInstance;
    orchestrator = (component as unknown as { orchestrator: Cat21MintOrchestrator }).orchestrator;
    jest.spyOn(orchestrator, 'mint').mockResolvedValue({ txId: 't'.repeat(64) } as Awaited<ReturnType<Cat21MintOrchestrator['mint']>>);
    wallets.connectedWalletSubject.next(null);
    fixture.detectChanges();
  }

  beforeEach(configureReal);

  const singleAddr = (): WalletInfo => wallet({ type: KnownOrdinalWalletType.unisat, ordinalsAddress: 'bc1p-same', paymentAddress: 'bc1p-same' });
  const dualAddr = (): WalletInfo => wallet({ ordinalsAddress: 'bc1p-ord', paymentAddress: '3-pay' });
  const q = (sel: string): Element | null => (fixture.nativeElement as HTMLElement).querySelector(sel);

  /** Show `row` in the picker and pick it, the way a click on its Use button does. */
  function pickRow(row: ViableSimulation): void {
    scanner.setStates([[outpoint(row.paymentOutput), row.scan]]);
    emit({ simulations: [{ utxo: row.paymentOutput, simulation: row.simulation, insufficient: false }] });
    component.paymentOutputs$.subscribe().unsubscribe();
    component.selectPaymentOutput(row);
    fixture.detectChanges();
  }

  it('renders the single-address note for a single-address wallet even with a LARGE CLEAN coin selected (info beside the mint button, not gated on coin)', () => {
    wallets.connectedWalletSubject.next(singleAddr());
    pickRow(viable({ paymentOutput: utxo({ value: 50_000 }), bucket: 'clean' }));
    const note = q('[data-testid="single-address-note"]');
    expect(note).toBeTruthy();
    expect(note!.textContent).toContain(singleAddressCaveat('cats', 'UniSat'));
    expect(note!.textContent).toContain('Your UniSat wallet keeps');
    expect(q('[data-testid="per-utxo-unverified"]')).toBeNull();
  });

  it('does NOT render the single-address note for a dual-address wallet', () => {
    wallets.connectedWalletSubject.next(dualAddr());
    pickRow(viable({ paymentOutput: utxo({ value: 3_000 }), bucket: 'unscanned', scan: { kind: 'not-scanned' } as UtxoScanState }));
    expect(q('[data-testid="single-address-note"]')).toBeNull();
  });

  it('renders the per-UTXO note inside the picker for a single-address wallet with a small unverified coin selected', async () => {
    // Real IO: load the coin so the pick sticks (selectPaymentOutput's real
    // setSelectedUtxo keeps a coin the orchestrator actually holds). The
    // single-address wallet uses a VALID taproot address for both roles, so
    // the real simulator can build from it (fake 'bc1p-same' cannot).
    const singleReal = wallet({ type: KnownOrdinalWalletType.unisat, ordinalsAddress: ORDINALS_ADDRESS, paymentAddress: ORDINALS_ADDRESS, paymentPublicKey: hex.encode(ORDINALS_PUB) });
    const u = utxo({ value: 9_000 });
    cat21.utxos = [u];
    await connectReal(singleReal);
    component.setFeeRate(1);
    await settle();
    scanner.setStates([[outpoint(u), { kind: 'not-scanned' } as UtxoScanState]]);
    component.paymentOutputs$.subscribe().unsubscribe();
    fixture.detectChanges();
    component.selectPaymentOutput(viable({ paymentOutput: u, bucket: 'unscanned', scan: { kind: 'not-scanned' } as UtxoScanState }));
    await settle();
    expect(q('[data-testid="per-utxo-unverified"]')).toBeTruthy();
    expect(q('[data-testid="single-address-note"]')).toBeTruthy();
  });

  it('renders the over-pay note + recommended badge inside the picker on the real template', async () => {
    await connectReal(dualAddr());
    const u = utxo({ value: 50_000 });
    scanner.setStates([[outpoint(u), { kind: 'scanned-clean' } as UtxoScanState]]);
    emit({
      simulations: [{ utxo: u, simulation: simulation(), insufficient: false }],
      candidateFees: [{ txid: u.txid, vout: u.vout, finalFeeSats: 1_400, vsize: 150, absorbedSubDustSats: 1_200 }] as MintSnapshot['candidateFees'],
      fundingRecommendation: { status: 'auto', recommended: annotatedCoin(u), candidates: [annotatedCoin(u)] },
    });
    component.paymentOutputs$.subscribe().unsubscribe();
    fixture.detectChanges();
    const overpay = q('[data-testid="utxo-overpay-note"]');
    expect(overpay).toBeTruthy();
    expect(overpay!.textContent).toContain('1,200');
    expect(q('[data-testid="utxo-recommended"]')).toBeTruthy();
  });

  it('does NOT render the over-pay note for a coin that emits change (absorbedSubDustSats 0)', () => {
    wallets.connectedWalletSubject.next(dualAddr());
    const u = utxo({ value: 50_000 });
    scanner.setStates([[outpoint(u), { kind: 'scanned-clean' } as UtxoScanState]]);
    emit({
      simulations: [{ utxo: u, simulation: simulation(), insufficient: false }],
      candidateFees: [{ txid: u.txid, vout: u.vout, finalFeeSats: 200, vsize: 150, absorbedSubDustSats: 0 }] as MintSnapshot['candidateFees'],
      fundingRecommendation: { status: 'auto', recommended: annotatedCoin(u), candidates: [annotatedCoin(u)] },
    });
    component.paymentOutputs$.subscribe().unsubscribe();
    fixture.detectChanges();
    expect(q('[data-testid="utxo-overpay-note"]')).toBeNull();
  });

  it('renders an insufficient coin as a dimmed "can\'t fund at this rate" row with no Use button (real template)', async () => {
    await connectReal(dualAddr());
    const small = utxo({ txid: 's'.repeat(64), value: 500 });
    scanner.setStates([[outpoint(small), { kind: 'not-scanned' } as UtxoScanState]]);
    emit({ simulations: [{ utxo: small, simulation: null, insufficient: true }] });
    component.paymentOutputs$.subscribe().unsubscribe();
    fixture.detectChanges();
    const cantFund = q('[data-testid="utxo-cant-fund"]');
    expect(cantFund).toBeTruthy();
    expect(q('.shape-border.utxo-row-unavailable')).toBeTruthy();
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('.shape-border.utxo-row-unavailable button');
    expect(buttons.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Contrast of the unavailable-row label, MEASURED, not inferred.
// ---------------------------------------------------------------------------

describe('unavailable-row label contrast (WCAG AA, small text)', () => {
  const srgbToLin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const relLum = ([r, g, b]: number[]): number => 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
  const contrast = (a: number[], b: number[]): number => {
    const la = relLum(a), lb = relLum(b), hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  };
  const hexToRgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const over = (fg: number[], bg: number[], alpha: number): number[] => fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]));

  const TEXT_WARNING = '#ffc107';
  const PANEL_BG = '#26262f';
  const PAGE_BG = '#1c2031';

  it('the dimmed amber "Can\'t fund at this rate" label clears 4.5:1', () => {
    const scss = fs.readFileSync(path.join(__dirname, 'cat21-mint.component.scss'), 'utf8');
    const m = scss.match(/\.utxo-row-unavailable\s*\{[^}]*opacity:\s*([\d.]+)/);
    expect(m).toBeTruthy();
    const opacity = parseFloat(m![1]);
    const effectiveText = over(hexToRgb(TEXT_WARNING), hexToRgb(PAGE_BG), opacity);
    const effectiveBg = over(hexToRgb(PANEL_BG), hexToRgb(PAGE_BG), opacity);
    const ratio = contrast(effectiveText, effectiveBg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
