import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject, combineLatest, debounceTime, firstValueFrom, map, shareReplay, Subject, take, tap } from 'rxjs';

import { detectMimeType } from 'ordpool-parser';
import { AUTO_SCAN_MAX_VALUE_SAT, BITCOIN_MIN_RELAY_FEE_SAT_PER_VBYTE, Cat21Service, CompressionAssessment, INSCRIBE_POSTAGE_SATS, InscribeMintOrchestrator, InscribeOperationGateResult, InscribeSnapshot, InscribeUtxoSimulation, InscriptionContentEncoding, InscriptionExistence, KnownOrdinalWallets, ORD_TAGS, OrdEnvelopeField, SMALL_UTXO_WARNING_THRESHOLD_SAT, SimulateInscribeFeesResult, TxnOutput, UtxoContent, UtxoContentScanner, UtxoScanBucket, UtxoScanState, WalletInfo, WalletService, assessCompression, bucketOf, checkInscriptionsExist, encodeCborDeterministic, encodeInscriptionId, encodeInscriptionProperties, findRareSatsInOutputs, getDummyKeypair, getMinimumUtxoSize, addressVerificationChunks, InscribeBatchContent, InscribeSatTarget, inscribeSatSourceFromRow, inscribeUserMessage, prepareInscribeFundingInput, runeNamesFromContent, SatPickerRow, satPaddingRequirement, simulateInscribeFees, singleAddressCaveat, toScureNetwork, usesSingleAddress, validateInscribeOperation } from 'ordpool-sdk';
import { bitcoinNetwork, cat21Config } from '@app/services/ordinals/sdk-tokens';

import { environment } from '../../../../environments/environment';

import { StateService } from '../../../services/state.service';
import { SeoService } from '../../../services/seo.service';
import { PsbtExportPromptService } from '../psbt-export-prompt/psbt-export-prompt.service';

/** One viable funding UTXO joined with its content-scan bucket. */
export interface ViableInscribeSimulation {
  simulation: SimulateInscribeFeesResult;
  paymentOutput: TxnOutput;
  scan: UtxoScanState;
  bucket: UtxoScanBucket;
}

/** The uploaded file resolved to inscription-ready bytes + a content-type. */
interface PickedFile {
  name: string;
  bytes: Uint8Array;
  contentType: string;
  sizeBytes: number;
}

/** One batch entry: a picked file plus its optional per-inscription options. */
interface BatchEntry extends PickedFile {
  /** ord's per-entry title; empty omits it. */
  title: string;
  /** Where THIS inscription goes (separate-outputs); empty = the shared recipient. */
  destination: string;
}

/**
 * On-chain body-size ceiling for a single inscription. Matches the SDK
 * gate's DEFAULT_MAX_CONTENT_BYTES, which keeps the reveal under standard
 * relay. Enforced client-side here for instant feedback; the gate is
 * still the hard backstop.
 */
const MAX_CONTENT_BYTES = 350_000;

/** JavaScript MIME types are blocked (XSS-flavoured inscribers). */
const BLOCKED_CONTENT_TYPES = [
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'text/ecmascript',
];

