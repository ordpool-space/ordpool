import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { catchError, combineLatest, map, of, shareReplay, take, tap } from 'rxjs';

import {
  AUTO_SCAN_MAX_VALUE_SAT,
  Cat21ApiService,
  Cat21MintOrchestrator,
  SimulateTransactionResult,
  SMALL_UTXO_WARNING_THRESHOLD_SAT,
  TxnOutput,
  UtxoContent,
  UtxoContentScanner,
  UtxoScanBucket,
  UtxoScanState,
  WalletInfo,
  WalletService,
  bucketOf,
  calculateRecommendedFundingSats,
  cat21Config,
  findAutoPickCandidate,
  runeNamesFromContent,
} from 'ordpool-sdk';
import { StateService } from '../../../services/state.service';
import { SeoService } from '../../../services/seo.service';

export interface ViableSimulation {
  simulation: SimulateTransactionResult;
  paymentOutput: TxnOutput;
  scan: UtxoScanState;
  bucket: UtxoScanBucket;
}

@Component({
  selector: 'app-cat21-mint',
  templateUrl: './cat21-mint.component.html',
  styleUrls: ['./cat21-mint.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class Cat21MintComponent implements OnInit {

  walletService = inject(WalletService);
  cat21ApiService = inject(Cat21ApiService);
  private orchestrator = inject(Cat21MintOrchestrator);
  private scanner = inject(UtxoContentScanner);
  private config = inject(cat21Config);
  cd = inject(ChangeDetectorRef);
  seoService = inject(SeoService);

  /** Asset-detail link bases sourced from cat21Config so dev / regtest / prod stay aligned with the scanner's own endpoints. */
  readonly ordReviewBase = this.config.ordApiUrl;
  readonly cat21OrdReviewBase = this.config.cat21OrdApiUrl;

  /** Auto-scan threshold echoed into the template for the "Scan anyway" hint. */
  readonly autoScanThreshold = AUTO_SCAN_MAX_VALUE_SAT;

  // ordpool's framework StateService streams recommended fees via the
  // websocket the mempool UI already runs. Cat21MintOrchestrator also
  // exposes a polled recommendedFees$ derived from the REST endpoint,
  // but we stay with the live websocket source here because it's
  // already wired and matches the rest of ordpool's freshness.
  recommendedFees$ = inject(StateService).recommendedFees$;
  connectedWallet$ = this.walletService.connectedWallet$;

  // Indexer status + latest cats for the hero panel + thumbnail grid.
  mintStatus$ = this.cat21ApiService.getStatus().pipe(catchError(() => of(null)));
  latestCatNumbers$ = this.cat21ApiService.getLatestCatNumbers(12).pipe(
    map((r) => r.catNumbers),
    catchError(() => of([] as number[])),
  );
  catImageUrl = (n: number) => this.cat21ApiService.getCatImageUrl(n);

  // Viable UTXO list — orchestrator returns ALL rows including
  // insufficient ones; the template only wants the rows the user can
  // actually mint with. Sort largest-first + cap at 10 so the expert
  // panel never renders hundreds of rows.
  //
  // We `combineLatest` over `simulations$` and the scanner's
  // `states$` so the row's `bucket` field updates whenever either
  // source changes. Previously this read the scanner state via a
  // signal snapshot inside `map(...)`, which meant the bucket stayed
  // at whatever it was when the simulation last emitted — so the red
  // `⚠ asset found` badge never surfaced for a user who funded their
  // wallet, opened the mint page, and clicked Mint without touching
  // the fee-rate input. `scanner.states$` is a BehaviorSubject so the
  // initial empty-Map value emits immediately on subscribe; the
  // combineLatest pair fires the first emission as soon as
  // `simulations$` produces its first value.
  paymentOutputs$ = combineLatest([
    this.orchestrator.simulations$,
    this.scanner.states$,
  ]).pipe(
    map(([rows, scanMap]): ViableSimulation[] => {
      return rows
        .filter((r): r is { utxo: TxnOutput; simulation: SimulateTransactionResult; insufficient: false } =>
          !r.insufficient && r.simulation !== null,
        )
        .sort((a, b) => b.utxo.value - a.utxo.value)
        .slice(0, 10)
        .map((r): ViableSimulation => {
          const outpoint = `${r.utxo.txid}:${r.utxo.vout}`;
          const scan = scanMap.get(outpoint) ?? { kind: 'not-scanned' };
          return { simulation: r.simulation, paymentOutput: r.utxo, scan, bucket: bucketOf(scan) };
        });
    }),
    tap((rows) => {
      // Eager-scan small UTXOs. The scanner dedupes by outpoint so
      // repeat triggers from re-emissions are free.
      this.scanner.autoScan(rows.map((r) => ({
        txid: r.paymentOutput.txid,
        vout: r.paymentOutput.vout,
        value: r.paymentOutput.value,
      })));

      // Auto-select the largest "safe-enough" entry whenever the list
      // refreshes, unless the user has already picked one that's still
      // present. Priority: scanned-clean → unscanned (probably-safe
      // large UTXO) → scan-failed. NEVER auto-pick scanned-with-assets
      // — that row requires an explicit "Use anyway" click.
      if (!rows.length) {
        this.selectedPaymentOutput = undefined;
        this.orchestrator.setSelectedUtxo(null);
        return;
      }
      const current = this.selectedPaymentOutput;
      const stillThere = current && rows.find(
        (r) => r.paymentOutput.txid === current.paymentOutput.txid && r.paymentOutput.vout === current.paymentOutput.vout,
      );
      if (stillThere) {
        // Keep the existing pick but refresh the row reference so its
        // scan state mirrors the current snapshot.
        this.selectedPaymentOutput = stillThere;
        this.orchestrator.setSelectedUtxo(stillThere.paymentOutput);
        this.cd.detectChanges();
        return;
      }
      const next = findAutoPickCandidate(rows) ?? undefined;
      this.selectedPaymentOutput = next;
      this.orchestrator.setSelectedUtxo(next ? next.paymentOutput : null);
      this.cd.detectChanges();
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  // Template-bound field (matches the previous component's shape).
  // Mutated in two paths:
  //   - the `tap` above auto-syncs on every fresh UTXO list
  //   - selectPaymentOutput(row) when the user clicks "Use this UTXO"
  selectedPaymentOutput: ViableSimulation | undefined;

  // State-machine projections — read-only views of orchestrator.state()
  // shaped to match the existing template bindings so the HTML stays
  // unchanged.
  private state = this.orchestrator.state;
  readonly utxoLoading = computed(() => this.state() === 'loading-utxos');
  readonly utxoError = computed(() =>
    this.state() === 'error' && !this.orchestrator.successTxId() && !this.isMintingFlow()
      ? this.orchestrator.errorMessage() ?? ''
      : '',
  );
  readonly mintCat21Loading = computed(() => this.state() === 'minting');
  readonly mintCat21Success = computed(() =>
    this.state() === 'success' && this.orchestrator.successTxId()
      ? { txId: this.orchestrator.successTxId()! }
      : undefined,
  );
  readonly mintCat21Error = computed(() =>
    this.state() === 'error' && this.isMintingFlow()
      ? this.orchestrator.errorMessage() ?? ''
      : '',
  );

  // We've-already-tried-to-mint marker so the error gets attributed to
  // the right alert (utxo loading error vs mint error). Flipped on
  // mint() click; never reset (a successful mint route resets state
  // wholesale via orchestrator.reset() if the user mints again).
  private mintAttempted = false;
  private isMintingFlow(): boolean { return this.mintAttempted; }

  checkerError = '';

  /** Re-exported into the template for the warning copy that displays the literal number. */
  smallUtxoWarningThreshold = SMALL_UTXO_WARNING_THRESHOLD_SAT;

  /**
   * Whether the connected wallet uses one address for both payments and
   * ordinals. Detected purely via address equality — no SDK flag for
   * this. Unisat: same. Xverse / Leather / OKX / Phantom / Magic Eden:
   * different. The single-address case is the one where every payment
   * UTXO is also potentially an ordinals-bearing UTXO, so the picker
   * has to warn before the user accidentally spends an inscription /
   * rune / cat as transaction change.
   */
  isSingleAddressWallet(wallet: WalletInfo | null | undefined): boolean {
    if (!wallet) return false;
    return wallet.ordinalsAddress === wallet.paymentAddress;
  }

  get recommendedFundingSats(): number {
    return calculateRecommendedFundingSats(this.cfeeRate.value || 1);
  }

  form = new FormGroup({
    // Floor matches Bitcoin Core's default `-minrelaytxfee` since v27.0
    // (April 2024). Below 0.1 sat/vB won't relay on a default-config
    // node; above it the wallet itself surfaces any broadcast issue.
    feeRate: new FormControl(1, {
      validators: [Validators.required, Validators.min(0.1)],
      nonNullable: true,
    }),
  });
  cfeeRate = this.form.controls.feeRate;

  ngOnInit(): void {
    this.recommendedFees$.pipe(take(1)).subscribe(({ fastestFee }) => {
      this.cfeeRate.setValue(fastestFee);
      this.orchestrator.setFeeRate(this.cfeeRate.value);
      this.cd.detectChanges();
    });

    this.cfeeRate.valueChanges.subscribe((rate) => {
      if (rate) this.orchestrator.setFeeRate(rate);
    });

    // Wipe the scanner cache when one wallet swaps out for another —
    // the previous wallet's UTXO outpoints aren't relevant to the new
    // one and would otherwise accumulate forever. Initial null →
    // wallet is excluded: the scanner is already empty and a reset
    // would clobber any scan state the pipeline pushed mid-connect.
    let lastWalletAddress: string | null = null;
    this.connectedWallet$.subscribe((w) => {
      const addr = w?.ordinalsAddress ?? null;
      if (lastWalletAddress !== null && addr !== lastWalletAddress) {
        this.scanner.reset();
      }
      lastWalletAddress = addr;
    });
  }

  setFeeRate(feeRate: number): void {
    this.form.patchValue({ feeRate });
  }

  /** Template handler: user clicked "Use this UTXO" on an expert-mode row. */
  selectPaymentOutput(row: ViableSimulation): void {
    this.selectedPaymentOutput = row;
    this.orchestrator.setSelectedUtxo(row.paymentOutput);
  }

  /** Template handler: per-row "Scan anyway" / "Retry scan" button. */
  scanRow(row: ViableSimulation): void {
    this.scanner.scan(`${row.paymentOutput.txid}:${row.paymentOutput.vout}`).subscribe();
  }

  /** Template handler: form submit / mint button. */
  mintCat21(_wallet: WalletInfo): void {
    this.mintAttempted = true;
    this.orchestrator.mint().subscribe({
      next: () => this.cd.detectChanges(),
      error: () => this.cd.detectChanges(),
    });
  }

  /** Pass-through to the SDK helper so the template can read rune names off a UtxoContent. */
  runeNames(content: UtxoContent): string[] { return runeNamesFromContent(content); }

  /** Hover-tooltip text for each bucket badge. */
  bucketTooltip(bucket: UtxoScanBucket): string {
    switch (bucket) {
      case 'clean':
        return 'We checked this UTXO against ord and cat21-ord. No inscriptions, runes, or cats — safe to use as a mint input.';
      case 'assets':
        return 'This UTXO holds at least one inscription, rune, or CAT-21 cat. Spending it as a mint input would send the asset away to the miner as fee. Use "Use anyway" only if you really mean to.';
      case 'unscanned':
        return `Above the auto-scan threshold (${AUTO_SCAN_MAX_VALUE_SAT.toLocaleString()} sat) and very likely a plain payment. Click "Scan" to verify against ord and cat21-ord.`;
      case 'scanning':
        return 'Checking ord and cat21-ord for inscriptions, runes, and cats at this UTXO.';
      case 'failed':
        return 'One of the asset-detection endpoints (ord.ordpool.space or ord.cat21.space) didn\'t respond. Click "Retry scan" to try again.';
    }
  }

  toNumber(n: bigint): number {
    return Number(n);
  }
}
