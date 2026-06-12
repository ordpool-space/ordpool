import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { catchError, map, of, shareReplay, take, tap } from 'rxjs';

import {
  Cat21ApiService,
  Cat21MintOrchestrator,
  SimulateTransactionResult,
  TxnOutput,
  WalletInfo,
  WalletService,
} from 'ordpool-sdk';
import { StateService } from '../../../services/state.service';
import { SeoService } from '../../../services/seo.service';

interface ViableSimulation {
  simulation: SimulateTransactionResult;
  paymentOutput: TxnOutput;
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
  cd = inject(ChangeDetectorRef);
  seoService = inject(SeoService);

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
  paymentOutputs$ = this.orchestrator.simulations$.pipe(
    map((rows): ViableSimulation[] =>
      rows
        .filter((r): r is { utxo: TxnOutput; simulation: SimulateTransactionResult; insufficient: false } =>
          !r.insufficient && r.simulation !== null,
        )
        .sort((a, b) => b.utxo.value - a.utxo.value)
        .slice(0, 10)
        .map((r) => ({ simulation: r.simulation, paymentOutput: r.utxo })),
    ),
    tap((rows) => {
      // Auto-select the largest viable entry whenever the list
      // refreshes, unless the user has already picked one that's
      // still viable. Sync to the orchestrator so mint() reads the
      // same value.
      if (!rows.length) {
        this.selectedPaymentOutput = undefined;
        this.orchestrator.setSelectedUtxo(null);
        return;
      }
      const current = this.selectedPaymentOutput;
      const stillThere = current && rows.find(
        (r) => r.paymentOutput.txid === current.paymentOutput.txid && r.paymentOutput.vout === current.paymentOutput.vout,
      );
      const next = stillThere ?? rows[0];
      this.selectedPaymentOutput = next;
      this.orchestrator.setSelectedUtxo(next.paymentOutput);
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

  /**
   * UTXOs at or below this value, on a single-address wallet, are
   * flagged as potentially holding an ordinal-bound asset (inscription,
   * rune, rare sat, CAT-21 cat). 10k sat is the de-facto industry
   * cut-off: most ordinal-bearing UTXOs are 546 sat or slightly above;
   * almost none exceed 10k. Content-safety heuristics, not fee math.
   */
  smallUtxoWarningThreshold = 10 * 1000;

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

  /**
   * Funding floor shown in the "we couldn't find enough funds" hint.
   * Derived from the user's currently-picked fee rate using a ~200 vB
   * reference vsize (real CAT-21 mints are ~150–170 vB depending on
   * wallet type), rounded up to the next 100 sat. At 1 sat/vB that's
   * ~800 sat; at 100 sat/vB it's ~20,600 sat. The original hint hard-
   * coded 200,000 sat sized for the launch-era fee spike, which is
   * ~263× too high at current mainnet rates.
   */
  get recommendedFundingSats(): number {
    const rate = this.cfeeRate.value || 1;
    return Math.ceil((546 + 200 * rate) / 100) * 100;
  }

  form = new FormGroup({
    feeRate: new FormControl(1, {
      validators: [Validators.required, Validators.min(1)],
      nonNullable: true,
    }),
  });
  cfeeRate = this.form.controls.feeRate;
  minRequiredFee = 0;

  ngOnInit(): void {
    this.recommendedFees$.pipe(take(1)).subscribe(({ fastestFee, hourFee }) => {
      this.updateMinRequiredFee(hourFee);
      if (fastestFee > this.minRequiredFee) {
        this.cfeeRate.setValue(fastestFee);
      }
      this.orchestrator.setFeeRate(this.cfeeRate.value);
      this.cd.detectChanges();
    });

    this.cfeeRate.valueChanges.subscribe((rate) => {
      if (rate) this.orchestrator.setFeeRate(rate);
    });
  }

  updateMinRequiredFee(hourFee: number): void {
    this.minRequiredFee = hourFee;
    this.cfeeRate.setValidators([
      Validators.required,
      Validators.min(this.minRequiredFee),
    ]);
    if (this.cfeeRate.value < this.minRequiredFee) {
      this.cfeeRate.setValue(this.minRequiredFee);
    }
    this.cfeeRate.updateValueAndValidity();
  }

  setFeeRate(feeRate: number): void {
    this.form.patchValue({ feeRate });
  }

  /** Template handler: user clicked "Use this UTXO" on an expert-mode row. */
  selectPaymentOutput(row: ViableSimulation): void {
    this.selectedPaymentOutput = row;
    this.orchestrator.setSelectedUtxo(row.paymentOutput);
  }

  /** Template handler: form submit / mint button. */
  mintCat21(_wallet: WalletInfo): void {
    this.mintAttempted = true;
    this.orchestrator.mint().subscribe({
      next: () => this.cd.detectChanges(),
      error: () => this.cd.detectChanges(),
    });
  }

  toNumber(n: bigint): number {
    return Number(n);
  }
}
