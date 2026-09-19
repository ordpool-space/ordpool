import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject, catchError, combineLatest, filter, firstValueFrom, interval, map, of, shareReplay, take, tap } from 'rxjs';

import { AUTO_SCAN_MAX_VALUE_SAT, BITCOIN_MIN_RELAY_FEE_SAT_PER_VBYTE, CandidateFeeRow, Cat21ApiService, Cat21MintOrchestrator, Cat21Service, KnownOrdinalWallets, MintSnapshot, SimulateTransactionResult, SMALL_UTXO_WARNING_THRESHOLD_SAT, TxnOutput, UtxoAssetDetail, UtxoContent, UtxoContentScanner, UtxoScanBucket, UtxoScanState, UtxoSimulationRow, WalletInfo, WalletService, addressVerificationChunks, bucketOf, calculateRecommendedFundingSats, outpointKey, runeNamesFromContent, singleAddressCaveat, usesSingleAddress } from 'ordpool-sdk';
import { bitcoinNetwork, cat21Config } from '@app/services/ordinals/sdk-tokens';
import { StateService } from '../../../services/state.service';
import { SeoService } from '../../../services/seo.service';
import { PsbtExportPromptService } from '../psbt-export-prompt/psbt-export-prompt.service';
import { runeLabel } from '../rune-label.helper';
import { RuneEtchingResolverService } from '../rune-etching-resolver.service';

export interface ViableSimulation {
  simulation: SimulateTransactionResult;
  paymentOutput: TxnOutput;
  scan: UtxoScanState;
  bucket: UtxoScanBucket;
}

/** How often to re-read the funding set while WAITING for funds (status
 *  `insufficient`). Off once a covering coin appears, so a funded page never
 *  polls. 15s balances "the CTA lights up soon after my deposit confirms"
 *  against per-tab electrs cost. */