@Component({
  selector: 'app-inscribe-mint',
  templateUrl: './inscribe-mint.component.html',
  styleUrls: ['./inscribe-mint.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class InscribeMintComponent implements OnInit {

  walletService = inject(WalletService);
  private cat21 = inject(Cat21Service);
  private psbtExportPrompt = inject(PsbtExportPromptService);
  private scanner = inject(UtxoContentScanner);
  private config = inject(cat21Config);
  private network = inject(bitcoinNetwork);
  cd = inject(ChangeDetectorRef);
  seoService = inject(SeoService);
  private destroyRef = inject(DestroyRef);

  /**
   * The framework-agnostic inscribe orchestrator (a plain SDK class, constructed
   * here, not an Angular `@Injectable`). The staying Angular/SDK services are
   * wired in as its ports (getUtxos → Cat21Service, scan → `UtxoContentScanner`
   * (fail-closed `ContentScanPort`, shares the UI's scan cache), broadcast →
   * Cat21Service.postTransaction for commit+reveal).
   * Signing is wired internally by the orchestrator from the connected wallet.
   */
  private orchestrator = new InscribeMintOrchestrator({
    getUtxos: (addr) => this.getDedupedUtxos(addr),
    scan: this.scanner,
    broadcast: (hex) => firstValueFrom(this.cat21.postTransaction(hex)),
    network: this.network,
  });

  /**
   * The address's UTXOs, deduped by outpoint. electrs transiently lists the
   * SAME outpoint twice around the moment a tx confirms (one confirmed, one
   * unconfirmed, same value); summing that list double-counts a coin's sats
   * and the rare-sat scan would show the coin twice. The SDK's getUtxos is a
   * thin electrs wrapper that leaves this to the caller ("caller-side dedup is
   * the consumer's responsibility"), so both the funding pick and the rare-sat
   * scan fetch through here. Same outpoint = same output = same value, so
   * keeping the first entry is correct.
   */
  private async getDedupedUtxos(address: string): Promise<TxnOutput[]> {
    const utxos = await firstValueFrom(this.cat21.getUtxos(address));
    const byOutpoint = new Map<string, TxnOutput>();
    for (const u of utxos) {
      const key = `${u.txid}:${u.vout}`;
      if (!byOutpoint.has(key)) { byOutpoint.set(key, u); }
    }
    return [...byOutpoint.values()];
  }

  /** Orchestrator snapshot bridged to a signal; every state change re-renders. */
  private snap = signal<InscribeSnapshot>(this.orchestrator.getSnapshot());

  // The snapshot's simulation rows bridged to a hot BehaviorSubject so
  // paymentOutputs$ can combineLatest them with the scanner's states$ (both
  // synchronous). Fed from the same subscribe binding below, guarded so only a
  // real recompute (a new array) re-pushes, otherwise the funding tap's
  // setSelectedUtxo re-emit would feed back and loop.
  private simulationsSubject = new BehaviorSubject<InscribeUtxoSimulation[]>(this.orchestrator.getSnapshot().simulations);

  constructor() {
    const unsubscribe = this.orchestrator.subscribe((s) => {
      this.snap.set(s);
      if (s.simulations !== this.simulationsSubject.value) {
        this.simulationsSubject.next(s.simulations);
      }
      this.cd.markForCheck();
    });
    this.destroyRef.onDestroy(unsubscribe);
  }

  /** ord review base for inscription/rune links (dev/regtest/prod aligned). */
  readonly ordReviewBase = this.config.ordApiUrl;

  readonly autoScanThreshold = AUTO_SCAN_MAX_VALUE_SAT;
  smallUtxoWarningThreshold = SMALL_UTXO_WARNING_THRESHOLD_SAT;
  readonly postageSats = INSCRIBE_POSTAGE_SATS;

  /** Change returned to the payment address (0 when folded into fee below dust). */
  changeSats(row: ViableInscribeSimulation): number {
    return Math.max(0, row.paymentOutput.value - row.simulation.fundingRequirementSats);
  }

  recommendedFees$ = inject(StateService).recommendedFees$;
  connectedWallet$ = this.walletService.connectedWallet$;

  // ---- File state ---------------------------------------------------------

  pickedFile: PickedFile | null = null;
  fileError = '';
  isDragging = false;

  /**
   * Wallet-agnostic cost estimate shown before a wallet connects, once
   * a file is dropped. Runs the SDK simulator against a synthetic
   * p2wpkh funding input with the actual file bytes. Null when no file
   * or the sim can't run. Recomputed on file / fee-rate change.
   */
  preConnectMintSats: number | null = null;

  // ---- UTXO picker (cloned from cat21-mint) -------------------------------

  paymentOutputs$ = combineLatest([
    this.simulationsSubject,
    this.scanner.states$,
  ]).pipe(
    map(([rows, scanMap]): ViableInscribeSimulation[] => {
      return (rows as InscribeUtxoSimulation[])
        .filter((r): r is InscribeUtxoSimulation & { simulation: SimulateInscribeFeesResult; insufficient: false } =>
          !r.insufficient && r.simulation !== null,
        )
        .sort((a, b) => b.utxo.value - a.utxo.value)
        .slice(0, 10)
        .map((r): ViableInscribeSimulation => {
          const outpoint = `${r.utxo.txid}:${r.utxo.vout}`;
          const scan = scanMap.get(outpoint) ?? { kind: 'not-scanned' };
          return { simulation: r.simulation, paymentOutput: r.utxo, scan, bucket: bucketOf(scan) };
        });
    }),
    tap((rows) => {
      this.scanner.autoScan(rows.map((r) => ({
        txid: r.paymentOutput.txid,
        vout: r.paymentOutput.vout,
        value: r.paymentOutput.value,
      })));

      // Funding auto-pick is the SDK orchestrator's job (`fundingRecommendation$`),
      // not ours: it force-scans covering candidates regardless of size and
      // never auto-selects an unscanned/asset coin. We leave the orchestrator's
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
    // Two async pipes in the template consume this (the row count + the *ngFor).
    // Without shareReplay each opens its own subscription and the tap side
    // effects (autoScan, setSelectedUtxo, detectChanges) run twice
    // per emission. Matches cat21-mint's paymentOutputs$.
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  // Template-bound field, set ONLY by the user's manual pick
  // (selectPaymentOutput -> "Use this UTXO"); the `tap` above preserves it
  // across re-emissions and otherwise leaves it undefined so the orchestrator's
  // safe auto-recommendation funds the inscription.
  selectedPaymentOutput: ViableInscribeSimulation | undefined;

  /** Current funding status from the snapshot: `auto` (safe-auto covers),
   *  `expert-required` (only asset coins cover), `insufficient` (nothing covers),
   *  `scanning` (deciding). The template branches the notices on this. */
  readonly fundingStatus = computed(() => this.snap().fundingRecommendation.status);

  /** The inscription is fundable when the user MANUALLY picked a coin (an explicit
   *  `selectedUtxo`, incl. an expert override past the asset warning) OR the SDK
   *  can safe-auto-fund (`status === 'auto'`). `expert-required` / `insufficient`
   *  / `scanning` leave it unfundable until the user acts. Gates the inscribe
   *  button so removing the consumer-side auto-pick never leaves it stuck. */
  readonly hasFundingSource = computed(
    () => !!this.snap().selectedUtxo || this.fundingStatus() === 'auto',
  );

  // ---- State-machine projections ------------------------------------------

  private state = computed(() => this.snap().state);
  readonly utxoLoading = computed(() => this.state() === 'loading-utxos');
  readonly utxoError = computed(() =>
    this.state() === 'error' && !this.snap().successResult && !this.mintAttempted
      ? this.snap().errorMessage ?? ''
      : '',
  );
  readonly mintLoading = computed(() => this.state() === 'minting');
  readonly mintSuccess = computed(() =>
    this.state() === 'success' ? this.snap().successResult : null,
  );
  readonly mintError = computed(() =>
    this.state() === 'error' && this.mintAttempted
      ? this.snap().errorMessage ?? ''
      : '',
  );

  private mintAttempted = false;
  mintGateError = '';

  form = new FormGroup({
    // Nullable on purpose: the fee input is a text field (see feeRateDisplay /
    // onFeeRateInput), and empty or non-numeric entry sets the control to null
    // so `required` fires. Never NaN, which would slip past min/max.
    feeRate: new FormControl<number | null>(1, {
      // min = the SDK's BITCOIN_MIN_RELAY_FEE_SAT_PER_VBYTE (Bitcoin Core's
      // default -minrelaytxfee; the constant's doc carries the sourced value +
      // version). A lower rate won't relay on a default-config node. max 1000
      // matches the SDK gate's maxFeeRatePerVbyte and rejects a non-finite
      // Infinity (from a `1e999` input) so the form goes invalid and the mint
      // button disables instead of estimating "Infinity".
      validators: [Validators.required, Validators.min(BITCOIN_MIN_RELAY_FEE_SAT_PER_VBYTE), Validators.max(1000)],
    }),
    // Prefilled watermark so we can measure how many inscriptions came
    // through ordpool; the user can clear it. Empty → no note tag.
    note: new FormControl('ordpool.space', { nonNullable: true }),
    // The inscription's title (ord's --title), shown by ord under the number.
    // Empty → no title.
    title: new FormControl('', { nonNullable: true }),
    // Metaprotocol identifier (ord tag 7, UTF-8), e.g. a protocol name the
    // inscription participates in. Empty → no metaprotocol tag.
    metaprotocol: new FormControl('', { nonNullable: true }),
    // The inscription output's value in sats (ord's --postage). Default 546
    // (INSCRIBE_POSTAGE_SATS). Min 546 keeps the output above the p2tr dust
    // floor; useful direction is up (a chunkier inscription UTXO).
    postage: new FormControl<number>(INSCRIBE_POSTAGE_SATS, {
      nonNullable: true,
      validators: [Validators.min(INSCRIBE_POSTAGE_SATS), Validators.max(1_000_000)],
    }),
    // The commit tx's own fee rate (ord's --commit-fee-rate). Null → the commit
    // pays the same rate as the reveal (the fee-rate field). Same relay floor.
    commitFeeRate: new FormControl<number | null>(null, {
      validators: [Validators.min(BITCOIN_MIN_RELAY_FEE_SAT_PER_VBYTE), Validators.max(1000)],
    }),
  });
  cfeeRate = this.form.controls.feeRate;
  noteControl = this.form.controls.note;
  titleControl = this.form.controls.title;
  metaprotocolControl = this.form.controls.metaprotocol;
  postageControl = this.form.controls.postage;
  commitFeeRateControl = this.form.controls.commitFeeRate;

  /**
   * The fee input's DISPLAYED string. The input is `type="text"` rather than
   * `type="number"` so its separator is always a dot, matching the fee presets,
   * instead of the browser locale's (a German browser renders type=number 0.2
   * as "0,2" while the presets stay "0.2"). Holds the raw keystrokes so entry
   * is never snapped mid-typing; {@link onFeeRateInput} coerces it to the
   * numeric control value.
   */
  feeRateDisplay = '1';

  // ---- Compression (content_encoding tag) ---------------------------------
  // assessCompression tries the available codecs and reports the smallest
  // (native gzip today via CompressionStream; the SDK reserves 'br' for a
  // future brotli encoder). It never decides for us. We default the toggle ON
  // iff `worthIt`; the user can override. ord serves the content_encoding tag
  // through as the HTTP header, so the browser decodes it on the way out.
  compression: CompressionAssessment | null = null;
  compressEnabled = false;

  // ---- Metadata (ord tag 5, CBOR) -----------------------------------------
  // Two authoring modes: a flat key-value editor, or a raw JSON textarea for
  // anything nested. Both feed one deterministic-CBOR encode; the bytes ride
  // along on setContent. Empty input emits no tag.
  metadataMode: 'kv' | 'json' = 'kv';
  metadataRows: { key: string; value: string }[] = [];
  metadataJson = '';
  metadataError = '';        // invalid JSON or un-encodable value (blocks mint)
  metadataModeHint = '';     // transient note when a JSON->KV switch is refused
  metadataBytes: Uint8Array | null = null;   // encoded CBOR, null when empty

  // ---- Traits (ord properties tag 17, ordered name/value pairs) ------------
  // Ordered [name, value] pairs in the creator's order, exactly as ord renders
  // them. The row order is the on-chain order. Values are strings here (the
  // common case); empty-named rows are dropped on the way to the orchestrator.
  // ord rejects a duplicate name (it drops the whole properties field), so the
  // editor flags a duplicate before the mint does.
  traitRows: { name: string; value: string }[] = [];

  // ---- Gallery (ord --gallery, tag 17 properties) --------------------------
  // Ordered list of inscription ids this inscription is a gallery of, in the
  // creator's order (the on-chain order). Each id is checked for existence
  // against our ord instance, because ord refuses to inscribe a gallery that
  // points at an inscription its index does not have. 'missing'/'invalid'
  // surface as a per-row error; 'unknown' (a failed lookup) never does.
  galleryRows: { id: string }[] = [];
  private galleryExistence = new Map<string, InscriptionExistence>();
  private galleryCheck$ = new Subject<void>();

  // ---- Rare-sat targeting (ord --sat / --satpoint) -------------------------
  // Post-connect only: scan the ordinals address's coins for a notable sat and
  // let the user inscribe onto it instead of a fresh common sat. The scan is
  // one ord /output lookup per coin (needs a sat index), so it is lazy (a
  // button), not automatic. 'unknown' rows (a failed lookup) are kept distinct
  // from scanned-but-common: only the latter means "no rare sat here".
  rareSatRows: SatPickerRow<TxnOutput>[] | null = null;
  rareSatLoading = false;
  rareSatError = '';
  selectedRareSat: SatPickerRow<TxnOutput> | null = null;
  /** Set from a failed inscribeSatSourceFromRow (e.g. a wrong-key mismatch). */
  rareSatTargetError = '';
  /** The satTarget the picked rare sat produces, threaded onto the content. */
  private satTarget: InscribeSatTarget | undefined;
  /** The connected wallet, for the ordinals public key the sat-source derivation needs. */
  private currentWallet: WalletInfo | null = null;

  // ---- Mode: inscribe a file, or delegate to an existing inscription -------
  // A delegate inscription carries an EMPTY body and a tag-11 pointer to
  // another inscription's id; ord renders the target's content. Note +
  // metadata still apply; compression + the dropzone do not.
  inscribeMode: 'file' | 'delegate' = 'file';
  delegateId = '';
  delegateIdError = '';

  // ---- Batch mode: inscribe several files in one commit --------------------
  // Additive to the single flow (default off). A batch is N file inscriptions
  // built into one commit + reveal (ord's batch, `separate-outputs`: each lands
  // at its own output on the ordinals address). The shared fee rate, postage,
  // and commit-fee apply to the whole batch; per-entry title/traits are a
  // later refinement. With no parents this signs once, like a single inscribe.
  batchMode = false;
  batchFiles: BatchEntry[] = [];
  batchError = '';

  ngOnInit(): void {
    this.seoService.setTitle('Inscribe a file');
    this.seoService.setDescription('Inscribe any file onto Bitcoin directly from your own wallet. No service fee, non-custodial, and every inscription mints two free CAT-21 cats.');

    this.recommendedFees$.pipe(take(1)).subscribe(({ fastestFee }) => {
      this.cfeeRate.setValue(fastestFee);
      this.feeRateDisplay = String(fastestFee);
      this.orchestrator.setFeeRate(fastestFee);
      this.recomputePreConnectCost();
      this.cd.detectChanges();
    });

    this.cfeeRate.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((rate) => {
      if (rate && rate > 0) {
        this.orchestrator.setFeeRate(rate);
        this.recomputePreConnectCost();
      }
    });

    // Editing the note re-synths the tag on the pending content and
    // refreshes the cost estimate (the note bytes count on-chain).
    this.noteControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncContent();
      this.recomputePreConnectCost();
    });

    // Editing the title re-synths the tag-17 properties and refreshes the cost.
    this.titleControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncContent();
      this.recomputePreConnectCost();
    });

    // Metaprotocol / postage / commit-fee-rate all change the on-chain shape or
    // cost, so each re-synths the content and refreshes the estimate.
    const advancedCtrls: AbstractControl[] = [this.metaprotocolControl, this.postageControl, this.commitFeeRateControl];
    for (const ctrl of advancedCtrls) {
      ctrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        this.syncContent();
        this.recomputePreConnectCost();
      });
    }

    // Debounced gallery existence check: a burst of keystrokes collapses into
    // one lookup against our ord instance once the user pauses typing.
    this.galleryCheck$.pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      void this.checkGalleryExistence();
    });

    // Wipe the scanner cache when one wallet swaps out for another.
    // takeUntilDestroyed: connectedWallet$ is the root WalletService's
    // never-completing BehaviorSubject, so without teardown each visit to this
    // routed component leaks the instance (and its captured file bytes).
    let lastWalletAddress: string | null = null;
    this.connectedWallet$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((w) => {
      this.currentWallet = w ?? null;
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
        // A rare-sat pick belongs to the wallet that owns the sat; drop it when
        // the wallet changes so a stale sat never rides onto a new wallet's tx.
        this.rareSatRows = null;
        this.selectedRareSat = null;
        this.rareSatError = '';
        this.syncContent();
      }
      lastWalletAddress = addr;
    });
  }

  // ---- File drop ----------------------------------------------------------

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (!this.isDragging) {
      this.isDragging = true;
      this.cd.markForCheck();
    }
  }

  onDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragging = false;
    this.cd.markForCheck();
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragging = false;
    const file = ev.dataTransfer?.files?.[0];
    if (file) {this.handleFile(file);}
  }

  onPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {this.handleFile(file);}
    input.value = '';
  }

  clearFile(): void {
    this.pickedFile = null;
    this.fileError = '';
    this.preConnectMintSats = null;
    this.compression = null;
    this.compressEnabled = false;
    this.resetMetadata();
    this.orchestrator.setContent(null);
    this.cd.markForCheck();
  }

  // ---- Batch mode ---------------------------------------------------------
  /** Switch between the single inscribe flow and the multi-file batch flow. */
  toggleBatchMode(on: boolean): void {
    if (on === this.batchMode) { return; }
    this.batchMode = on;
    this.batchError = '';
    this.mintGateError = '';
    if (on) {
      // Entering batch: drop any pending single content so only the batch mints.
      this.orchestrator.setContent(null);
    } else {
      this.batchFiles = [];
      this.orchestrator.setBatch(null);
    }
    this.syncContent();
    this.recomputePreConnectCost();
    this.cd.markForCheck();
  }

  onBatchPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    void this.addBatchFiles(files);
    input.value = '';
  }

  onBatchDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragging = false;
    const files = ev.dataTransfer?.files ? Array.from(ev.dataTransfer.files) : [];
    void this.addBatchFiles(files);
  }

  /** Read + validate dropped/picked files and append the good ones to the batch. */
  private async addBatchFiles(files: File[]): Promise<void> {
    this.batchError = '';
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const contentType = detectMimeType(bytes) ?? (file.type || 'application/octet-stream');
        if (BLOCKED_CONTENT_TYPES.includes(contentType.toLowerCase().split(';')[0].trim())) {
          this.batchError = `Skipped ${file.name}: JavaScript files can’t be inscribed here.`;
          continue;
        }
        if (bytes.length > MAX_CONTENT_BYTES) {
          this.batchError = `Skipped ${file.name}: over the ${MAX_CONTENT_BYTES / 1000} KB per-inscription cap.`;
          continue;
        }
        this.batchFiles = [...this.batchFiles, { name: file.name, bytes, contentType, sizeBytes: bytes.length, title: '', destination: '' }];
      } catch {
        this.batchError = `Skipped ${file.name}: could not read it.`;
      }
    }
    this.syncContent();
    this.cd.markForCheck();
  }

  removeBatchFile(index: number): void {
    this.batchFiles = this.batchFiles.filter((_, i) => i !== index);
    this.syncContent();
    this.cd.markForCheck();
  }

  /** Set one entry's per-inscription title. */
  setBatchEntryTitle(index: number, title: string): void {
    this.batchFiles = this.batchFiles.map((e, i) => i === index ? { ...e, title } : e);
    this.syncContent();
    this.cd.markForCheck();
  }

  /** Set one entry's destination address (empty = the shared recipient). */
  setBatchEntryDestination(index: number, destination: string): void {
    this.batchFiles = this.batchFiles.map((e, i) => i === index ? { ...e, destination } : e);
    this.syncContent();
    this.cd.markForCheck();
  }

  /** A destination that is set but not a plausible bitcoin address (blocks mint). */
  batchEntryDestinationInvalid(destination: string): boolean {
    const d = destination.trim();
    return d.length > 0 && !/^(bc1[a-z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{20,})$/.test(d);
  }

  /** `true` while any batch entry has an invalid destination (blocks mint). */
  get batchInvalid(): boolean {
    return this.batchMode && this.batchFiles.some((e) => this.batchEntryDestinationInvalid(e.destination));
  }

  clearBatch(): void {
    this.batchFiles = [];
    this.batchError = '';
    this.orchestrator.setBatch(null);
    this.cd.markForCheck();
  }

  /** Total on-chain body bytes across the batch (for the size readout). */
  get batchTotalBytes(): number {
    return this.batchFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
  }

  /** Build the batch (separate-outputs) and hand it to the orchestrator. */
  private syncBatch(): void {
    const postage = this.postageControl.value;
    const commitFee = this.commitFeeRateControl.value;
    if (!this.batchFiles.length) { this.orchestrator.setBatch(null); return; }
    const batch: InscribeBatchContent = {
      mode: 'separate-outputs',
      inscriptions: this.batchFiles.map((f) => ({
        source: { kind: 'file' as const, body: f.bytes, contentType: f.contentType },
        ...(f.title.trim() ? { title: f.title.trim() } : {}),
        ...(f.destination.trim() ? { destination: f.destination.trim() } : {}),
      })),
      ...(postage && postage !== INSCRIBE_POSTAGE_SATS ? { postageSats: postage } : {}),
      ...(commitFee && commitFee > 0 ? { commitFeeRatePerVbyte: commitFee } : {}),
    };
    this.orchestrator.setBatch(batch);
  }

  private async handleFile(file: File): Promise<void> {
    this.fileError = '';
    this.mintGateError = '';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const contentType = detectMimeType(bytes) ?? (file.type || 'application/octet-stream');

      if (BLOCKED_CONTENT_TYPES.includes(contentType.toLowerCase().split(';')[0].trim())) {
        this.pickedFile = null;
        this.orchestrator.setContent(null);
        this.fileError = `JavaScript files (${contentType}) can't be inscribed here.`;
        this.cd.markForCheck();
        return;
      }

      if (bytes.length > MAX_CONTENT_BYTES) {
        this.pickedFile = null;
        this.orchestrator.setContent(null);
        this.fileError = `This file is ${Math.ceil(bytes.length / 1000)} KB. On-chain inscriptions are capped at ${MAX_CONTENT_BYTES / 1000} KB. Compress it or pick a smaller file.`;
        this.cd.markForCheck();
        return;
      }

      this.pickedFile = { name: file.name, bytes, contentType, sizeBytes: bytes.length };
      // Pre-check compression; default the toggle on only when it's worth it.
      // Pass the same-origin wasm URL so Chrome/Edge (no native brotli encoder)
      // can still try brotli; Safari/Firefox/Node use their native one and
      // never fetch it. Built from document.baseURI to survive a <base href>.
      try {
        this.compression = await assessCompression(bytes, contentType, {
          brotliWasmUrl: new URL('assets/brotli_wasm_bg.wasm', document.baseURI).href,
        });
      } catch {
        this.compression = null;
      }
      this.compressEnabled = this.compression?.worthIt ?? false;
      this.syncContent();
      this.recomputePreConnectCost();
      this.cd.markForCheck();
    } catch {
      this.pickedFile = null;
      this.orchestrator.setContent(null);
      this.fileError = 'Could not read that file. Please try another.';
      this.cd.markForCheck();
    }
  }

  /** `true` when a content_encoding tag applies to the current body. */
  get isCompressed(): boolean {
    return this.compressEnabled && !!this.compression?.worthIt;
  }

  /** The winning codec's content_encoding value, or undefined when off/none. */
  get activeContentEncoding(): InscriptionContentEncoding | undefined {
    const c = this.compression;
    return this.isCompressed && c && c.bestEncoding !== 'none' ? c.bestEncoding : undefined;
  }

  /**
   * The bytes actually inscribed: the compressed output when compression is on
   * and worth it, otherwise the raw file. One source of truth for setContent,
   * the cost estimate, and the pre-flight gate so the three never disagree.
   */
  private finalBody(): Uint8Array | null {
    const file = this.pickedFile;
    if (!file) {return null;}
    const c = this.compression;
    return this.isCompressed && c ? c.compressed : file.bytes;
  }

  /** User flipped the compression checkbox: re-sync content + cost. */
  toggleCompression(enabled: boolean): void {
    this.compressEnabled = enabled;
    this.syncContent();
    this.recomputePreConnectCost();
    this.cd.markForCheck();
  }

  // ---- Metadata -----------------------------------------------------------

  /** `true` when the JSON textarea holds something that won't encode. */
  get metadataInvalid(): boolean {
    return !!this.metadataError;
  }

  addMetadataRow(): void {
    this.metadataRows.push({ key: '', value: '' });
    this.cd.markForCheck();
  }

  removeMetadataRow(i: number): void {
    this.metadataRows.splice(i, 1);
    this.rebuildMetadata();
  }

  setMetadataRow(i: number, key: string, value: string): void {
    const row = this.metadataRows[i];
    if (!row) {return;}
    row.key = key;
    row.value = value;
    this.rebuildMetadata();
  }

  onMetadataJsonChange(json: string): void {
    this.metadataJson = json;
    this.rebuildMetadata();
  }

  /** Switch author mode, carrying the current object across when it can. */
  switchMetadataMode(mode: 'kv' | 'json'): void {
    this.metadataModeHint = '';
    if (mode === this.metadataMode) {return;}

    if (mode === 'json') {
      const obj = this.kvToObject();
      this.metadataJson = Object.keys(obj).length ? JSON.stringify(obj, null, 2) : '';
      this.metadataMode = 'json';
    } else {
      const parsed = this.parseJsonMetadata();
      if (parsed.ok && this.isFlatPrimitiveObject(parsed.value)) {
        this.metadataRows = Object.entries(parsed.value).map(([key, v]) => ({
          key,
          value: v === null ? '' : String(v),
        }));
        this.metadataMode = 'kv';
      } else {
        // Nested / array / invalid JSON: JSON mode stays authoritative so we
        // never silently drop structure the flat editor can't hold.
        this.metadataModeHint = parsed.ok
          ? 'This JSON is nested or an array. The key-value editor only handles a flat object, so it stays in JSON mode.'
          : 'Fix the JSON before switching to the key-value editor.';
        this.cd.markForCheck();
        return;
      }
    }
    this.rebuildMetadata();
  }

  private kvToObject(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const { key, value } of this.metadataRows) {
      const k = key.trim();
      if (k) {obj[k] = value;}
    }
    return obj;
  }

  private parseJsonMetadata(): { ok: true; value: unknown } | { ok: false } {
    const raw = this.metadataJson.trim();
    if (!raw) {return { ok: true, value: {} };}
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false };
    }
  }

  private isFlatPrimitiveObject(v: unknown): v is Record<string, string | number | boolean | null> {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {return false;}
    return Object.values(v as Record<string, unknown>).every(
      (x) => x === null || ['string', 'number', 'boolean'].includes(typeof x));
  }

  /** Re-encode the current metadata to CBOR and push it into the content. */
  private rebuildMetadata(): void {
    this.metadataError = '';
    this.metadataModeHint = '';

    let obj: unknown;
    if (this.metadataMode === 'kv') {
      obj = this.kvToObject();
    } else {
      const parsed = this.parseJsonMetadata();
      if (!parsed.ok) {
        this.metadataError = 'Invalid JSON. Fix it or clear the field to inscribe without metadata.';
        this.metadataBytes = null;
        this.syncContent();
        this.recomputePreConnectCost();
        this.cd.markForCheck();
        return;
      }
      obj = parsed.value;
    }

    const isEmpty =
      obj == null ||
      (Array.isArray(obj) && obj.length === 0) ||
      (typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj as object).length === 0);

    if (isEmpty) {
      this.metadataBytes = null;
    } else {
      try {
        this.metadataBytes = encodeCborDeterministic(obj);
      } catch {
        this.metadataError = 'This metadata could not be encoded. Please simplify it.';
        this.metadataBytes = null;
      }
    }
    // The 350 KB cap bounds body + metadata + note (not just the file):
    // large metadata must not push the reveal past standard relay. Setting
    // metadataError here blocks the mint (metadataInvalid) with feedback.
    if (this.metadataBytes && !this.metadataError) {
      const body = this.finalBody() ?? new Uint8Array(0);
      if (this.totalContentBytes(body) > MAX_CONTENT_BYTES) {
        this.metadataError = `This metadata pushes the inscription over the ${MAX_CONTENT_BYTES / 1000} KB on-chain limit. Trim it or pick a smaller file.`;
      }
    }
    this.syncContent();
    this.recomputePreConnectCost();
    this.cd.markForCheck();
  }

  private resetMetadata(): void {
    this.metadataMode = 'kv';
    this.metadataRows = [];
    this.metadataJson = '';
    this.metadataError = '';
    this.metadataModeHint = '';
    this.metadataBytes = null;
  }

  // ---- Delegate mode ------------------------------------------------------

  /** ord inscription id shape: 64 hex, then 'i', then a non-negative index. */
  private isValidInscriptionId(id: string): boolean {
    return /^[0-9a-f]{64}i\d+$/i.test(id);
  }

  /** The validated target id (for preview + wiring), or null while empty/invalid. */
  get delegatePreviewId(): string | null {
    const id = this.delegateId.trim();
    return id && !this.delegateIdError ? id : null;
  }

  /** `true` while delegate mode has no usable target id (blocks mint). */
  get delegateInvalid(): boolean {
    return this.inscribeMode === 'delegate' && !this.delegatePreviewId;
  }

  /** Is there something to inscribe? A picked file, a valid delegate id, or batch files. */
  get hasContent(): boolean {
    if (this.batchMode) { return this.batchFiles.length > 0; }
    return this.inscribeMode === 'delegate' ? !!this.delegatePreviewId : !!this.pickedFile;
  }

  /** Switch between the file dropzone and the delegate-id input. */
  switchInscribeMode(mode: 'file' | 'delegate'): void {
    if (mode === this.inscribeMode) {return;}
    this.inscribeMode = mode;
    this.fileError = '';
    this.mintGateError = '';
    if (mode === 'delegate') {
      // The dropzone + compression don't apply to an empty-body delegate.
      this.pickedFile = null;
      this.compression = null;
      this.compressEnabled = false;
    } else {
      this.delegateId = '';
      this.delegateIdError = '';
    }
    this.syncContent();
    this.recomputePreConnectCost();
    this.cd.markForCheck();
  }

  onDelegateIdChange(id: string): void {
    this.delegateId = id;
    const trimmed = id.trim();
    this.delegateIdError = !trimmed || this.isValidInscriptionId(trimmed)
      ? ''
      : 'Enter a valid inscription id: 64 hex characters, then "i", then an index (e.g. abcd…i0).';
    this.syncContent();
    this.recomputePreConnectCost();
    this.cd.markForCheck();
  }

  /** Push the current content into the orchestrator (no tip: no service fee). */
  private syncContent(): void {
    if (this.batchMode) { this.syncBatch(); return; }
    const note = this.noteControl.value.trim();
    const title = this.titleControl.value.trim();
    const traits = this.buildTraits();
    const gallery = this.buildGallery();
    const metaprotocol = this.metaprotocolControl.value.trim();
    const postage = this.postageControl.value;
    const commitFee = this.commitFeeRateControl.value;
    const common = {
      note: note || undefined,
      metadata: this.metadataBytes ?? undefined,
      ...(title ? { title } : {}),
      ...(traits.length ? { traits } : {}),
      ...(gallery.length ? { gallery } : {}),
      ...(metaprotocol ? { metaprotocol } : {}),
      // Omit at the default (546): the SDK already defaults postageSats to it.
      ...(postage && postage !== INSCRIBE_POSTAGE_SATS ? { postageSats: postage } : {}),
      // Omit when empty: the commit then pays the reveal's fee rate.
      ...(commitFee && commitFee > 0 ? { commitFeeRatePerVbyte: commitFee } : {}),
      // The picked rare sat, when one is selected and buildable (see updateSatTarget).
      ...(this.satTarget ? { satTarget: this.satTarget } : {}),
    };

    if (this.inscribeMode === 'delegate') {
      const id = this.delegatePreviewId;
      if (!id) {this.orchestrator.setContent(null); return;}
      // A delegate carries no body of its own; ord serves the target's content.
      this.orchestrator.setContent({ source: { kind: 'delegate', delegate: id }, ...common });
      return;
    }

    const body = this.finalBody();
    if (!this.pickedFile || !body) {this.orchestrator.setContent(null); return;}
    this.orchestrator.setContent({
      source: { kind: 'file', body, contentType: this.pickedFile.contentType },
      contentEncoding: this.activeContentEncoding,
      ...common,
    });
  }

  // ---- Traits editor -------------------------------------------------------
  addTraitRow(): void {
    this.traitRows = [...this.traitRows, { name: '', value: '' }];
    this.cd.markForCheck();
  }

  removeTraitRow(index: number): void {
    this.traitRows = this.traitRows.filter((_, i) => i !== index);
    this.onTraitsChanged();
  }

  onTraitNameChange(index: number, name: string): void {
    this.traitRows = this.traitRows.map((r, i) => i === index ? { ...r, name } : r);
    this.onTraitsChanged();
  }

  onTraitValueChange(index: number, value: string): void {
    this.traitRows = this.traitRows.map((r, i) => i === index ? { ...r, value } : r);
    this.onTraitsChanged();
  }

  private onTraitsChanged(): void {
    this.syncContent();
    this.recomputePreConnectCost();
    this.cd.markForCheck();
  }

  /**
   * Ordered [name, value] pairs from the editor, dropping empty-named rows.
   * Values stay strings (the common trait shape); the row order is preserved,
   * so it is the on-chain order.
   */
  private buildTraits(): Array<[string, string]> {
    return this.traitRows
      .map((r) => [r.name.trim(), r.value] as [string, string])
      .filter(([name]) => name.length > 0);
  }

  /**
   * The first trait name that appears more than once (case-sensitive, matching
   * ord), or '' if none. ord drops the whole properties field on a duplicate,
   * so the editor warns before the mint's `duplicate-trait` error.
   */
  get traitDuplicateName(): string {
    const seen = new Set<string>();
    for (const [name] of this.buildTraits()) {
      if (seen.has(name)) { return name; }
      seen.add(name);
    }
    return '';
  }

  // ---- Gallery editor ------------------------------------------------------
  addGalleryRow(): void {
    this.galleryRows = [...this.galleryRows, { id: '' }];
    this.cd.markForCheck();
  }

  removeGalleryRow(index: number): void {
    this.galleryRows = this.galleryRows.filter((_, i) => i !== index);
    this.onGalleryChanged();
  }

  onGalleryIdChange(index: number, id: string): void {
    this.galleryRows = this.galleryRows.map((r, i) => i === index ? { id } : r);
    this.onGalleryChanged();
  }

  private onGalleryChanged(): void {
    this.syncContent();
    this.recomputePreConnectCost();
    this.galleryCheck$.next();
    this.cd.markForCheck();
  }

  /**
   * Ordered inscription ids from the editor, dropping empty rows. Row order is
   * preserved, so it is the on-chain gallery order. Malformed ids are passed
   * through: the mint gate (and the per-row status) is the backstop.
   */
  private buildGallery(): string[] {
    return this.galleryRows
      .map((r) => r.id.trim())
      .filter((id) => id.length > 0);
  }

  /**
   * Look up every well-formed gallery id we have not resolved yet against our
   * ord instance, caching the result. 'unknown' (a failed lookup) is not
   * cached as definitive, so it is retried on the next change. A whole-batch
   * failure is swallowed: the rows just stay in the 'checking' state.
   */
  private async checkGalleryExistence(): Promise<void> {
    const ids = this.buildGallery().filter((id) => this.isValidInscriptionId(id));
    const toCheck = ids.filter((id) => {
      const s = this.galleryExistence.get(id);
      return s === undefined || s === 'unknown';
    });
    if (!toCheck.length) { return; }
    try {
      const result = await checkInscriptionsExist(toCheck, { ordBaseUrl: environment.ordBaseUrls[0] });
      for (const [id, state] of result) { this.galleryExistence.set(id, state); }
    } catch {
      // Leave the rows in 'checking'; a failed lookup is never shown as missing.
    }
    this.cd.markForCheck();
  }

  /**
   * The display status of one gallery row, for the template. 'unknown' from
   * the server (a failed lookup) maps to 'checking', never 'missing'.
   */
  galleryItemStatus(id: string): 'empty' | 'invalid' | 'checking' | 'exists' | 'missing' {
    const trimmed = id.trim();
    if (!trimmed) { return 'empty'; }
    if (!this.isValidInscriptionId(trimmed)) { return 'invalid'; }
    const state = this.galleryExistence.get(trimmed);
    if (state === undefined || state === 'unknown') { return 'checking'; }
    if (state === 'exists') { return 'exists'; }
    return 'missing';
  }

  /** `true` while any gallery row is malformed or points at a missing inscription (blocks mint). */
  get galleryInvalid(): boolean {
    return this.galleryRows.some((r) => {
      const status = this.galleryItemStatus(r.id);
      return status === 'invalid' || status === 'missing';
    });
  }

  // ---- Rare-sat picker -----------------------------------------------------
  /**
   * Scan the ordinals address's coins for notable sats. One ord `/output`
   * lookup per coin (via `findRareSatsInOutputs`, needs a sat index), so it is
   * lazy: the user asks for it. A whole-scan failure sets `rareSatError`; a
   * per-coin lookup failure comes back as a `status: 'unknown'` row, never as
   * "this coin holds nothing".
   */
  async scanForRareSats(ordinalsAddress: string): Promise<void> {
    this.rareSatLoading = true;
    this.rareSatError = '';
    this.cd.markForCheck();
    try {
      const utxos = await this.getDedupedUtxos(ordinalsAddress);
      this.rareSatRows = await findRareSatsInOutputs(utxos, { ordBaseUrl: environment.ordBaseUrls[0] });
    } catch {
      this.rareSatError = 'Could not scan for rare sats. Please try again.';
      this.rareSatRows = null;
    } finally {
      this.rareSatLoading = false;
      this.cd.markForCheck();
    }
  }

  /** Coins the scan found a rare sat on (the only ones the picker offers). */
  get rareSatCandidates(): SatPickerRow<TxnOutput>[] {
    return (this.rareSatRows ?? []).filter((r) => r.status === 'scanned' && r.rareSat !== null);
  }

  /** Coins whose lookup failed (shown as "couldn't check", NOT "no rare sat"). */
  get rareSatUnknownCount(): number {
    return (this.rareSatRows ?? []).filter((r) => r.status === 'unknown').length;
  }

  /** A scan ran and returned rows, but none carry a rare sat (all common / unknown). */
  get rareSatScannedEmpty(): boolean {
    return this.rareSatRows !== null && this.rareSatCandidates.length === 0;
  }

  /** Toggle a rare-sat row as the inscribe target (re-click clears it). */
  pickRareSat(row: SatPickerRow<TxnOutput>): void {
    this.selectedRareSat = this.selectedRareSat === row ? null : row;
    this.updateSatTarget();
    this.syncContent();
    this.cd.markForCheck();
  }

  /** Clear the rare-sat target (inscribe onto a fresh common sat again). */
  clearRareSat(): void {
    if (!this.selectedRareSat) { return; }
    this.selectedRareSat = null;
    this.updateSatTarget();
    this.syncContent();
    this.cd.markForCheck();
  }

  /**
   * Derive the satTarget for the picked rare sat, once per pick (not per
   * keystroke). Built via the SDK's inscribeSatSourceFromRow, which derives
   * scriptPubKey (tweaked output key) + tapInternalKey (untweaked internal
   * key) from the wallet's ordinals key and THROWS on a key that does not
   * derive the coin's address, before any signature. A sat that needs a
   * padding coin is left unbuilt in this version (see rareSatBlocked), so the
   * mint is blocked rather than inscribing on a common sat by surprise.
   */
  private updateSatTarget(): void {
    this.rareSatTargetError = '';
    this.satTarget = undefined;
    const row = this.selectedRareSat;
    if (!row || !row.rareSat || !this.currentWallet) { return; }
    if (this.rareSatPadding?.needsPadding) { return; } // blocked in v1: no padding coin sourced
    try {
      const source = inscribeSatSourceFromRow(row, {
        ordinalsPublicKey: this.currentWallet.ordinalsPublicKey,
        network: this.network,
      });
      if (source) { this.satTarget = { kind: 'in-utxo', utxo: source, offset: source.offset }; }
    } catch (err) {
      this.rareSatTargetError = inscribeUserMessage(err);
    }
  }

  /**
   * A rare sat is picked but no satTarget could be produced for it: either it
   * needs a padding coin (not sourced in this version) or the key derivation
   * failed. Blocks the mint so the inscription never silently lands on a
   * common sat instead of the one the user chose.
   */
  get rareSatBlocked(): boolean {
    return !!this.selectedRareSat?.rareSat && !this.satTarget;
  }

  /** Why the picked rare sat is blocked, for the template. */
  get rareSatBlockReason(): string {
    if (!this.rareSatBlocked) { return ''; }
    if (this.rareSatTargetError) { return this.rareSatTargetError; }
    const pad = this.rareSatPadding;
    if (pad?.needsPadding) {
      return `This sat sits ${pad.shortfallSats} sats below its coin’s dust floor, so moving it needs a separate padding coin. That is not supported here yet; pick a sat at or above the floor, or inscribe onto a fresh sat.`;
    }
    return 'This sat cannot be targeted from the connected wallet.';
  }

  /**
   * Whether the selected rare sat needs a padding coin, and the shortfall.
   * The floor is the SAT COIN'S OWN address (the padding output returns there),
   * not the payment address; `satPaddingRequirement` applies the per-address
   * dust rule (taproot 330, p2wpkh 294). `null` when nothing is selected.
   */
  get rareSatPadding(): { needsPadding: boolean; shortfallSats: number; dustLimitSats: number } | null {
    const row = this.selectedRareSat;
    if (!row || !row.rareSat || !row.address) { return null; }
    return satPaddingRequirement(row.rareSat.offset, row.address);
  }

  /**
   * The envelope fields (delegate OR content_encoding, note, metadata,
   * metaprotocol, and tag-17 properties) the orchestrator emits for the
   * current form. The pre-connect estimate feeds these to
   * `simulateInscribeFees` so it matches the exact post-connect figure instead
   * of undercounting by the note + metadata + metaprotocol + properties bytes.
   */
  private simEnvelopeFields(): OrdEnvelopeField[] {
    const enc = new TextEncoder();
    const fields: OrdEnvelopeField[] = [];
    if (this.inscribeMode === 'delegate') {
      const id = this.delegatePreviewId;
      if (id) {fields.push({ tag: ORD_TAGS.delegate, value: encodeInscriptionId(id) });}
    } else if (this.activeContentEncoding) {
      fields.push({ tag: ORD_TAGS.content_encoding, value: enc.encode(this.activeContentEncoding) });
    }
    const note = this.noteControl.value.trim();
    if (note) {fields.push({ tag: ORD_TAGS.note, value: enc.encode(note) });}
    if (this.metadataBytes) {fields.push({ tag: ORD_TAGS.metadata, value: this.metadataBytes });}
    const metaprotocol = this.metaprotocolControl.value.trim();
    if (metaprotocol) {fields.push({ tag: ORD_TAGS.metaprotocol, value: enc.encode(metaprotocol) });}
    // Tag-17 properties (title + traits + gallery), encoded exactly as ord
    // (and the orchestrator) does, so the estimate counts them too.
    const props = encodeInscriptionProperties({
      title: this.titleControl.value.trim() || undefined,
      traits: this.buildTraits().length ? this.buildTraits() : undefined,
      gallery: this.buildGallery().length ? this.buildGallery() : undefined,
    });
    if (props) {fields.push({ tag: ORD_TAGS.properties, value: props.properties });}
    return fields;
  }

  /**
   * Total on-chain content bytes: body + CBOR metadata + note. The 350 KB
   * cap must bound this SUM, not just the file body, otherwise large
   * metadata (uncapped by the file dropzone) can push the reveal over
   * standard relay. Inscriptions are immutable, so this is a hard gate.
   */
  private totalContentBytes(body: Uint8Array): number {
    const note = this.noteControl.value.trim();
    return body.length + (this.metadataBytes?.length ?? 0) + new TextEncoder().encode(note).length;
  }

  private recomputePreConnectCost(): void {
    this.preConnectMintSats = null;
    // Batch pre-connect cost isn't estimated here; the funding simulation
    // prices the batch once a wallet connects.
    if (this.batchMode) { return; }
    const feeRate = this.cfeeRate.value;
    // Reject non-finite rates (Infinity from a `1e999` input, NaN) so the
    // estimate never renders "Infinity sat".
    if (!feeRate || !Number.isFinite(feeRate) || feeRate <= 0) {return;}

    let body: Uint8Array;
    let contentType: string | undefined;
    if (this.inscribeMode === 'delegate') {
      if (!this.delegatePreviewId) {return;}
      body = new Uint8Array(0);
    } else {
      const b = this.finalBody();
      if (!this.pickedFile || !b) {return;}
      body = b;
      contentType = this.pickedFile.contentType;
    }
    const envelopeFields = this.simEnvelopeFields();

    try {
      const scureNet = toScureNetwork(this.network);
      const dummy = getDummyKeypair(scureNet);
      const fundingInput = prepareInscribeFundingInput({
        utxo: { txid: 'f'.repeat(64), vout: 0, value: 10_000_000, status: { confirmed: true } },
        paymentPublicKey: dummy.dummyPublicKey,
        paymentAddress: dummy.addressP2WPKH,
        isSimulation: true,
        network: this.network,
      });
      const commitFee = this.commitFeeRateControl.value;
      const sim = simulateInscribeFees({
        feeRatePerVbyte: feeRate,
        commitFeeRatePerVbyte: commitFee && commitFee > 0 ? commitFee : undefined,
        postageSats: this.postageControl.value,
        body,
        contentType,
        envelopeFields: envelopeFields.length ? envelopeFields : undefined,
        fundingInput,
        senderChangeAddress: dummy.addressP2WPKH,
        recipientAddress: dummy.addressP2TR,
        ephemeralPubkeyXonly: dummy.xOnlyDummyPublicKey,
        network: this.network,
      });
      this.preConnectMintSats = sim.fundingRequirementSats;
    } catch (err) {
      console.warn('[inscribe] pre-connect cost simulation failed', err);
      this.preConnectMintSats = null;
    }
  }

  // ---- Cost readouts ------------------------------------------------------

  /** Exact wallet debit for the selected UTXO, dust-aware. */
  totalSpendSats(wallet: WalletInfo | null | undefined): number | null {
    const row = this.selectedPaymentOutput;
    if (!row) {return null;}
    const funding = row.simulation.fundingRequirementSats;
    if (!wallet) {return funding;}
    const changeMin = getMinimumUtxoSize(wallet.paymentAddress);
    const change = row.paymentOutput.value - funding;
    return change < changeMin ? row.paymentOutput.value : funding;
  }

  // ---- Commands -----------------------------------------------------------

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

  selectPaymentOutput(row: ViableInscribeSimulation): void {
    this.selectedPaymentOutput = row;
    this.orchestrator.setSelectedUtxo(row.paymentOutput);
  }

  scanRow(row: ViableInscribeSimulation): void {
    this.scanner.scan(`${row.paymentOutput.txid}:${row.paymentOutput.vout}`).subscribe();
  }

  runeNames(content: UtxoContent): string[] { return runeNamesFromContent(content); }

  bucketTooltip(bucket: UtxoScanBucket): string {
    switch (bucket) {
      case 'clean':
        return 'We checked this UTXO against ord and cat21-ord. No inscriptions, runes, or cats. Safe to use as a mint input.';
      case 'assets':
        return 'This UTXO holds at least one inscription, rune, or CAT-21 cat. Spending it as a mint input would send the asset away to the miner as fee. Use "Use anyway" only if you really mean to.';
      case 'unscanned':
        return `Above the auto-scan threshold (${AUTO_SCAN_MAX_VALUE_SAT.toLocaleString()} sat) and very likely a plain payment. Click "Scan" to verify against ord and cat21-ord.`;
      case 'scanning':
        return 'Checking ord and cat21-ord for inscriptions, runes, and cats at this UTXO.';
      case 'failed':
        return 'One of the asset-detection endpoints didn\'t respond. Click "Retry scan" to try again.';
    }
  }

  /**
   * Whether the connected wallet hands out one address for both payments and
   * ordinals. Delegates to the SDK's {@link usesSingleAddress} (single source
   * of truth): it compares the two addresses actually returned, covering every
   * single-address wallet (UniSat, Wizz, OKX, Binance, Alby) without a
   * per-wallet list.
   */
  isSingleAddressWallet(wallet: WalletInfo | null | undefined): boolean {
    return usesSingleAddress(wallet);
  }

  /**
   * The approved single-address custody caveat, printed verbatim (never
   * rewritten). Called with the 'cats' noun because every inscribe through the
   * SDK also mints CAT-21 cats on the single address (nLockTime=21), and with
   * the connected wallet's display label so the sentence names it ("Your
   * UniSat wallet keeps..."). The SDK owns the wording and the opener grammar,
   * so a refinement is a pin bump, not a copy edit here.
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

  inscriptionId(revealTxId: string): string {
    return `${revealTxId}i0`;
  }

  inscribe(wallet: WalletInfo): void {
    if (this.batchMode) { this.inscribeBatch(wallet); return; }
    // The gate + orchestrator see the exact bytes that land on-chain
    // (compressed when the box is ticked, or empty for a delegate), so the
    // size check is accurate.
    let body: Uint8Array;
    let contentType: string | undefined;
    if (this.inscribeMode === 'delegate') {
      if (!this.delegatePreviewId) {return;}
      body = new Uint8Array(0);
    } else {
      const b = this.finalBody();
      if (!this.pickedFile || !b) {return;}
      body = b;
      contentType = this.pickedFile.contentType;
    }
    this.mintGateError = '';
    this.mintAttempted = true;

    // The 350 KB cap must bound the TOTAL content (body + metadata + note),
    // not just the file body the SDK gate sees. Inscriptions are immutable,
    // so this is a hard stop.
    const total = this.totalContentBytes(body);
    if (total > MAX_CONTENT_BYTES) {
      this.mintGateError = `This inscription is ${Math.ceil(total / 1000)} KB (file + metadata + note); the on-chain cap is ${MAX_CONTENT_BYTES / 1000} KB. Trim the metadata or pick a smaller file.`;
      this.cd.detectChanges();
      return;
    }

    const gate = validateInscribeOperation({
      config: {
        network: this.network,
        maxFeeRatePerVbyte: 1000,
        maxContentBytes: MAX_CONTENT_BYTES,
        blockedContentTypes: BLOCKED_CONTENT_TYPES,
        // Skip the self-send guard for single-address wallets
        // (Unisat/Wizz/OKX): payment === ordinals is by design there.
        ownPaymentAddress: wallet.paymentAddress === wallet.ordinalsAddress
          ? undefined
          : wallet.paymentAddress,
      },
      operation: {
        kind: 'inscribe',
        intent: {
          recipient: wallet.ordinalsAddress,
          feeRate: this.cfeeRate.value,
          body,
          contentType,
        },
      },
    });

    if (gate.ok) {
      // Belt-and-braces: re-sync content in case a debounce hadn't fired.
      this.syncContent();
      // Watch-only (xpub) wallets sign via the export/paste bridge; injected
      // wallets ignore the callback, so it is passed unconditionally.
      const prompt = (unsigned: { base64: string; hex: string }) =>
        firstValueFrom(this.psbtExportPrompt.promptForSignedPsbt(unsigned, 'inscription-unsigned.psbt'));
      this.orchestrator.mint(prompt)
        .then(() => this.cd.markForCheck())
        .catch(() => this.cd.markForCheck());
      return;
    }

    // ordpool's tsconfig is non-strict (mempool fork), so TS doesn't
    // narrow the discriminated union after `if (gate.ok)`. Cast to the
    // failure arm explicitly.
    const failure = gate as Extract<InscribeOperationGateResult, { ok: false }>;
    const detail = failure.detail ? ': ' + failure.detail : '';
    this.mintGateError = `Inscription refused (${failure.reason}${detail}). This is a safety check. Please report if you were inscribing a normal file.`;
    this.cd.detectChanges();
  }

  /**
   * Mint a batch: gate every entry with the same safety check as a single
   * inscribe (JS-MIME block, size cap, self-send guard), then build + broadcast
   * the whole batch through the orchestrator. With no parents the wallet signs
   * once, exactly like a single inscribe.
   */
  private inscribeBatch(wallet: WalletInfo): void {
    this.mintGateError = '';
    this.mintAttempted = true;
    if (!this.batchFiles.length) { return; }
    for (const f of this.batchFiles) {
      const gate = validateInscribeOperation({
        config: {
          network: this.network,
          maxFeeRatePerVbyte: 1000,
          maxContentBytes: MAX_CONTENT_BYTES,
          blockedContentTypes: BLOCKED_CONTENT_TYPES,
          ownPaymentAddress: wallet.paymentAddress === wallet.ordinalsAddress ? undefined : wallet.paymentAddress,
        },
        operation: {
          kind: 'inscribe',
          intent: { recipient: wallet.ordinalsAddress, feeRate: this.cfeeRate.value, body: f.bytes, contentType: f.contentType },
        },
      });
      if (!gate.ok) {
        const failure = gate as Extract<InscribeOperationGateResult, { ok: false }>;
        const detail = failure.detail ? ': ' + failure.detail : '';
        this.mintGateError = `${f.name} refused (${failure.reason}${detail}). This is a safety check.`;
        this.cd.detectChanges();
        return;
      }
    }
    this.syncContent(); // belt-and-braces: rebuild the batch in case a debounce hadn't fired
    const prompt = (unsigned: { base64: string; hex: string }) =>
      firstValueFrom(this.psbtExportPrompt.promptForSignedPsbt(unsigned, 'inscription-unsigned.psbt'));
    this.orchestrator.mint(prompt)
      .then(() => this.cd.markForCheck())
      .catch(() => this.cd.markForCheck());
  }

  inscribeAnother(): void {
    this.orchestrator.reset();
    this.pickedFile = null;
    this.fileError = '';
    this.mintGateError = '';
    this.preConnectMintSats = null;
    this.mintAttempted = false;
    this.compression = null;
    this.compressEnabled = false;
    this.resetMetadata();
    this.inscribeMode = 'file';
    this.delegateId = '';
    this.delegateIdError = '';
    this.noteControl.setValue('ordpool.space');
    // Clear the Advanced options back to their defaults for the next inscription.
    this.titleControl.setValue('');
    this.traitRows = [];
    this.galleryRows = [];
    this.galleryExistence.clear();
    this.metaprotocolControl.setValue('');
    this.postageControl.setValue(INSCRIBE_POSTAGE_SATS);
    this.commitFeeRateControl.setValue(null);
    this.rareSatRows = null;
    this.selectedRareSat = null;
    this.rareSatError = '';
    this.rareSatTargetError = '';
    this.satTarget = undefined;
    this.batchMode = false;
    this.batchFiles = [];
    this.batchError = '';
    this.orchestrator.setBatch(null);
    this.cd.detectChanges();
  }
}