const FUNDING_REFRESH_INTERVAL_MS = 15_000;

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
  private cat21 = inject(Cat21Service);
  private scanner = inject(UtxoContentScanner);
  private config = inject(cat21Config);
  private network = inject(bitcoinNetwork);
  private psbtExportPrompt = inject(PsbtExportPromptService);
  private runeResolver = inject(RuneEtchingResolverService);
  cd = inject(ChangeDetectorRef);
  seoService = inject(SeoService);
  private destroyRef = inject(DestroyRef);

  /**
   * The framework-agnostic mint orchestrator (a plain SDK class, constructed
   * here, not an Angular `@Injectable`). The staying Angular/SDK services are
   * wired in as its ports:
   *   - `getUtxos`  → `Cat21Service` (electrs payment-address UTXOs)
   *   - `scan`      → `UtxoContentScanner` (fail-closed `ContentScanPort`; shares the UI's per-row scan cache so each coin hits ord/cat21-ord once)
   *   - `broadcast` → `Cat21Service.postTransaction`
   * Signing is wired internally by the orchestrator from the connected wallet's
   * type; the consumer only supplies these IO ports + drives it via `setWallet`
   * / `setFeeRate` / `setSelectedUtxo` / `mint`.
   */
  private orchestrator = new Cat21MintOrchestrator({
    getUtxos: (addr) => firstValueFrom(this.cat21.getUtxos(addr)),
    scan: this.scanner,
    broadcast: (hex) => firstValueFrom(this.cat21.postTransaction(hex)),
    network: this.network,
    // Derive the wallet topology from the connected wallet, so a dirty-only
    // funding pool produces a NOTICE (separate payment address) instead of a
    // blocking WARNING (one address for everything). Same 'derive' the other
    // SDK consumers pass; omitting it keeps the always-block default.
    fundingTopology: 'derive',
  });

  /** Orchestrator snapshot bridged to a signal; every state change re-renders. */
  private snap = signal<MintSnapshot>(this.orchestrator.getSnapshot());

  // The snapshot's simulation rows bridged to a hot BehaviorSubject so
  // paymentOutputs$ can combineLatest them with the scanner's states$ (both
  // synchronous, emit-on-subscribe). Fed from the same subscribe binding below.
  private simulationsSubject = new BehaviorSubject<UtxoSimulationRow[]>(this.orchestrator.getSnapshot().simulations);

  constructor() {
    // One-line binding: the orchestrator owns all mint state; we mirror its
    // snapshot into a signal + the simulations subject, and mark the OnPush view
    // for check on every change (wallet UTXOs resolving, scans completing, mint
    // transitions).
    const unsubscribe = this.orchestrator.subscribe((s) => {
      this.snap.set(s);
      // Only re-push when the simulation rows actually change (a new array from a
      // real recompute). The orchestrator also emits on selectedUtxo / feeRate /
      // state changes with the SAME simulations array; re-pushing those would
      // re-run paymentOutputs$'s tap, which calls setSelectedUtxo, which emits
      // again: a feedback loop. Reference compare cuts it.
      if (s.simulations !== this.simulationsSubject.value) {
        this.simulationsSubject.next(s.simulations);
      }
      this.cd.markForCheck();
    });
    this.destroyRef.onDestroy(unsubscribe);

    // Re-read the funding set while the page is WAITING for funds, so the CTA
    // enables when they arrive without a manual reload. The orchestrator reads
    // its UTXO set once, on connect: a page connected while a funding tx is
    // still unconfirmed would otherwise sit disabled forever, and no fee change
    // fixes it because the fee rate is not what is missing. Bounded on purpose:
    // it only hits electrs while the status is `insufficient` (nothing covers
    // yet) and goes quiet the moment a covering coin appears. refreshUtxos is a
    // no-op with no wallet and preserves the fee rate + expert pick (it re-runs
    // setWallet with the SAME wallet, so the wallet-changed reset never fires).
    interval(FUNDING_REFRESH_INTERVAL_MS).pipe(
      filter(() => this.fundingStatus() === 'insufficient'),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => { void this.orchestrator.refreshUtxos(); });
  }

  /** Asset-detail link bases sourced from cat21Config so dev / regtest / prod stay aligned with the scanner's own endpoints. */
  readonly ordReviewBase = this.config.ordApiUrl;
  readonly cat21OrdReviewBase = this.config.cat21OrdApiUrl;

  /**
   * cat21.space sat-page link for the cats on a funding UTXO. All cats at an
   * outpoint share offset 0, so one sat page lists every one and shows where
   * each sits now. The mint tx would mislead here: it shows where a cat
   * started, not where it is after a transfer.
   */
  catSatLink(catSat: number): string {
    return `https://cat21.space/sat/${catSat}`;
  }

  /** Auto-scan threshold echoed into the template for the "Scan anyway" hint. */
  readonly autoScanThreshold = AUTO_SCAN_MAX_VALUE_SAT;

  // ordpool's framework StateService streams recommended fees via the
  // websocket the mempool UI already runs, so the fee seed + tier buttons
  // stay on that live source (matches the rest of ordpool's freshness).
  recommendedFees$ = inject(StateService).recommendedFees$;
  connectedWallet$ = this.walletService.connectedWallet$;

  // Indexer status + latest cats for the hero panel + thumbnail grid.
  mintStatus$ = this.cat21ApiService.getStatus().pipe(catchError(() => of(null)));
  latestCatNumbers$ = this.cat21ApiService.getLatestCatNumbers(12).pipe(
    map((r) => r.catNumbers),
    catchError(() => of([] as number[])),
  );
  catImageUrl = (n: number) => this.cat21ApiService.getCatImageUrl(n);

  // Viable UTXO list: the orchestrator's snapshot carries ALL simulation rows
  // including insufficient ones; the template only wants the rows the user can
  // actually mint with. Sort largest-first and cap at 10 so the expert panel
  // never renders hundreds of rows.
  //
  // The snapshot's `simulations` is a signal read, bridged to an observable so
  // it can combineLatest with the scanner's `states$`: the row's `bucket` field
  // updates whenever either source changes; otherwise a user who funds their
  // wallet, opens the mint page, and clicks Mint without touching the fee-rate
  // input never sees the red `⚠ asset found` badge. `scanner.states$` is a
  // BehaviorSubject, so its initial empty-Map value emits immediately on
  // subscribe and the combineLatest pair fires as soon as the snapshot produces
  // its first simulation list.
  paymentOutputs$ = combineLatest([
    this.simulationsSubject,
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

      // Kick off rune-etching resolution here, on a scan/simulation change,
      // not from the template. Doing it in the render getter re-fires the
      // lookup every change-detection pass for a rune that resolves to null
      // (a reserved rune's all-zero etching, e.g. UNCOMMON•GOODS, which never
      // caches), hammering our ord. The resolver dedupes by name.
      for (const r of rows) {
        if (r.scan.kind === 'scanned-with-assets' && r.scan.content.runes) {
          for (const name of Object.keys(r.scan.content.runes)) {
            this.runeResolver.ensureResolved(name, this.ordReviewBase);
          }
        }
      }

      // Funding auto-pick is the orchestrator's job (its `fundingRecommendation`
      // force-scans covering candidates regardless of size and never
      // auto-selects an unscanned/asset coin). We leave the orchestrator's
      // selection unset unless the user MANUALLY picks a row (selectPaymentOutput,
      // an expert override past the asset warning); it then mints on its
      // content-clean recommendation. A consumer-side raw pre-pick here would
      // auto-spend a large UTXO the size-thresholded scan left `unscanned`.
      const current = this.selectedPaymentOutput;
      const stillThere = current && rows.find(
        (r) => r.paymentOutput.txid === current.paymentOutput.txid && r.paymentOutput.vout === current.paymentOutput.vout,
      );
      if (stillThere) {
        // Preserve the user's manual pick across re-emissions; refresh the row
        // reference so its scan state mirrors the current snapshot.
        this.selectedPaymentOutput = stillThere;
        this.orchestrator.setSelectedUtxo(stillThere.paymentOutput);
      } else {
        // No manual pick: defer to the orchestrator's safe auto-recommendation.
        this.selectedPaymentOutput = undefined;
        this.orchestrator.setSelectedUtxo(null);
      }
      this.cd.markForCheck();
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  // Template-bound field, set ONLY by the user's manual pick
  // (selectPaymentOutput -> "Use this UTXO"); the `tap` above preserves it
  // across re-emissions and otherwise leaves it undefined so the orchestrator's
  // safe auto-recommendation funds the mint.
  selectedPaymentOutput: ViableSimulation | undefined;

  /** Current funding status from the snapshot (raw mirror): `auto` (clean covers),
   *  `asset-notice` (dirty covers, separate-address wallet), `expert-required`
   *  (dirty covers, one-address wallet), `insufficient`, `scanning`. The CTA and
   *  the notices derive from {@link fundingCta}, never from this directly, so the
   *  button state and the message can't disagree. */
  readonly fundingStatus = computed(() => this.snap().fundingRecommendation.status);

  /**
   * The SINGLE value the CTA button state AND the funding notice both derive
   * from, so they can never disagree (two surfaces reading one status
   * independently is exactly what split them before). An explicit manual pick
   * makes the flow ready regardless of the auto-recommendation; otherwise it
   * switches on the SDK's status EXHAUSTIVELY, so a new status is a compile error
   * here rather than a silently-disabled button. Sites render the SDK's status;
   * they never recompute the safe/notice/block decision (FAMILY_UX funding-panel
   * rule).
   */
  readonly fundingCta = computed<
    | { kind: 'ready' }
    | { kind: 'notice'; assets: UtxoAssetDetail | undefined }
    | { kind: 'warning' }
    | { kind: 'insufficient' }
    | { kind: 'scanning' }
  >(() => {
    if (this.snap().selectedUtxo) return { kind: 'ready' };
    const rec = this.snap().fundingRecommendation;
    switch (rec.status) {
      case 'auto': return { kind: 'ready' };
      case 'asset-notice': return { kind: 'notice', assets: rec.recommended?.assets };
      case 'expert-required': return { kind: 'warning' };
      case 'insufficient': return { kind: 'insufficient' };
      case 'scanning': return { kind: 'scanning' };
    }
    const _exhaustive: never = rec.status;
    return _exhaustive;
  });

  /** The mint is fundable when a clean coin auto-covers (`ready`) or a dirty coin
   *  covers on a separate-address wallet (`notice`: CTA stays ENABLED with the
   *  notice shown before the click). `warning` (one-address block), `insufficient`
   *  and `scanning` leave it unfundable until the user acts in the picker. Derived
   *  from {@link fundingCta} so the button can't enable while the notice says
   *  otherwise. */
  readonly hasFundingSource = computed(() => {
    const kind = this.fundingCta().kind;
    return kind === 'ready' || kind === 'notice';
  });

  /** The assets the auto-funding coin carries when the CTA is in the `notice`
   *  state, so the template can NAME them (a notice that doesn't say what the
   *  coin carries is not a notice). Null in every other state. A projection of
   *  the single {@link fundingCta} value, not an independent recompute. */
  readonly assetNotice = computed(() => {
    const cta = this.fundingCta();
    return cta.kind === 'notice' ? cta.assets ?? null : null;
  });

  // State-machine projections: read-only views of the snapshot's `state`
  // shaped to match the template bindings so the HTML stays unchanged.
  private state = computed(() => this.snap().state);
  readonly utxoLoading = computed(() => this.state() === 'loading-utxos');
  readonly utxoError = computed(() =>
    this.state() === 'error' && !this.snap().successTxId && !this.isMintingFlow()
      ? this.snap().errorMessage ?? ''
      : '',
  );
  readonly mintCat21Loading = computed(() => this.state() === 'minting');
  readonly mintCat21Success = computed(() => {
    const txId = this.snap().successTxId;
    return this.state() === 'success' && txId ? { txId } : undefined;
  });
  readonly mintCat21Error = computed(() =>
    this.state() === 'error' && this.isMintingFlow()
      ? this.snap().errorMessage ?? ''
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
   * Whether the connected wallet hands out one address for both payments and
   * ordinals. Delegates to the SDK's {@link usesSingleAddress} so the
   * definition lives in one place and can't drift: it compares the two
   * addresses actually returned, covering every single-address wallet
   * (UniSat, Wizz, OKX, Binance, Alby) without a per-wallet list. When it
   * holds, every payment UTXO is also potentially an asset-bearing UTXO, so
   * a payment made anywhere can spend the sat a cat lives on.
   */
  isSingleAddressWallet(wallet: WalletInfo | null | undefined): boolean {
    return usesSingleAddress(wallet);
  }

  /**
   * The approved single-address custody caveat, printed verbatim (never
   * rewritten). Called with the 'cats' noun because a CAT-21 mint puts a cat
   * on the single address, and with the connected wallet's display label so
   * the sentence names it ("Your UniSat wallet keeps..."). The SDK owns the
   * wording and the opener grammar, so a refinement is a pin bump, not a copy
   * edit here.
   */
  custodyCaveat(wallet: WalletInfo | null | undefined): string {
    return singleAddressCaveat('cats', wallet ? KnownOrdinalWallets[wallet.type]?.label : undefined);
  }

  /**
   * Four-character chunks of an address for verification (SDK helper). Used on
   * the "Fund this address" instruction so a careful person can compare it
   * against what their wallet shows before funding it. The chunks render as
   * inline spans with NO space character between them (the gap is CSS), so a
   * dragged selection or the copy button both yield the raw address.
   */
  addressChunks(address: string | null | undefined): string[] {
    return address ? addressVerificationChunks(address) : [];
  }

  get recommendedFundingSats(): number {
    const rate = this.cfeeRate.value;
    return calculateRecommendedFundingSats(Number.isFinite(rate) && rate > 0 ? rate : 1);
  }

  form = new FormGroup({
    // Floor = the SDK's BITCOIN_MIN_RELAY_FEE_SAT_PER_VBYTE (Bitcoin Core's
    // default -minrelaytxfee; the constant's doc carries the sourced value +
    // version). Below it a tx won't relay on a default-config node.
    // Nullable on purpose: the fee input is a text field (see feeRateDisplay /
    // onFeeRateInput), and empty or non-numeric entry sets the control to null
    // so `required` fires. Never NaN, which would slip past min/max.
    feeRate: new FormControl<number | null>(1, {
      // Cap at the SDK gate's 1000 sat/vB ceiling and reject non-finite rates
      // (Infinity from a `1e999` input, NaN) before they reach the funding calc
      // or the orchestrator. Mirrors inscribe-mint.
      validators: [Validators.required, Validators.min(BITCOIN_MIN_RELAY_FEE_SAT_PER_VBYTE), Validators.max(1000)],
    }),
  });
  cfeeRate = this.form.controls.feeRate;

  /**
   * The fee input's DISPLAYED string. The input is `type="text"` rather than
   * `type="number"` so its separator is always a dot, matching the fee presets,
   * instead of the browser locale's (a German browser renders type=number 0.2
   * as "0,2" while the presets stay "0.2"). Holds the raw keystrokes so entry
   * is never snapped mid-typing; {@link onFeeRateInput} coerces it to the
   * numeric control value.
   */
  feeRateDisplay = '1';

  ngOnInit(): void {
    this.recommendedFees$.pipe(take(1)).subscribe(({ fastestFee }) => {
      this.cfeeRate.setValue(fastestFee);
      this.feeRateDisplay = String(fastestFee);
      this.orchestrator.setFeeRate(fastestFee);
      this.cd.markForCheck();
    });

    this.cfeeRate.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((rate) => {
      if (rate && Number.isFinite(rate)) this.orchestrator.setFeeRate(rate);
    });

    // On wallet change: push the new wallet into the orchestrator (setWallet
    // fetches its UTXOs + recomputes) and wipe the scanner cache (the previous
    // wallet's UTXO outpoints aren't relevant to the new one and would otherwise
    // accumulate forever). Initial null → wallet excluded from the reset: the
    // scanner is already empty and a reset would clobber any scan state the
    // pipeline pushed mid-connect.
    // takeUntilDestroyed: connectedWallet$ is the root WalletService's
    // never-completing BehaviorSubject, so the `this`-capturing subscription
    // must be torn down or every visit to this routed component leaks.
    let lastWalletAddress: string | null = null;
    this.connectedWallet$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((w) => {
      void this.orchestrator.setWallet(
        w
          ? {
              type: w.type,
              ordinalsAddress: w.ordinalsAddress,
              paymentAddress: w.paymentAddress,
              paymentPublicKey: w.paymentPublicKey,
            }
          : null,
      );
      const addr = w?.ordinalsAddress ?? null;
      if (lastWalletAddress !== null && addr !== lastWalletAddress) {
        this.scanner.reset();
      }
      lastWalletAddress = addr;
    });
  }

  setFeeRate(feeRate: number): void {
    this.form.patchValue({ feeRate });
    this.feeRateDisplay = String(feeRate);
  }

  /**
   * Fee input handler. Keeps the raw keystrokes in {@link feeRateDisplay} (so
   * typing is never snapped) and coerces them to the numeric control: a comma
   * decimal is normalised to a dot, and empty or non-numeric input clears the
   * control to null so `required` fires (never a NaN that would pass min/max).
   */
  onFeeRateInput(raw: string): void {
    this.feeRateDisplay = raw;
    const n = parseFloat(raw.replace(',', '.').trim());
    this.cfeeRate.setValue(Number.isFinite(n) ? n : null);
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
    // Watch-only (xpub) wallets sign via the export/paste bridge; injected
    // wallets ignore the callback, so it is passed unconditionally. The
    // orchestrator's `mint` expects a Promise-returning prompt, so bridge the
    // service's Observable through `firstValueFrom`. Success / error land in the
    // snapshot (state + successTxId / errorMessage) via the `subscribe` binding;
    // the markForCheck here is belt-and-suspenders for the OnPush view.
    const prompt = (unsigned: { base64: string; hex: string }) =>
      firstValueFrom(this.psbtExportPrompt.promptForSignedPsbt(unsigned, 'cat21-mint-unsigned.psbt'));
    this.orchestrator.mint(prompt)
      .then(() => this.cd.markForCheck())
      .catch(() => this.cd.markForCheck());
  }

  /** Pass-through to the SDK helper so the template can read rune names off a UtxoContent. */
  runeNames(content: UtxoContent): string[] { return runeNamesFromContent(content); }

  /** Rune name + its raw pile value ({amount,divisibility,symbol}) for each rune on a UTXO. */
  runeEntries(content: UtxoContent): { name: string; value: unknown }[] {
    return Object.entries(content.runes ?? {}).map(([name, value]) => ({ name, value }));
  }

  /** ord-rendered balance + name for a rune row; bare name if the pile shape is off. */
  readonly formatRuneLabel = runeLabel;

  /**
   * The etching txid for a rune, for the /tx/<etching> link, or null while it's
   * unresolved or has none (reserved runes → plain text). Pure read of the
   * resolver signal: resolution is kicked off from paymentOutputs$ on scan
   * change, not here, so this getter has no side effect during render. The
   * signal read re-renders the row when the lookup lands.
   */
  runeTxEtching(name: string): string | null {
    return this.runeResolver.resolved().get(name) ?? null;
  }

  /**
   * The genesis/reveal txid an inscription id points at, for the in-app
   * /tx/<txid> link. An inscription id is `<64-hex-txid>i<index>`; the
   * index suffix is stripped. The tx page renders the inscription from
   * the witness, so it works for unconfirmed txs too.
   */
  txidFromInscriptionId(inscriptionId: string): string {
    return inscriptionId.replace(/i\d+$/, '');
  }

  /** The success-panel "mint another" action: reload for a fresh mint. */
  mintAnother(): void {
    location.reload();
  }

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

  /**
   * The simulation for the funding source the mint will actually use: the
   * user's explicit pick if they chose one in the expert picker, otherwise the
   * orchestrator's auto-recommended source. This is why the total below shows
   * in the collapsed default, before anyone opens the picker.
   */
  private activeSimulation(): SimulateTransactionResult | null {
    if (this.selectedPaymentOutput) { return this.selectedPaymentOutput.simulation; }
    const rec = this.snap().fundingRecommendation.recommended;
    if (!rec) { return null; }
    const match = this.snap().simulations.find(
      (s) => s.utxo.txid === rec.txid && s.utxo.vout === rec.vout,
    );
    return match?.simulation ?? null;
  }

  /**
   * The exact sats that leave the wallet for the mint: the miner fee plus the
   * cat's postage output. Change returns to the payment address (or, if it
   * would fall below the dust limit, is already folded into
   * `finalTransactionFee`), so fee + amountToRecipient is the net debit in
   * both cases. Null until a funding source exists (auto-recommended or
   * user-picked). Surfaced so the collapsed default answers "what will this
   * cost" without expanding the expert picker, matching the inscribe form.
   */
  totalMintSpendSats(): number | null {
    const sim = this.activeSimulation();
    return sim ? this.toNumber(sim.finalTransactionFee) + this.toNumber(sim.amountToRecipient) : null;
  }

  /** The cat's postage output (the sats the freshly minted cat lives on), from
   *  the active funding source. Shown in the total line beside the miner fee. */
  catPostageSats(): number | null {
    const sim = this.activeSimulation();
    return sim ? this.toNumber(sim.amountToRecipient) : null;
  }

  /**
   * The SDK's per-coin fee rows keyed by outpoint. The picker reads the fee's
   * three-state meaning (emits change / over-pays / cannot fund) from HERE, the
   * one shared computation every surface consumes, so the number and its
   * interpretation can't drift from cat21.space and cubes. Rebuilt on each
   * snapshot; a small Map so a row lookup is O(1) rather than a scan per row.
   */
  private candidateFeeByOutpoint = computed(
    () => new Map(this.snap().candidateFees.map((f) => [outpointKey(f), f] as const)),
  );

  /** The shared per-coin fee row for a picker row, or undefined if not computed yet. */
  candidateFee(row: ViableSimulation): CandidateFeeRow | undefined {
    return this.candidateFeeByOutpoint().get(outpointKey(row.paymentOutput));
  }

  /**
   * When this coin's would-be change fell below the dust floor, the sats that
   * got folded into the miner fee instead of returning as change; null when the
   * coin emits change (`absorbedSubDustSats === 0`) or the fee is not known. A
   * positive value is the FAMILY_UX over-pay signal: the coin is usable and
   * over-paying, which is why the recommended coin can be the cheaper one a row
   * above it. Never a block — folding sub-dust change is deliberate behaviour.
   */
  overPaidSats(row: ViableSimulation): number | null {
    const folded = this.candidateFee(row)?.absorbedSubDustSats;
    return folded && folded > 0 ? folded : null;
  }

  /** The auto-recommended funding coin's outpoint, or null before one exists. */
  private recommendedOutpoint = computed(() => {
    const rec = this.snap().fundingRecommendation.recommended;
    return rec ? outpointKey(rec) : null;
  });

  /**
   * Whether this row is the coin selection would pick on its own. Marked IN
   * PLACE (a badge on its natural value-sorted row), never sorted to the top:
   * the cost column exists so a reader can see the recommended coin is cheaper
   * for a reason, and "why not the cheaper one above it?" is only answerable
   * while that cheaper row stays visible above it (FAMILY_UX).
   */
  isRecommendedRow(row: ViableSimulation): boolean {
    return this.recommendedOutpoint() === outpointKey(row.paymentOutput);
  }
}
