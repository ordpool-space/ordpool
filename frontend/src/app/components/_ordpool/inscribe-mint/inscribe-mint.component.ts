import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { combineLatest, map, take, tap } from 'rxjs';

import { detectMimeType } from 'ordpool-parser';
import {
  AUTO_SCAN_MAX_VALUE_SAT,
  CompressionAssessment,
  INSCRIBE_POSTAGE_SATS,
  InscribeMintOrchestrator,
  InscribeOperationGateResult,
  InscribeUtxoSimulation,
  InscriptionContentEncoding,
  ORD_TAGS,
  OrdEnvelopeField,
  SMALL_UTXO_WARNING_THRESHOLD_SAT,
  SimulateInscribeFeesResult,
  TxnOutput,
  UtxoContent,
  UtxoContentScanner,
  UtxoScanBucket,
  UtxoScanState,
  WalletInfo,
  WalletService,
  assessCompression,
  bitcoinNetwork,
  bucketOf,
  cat21Config,
  encodeCborDeterministic,
  encodeInscriptionId,
  findAutoPickCandidate,
  getDummyKeypair,
  getMinimumUtxoSize,
  prepareInscribeFundingInput,
  runeNamesFromContent,
  simulateInscribeFees,
  toScureNetwork,
  validateInscribeOperation,
} from 'ordpool-sdk';

import { StateService } from '../../../services/state.service';
import { SeoService } from '../../../services/seo.service';

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
  private orchestrator = inject(InscribeMintOrchestrator);
  private scanner = inject(UtxoContentScanner);
  private config = inject(cat21Config);
  private network = inject(bitcoinNetwork);
  cd = inject(ChangeDetectorRef);
  seoService = inject(SeoService);

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
    this.orchestrator.simulations$,
    this.scanner.states$,
  ]).pipe(
    map(([rows, scanMap]): ViableInscribeSimulation[] => {
      return (rows as InscribeUtxoSimulation[])
        .filter((r): r is { utxo: TxnOutput; simulation: SimulateInscribeFeesResult; insufficient: false } =>
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
  );

  selectedPaymentOutput: ViableInscribeSimulation | undefined;

  // ---- State-machine projections ------------------------------------------

  private state = this.orchestrator.state;
  readonly utxoLoading = computed(() => this.state() === 'loading-utxos');
  readonly utxoError = computed(() =>
    this.state() === 'error' && !this.orchestrator.successResult() && !this.mintAttempted
      ? this.orchestrator.errorMessage() ?? ''
      : '',
  );
  readonly mintLoading = computed(() => this.state() === 'minting');
  readonly mintSuccess = computed(() =>
    this.state() === 'success' ? this.orchestrator.successResult() : null,
  );
  readonly mintError = computed(() =>
    this.state() === 'error' && this.mintAttempted
      ? this.orchestrator.errorMessage() ?? ''
      : '',
  );

  private mintAttempted = false;
  mintGateError = '';

  form = new FormGroup({
    feeRate: new FormControl(1, {
      validators: [Validators.required, Validators.min(0.1)],
      nonNullable: true,
    }),
    // Prefilled watermark so we can measure how many inscriptions came
    // through ordpool; the user can clear it. Empty → no note tag.
    note: new FormControl('ordpool.space', { nonNullable: true }),
  });
  cfeeRate = this.form.controls.feeRate;
  noteControl = this.form.controls.note;

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

  // ---- Mode: inscribe a file, or delegate to an existing inscription -------
  // A delegate inscription carries an EMPTY body and a tag-11 pointer to
  // another inscription's id; ord renders the target's content. Note +
  // metadata still apply; compression + the dropzone do not.
  inscribeMode: 'file' | 'delegate' = 'file';
  delegateId = '';
  delegateIdError = '';

  ngOnInit(): void {
    this.seoService.setTitle('Inscribe a file');
    this.seoService.setDescription('Inscribe any file onto Bitcoin directly from your own wallet. No service fee, non-custodial, and every inscription mints two free CAT-21 cats.');

    this.recommendedFees$.pipe(take(1)).subscribe(({ fastestFee }) => {
      this.cfeeRate.setValue(fastestFee);
      this.orchestrator.setFeeRate(this.cfeeRate.value);
      this.recomputePreConnectCost();
      this.cd.detectChanges();
    });

    this.cfeeRate.valueChanges.subscribe((rate) => {
      if (rate && rate > 0) {
        this.orchestrator.setFeeRate(rate);
        this.recomputePreConnectCost();
      }
    });

    // Editing the note re-synths the tag on the pending content.
    this.noteControl.valueChanges.subscribe(() => this.syncContent());

    // Wipe the scanner cache when one wallet swaps out for another.
    let lastWalletAddress: string | null = null;
    this.connectedWallet$.subscribe((w) => {
      const addr = w?.ordinalsAddress ?? null;
      if (lastWalletAddress !== null && addr !== lastWalletAddress) {
        this.scanner.reset();
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
        this.fileError = `This file is ${Math.ceil(bytes.length / 1024)} KB. On-chain inscriptions are capped at ${MAX_CONTENT_BYTES / 1000} KB. Compress it or pick a smaller file.`;
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
    this.syncContent();
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

  /** Is there something to inscribe? A picked file, or a valid delegate id. */
  get hasContent(): boolean {
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
    const note = this.noteControl.value.trim();
    const common = {
      note: note || undefined,
      metadata: this.metadataBytes ?? undefined,
    };

    if (this.inscribeMode === 'delegate') {
      const id = this.delegatePreviewId;
      if (!id) {this.orchestrator.setContent(null); return;}
      // A delegate carries an empty body and no content_type of its own.
      this.orchestrator.setContent({ body: new Uint8Array(0), delegate: id, ...common });
      return;
    }

    const body = this.finalBody();
    if (!this.pickedFile || !body) {this.orchestrator.setContent(null); return;}
    this.orchestrator.setContent({
      body,
      contentType: this.pickedFile.contentType,
      contentEncoding: this.activeContentEncoding,
      ...common,
    });
  }

  private recomputePreConnectCost(): void {
    this.preConnectMintSats = null;
    const feeRate = this.cfeeRate.value;
    if (!feeRate || feeRate <= 0) {return;}

    let body: Uint8Array;
    let contentType: string | undefined;
    let envelopeFields: OrdEnvelopeField[] | undefined;
    if (this.inscribeMode === 'delegate') {
      const id = this.delegatePreviewId;
      if (!id) {return;}
      // Empty body; the delegate tag is what sizes the reveal, so include it.
      body = new Uint8Array(0);
      envelopeFields = [{ tag: ORD_TAGS.delegate, value: encodeInscriptionId(id) }];
    } else {
      const b = this.finalBody();
      if (!this.pickedFile || !b) {return;}
      body = b;
      contentType = this.pickedFile.contentType;
    }

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
      const sim = simulateInscribeFees({
        feeRatePerVbyte: feeRate,
        body,
        contentType,
        envelopeFields,
        fundingInput,
        senderChangeAddress: dummy.addressP2WPKH,
        recipientAddress: dummy.addressP2TR,
        ephemeralPubkeyXonly: dummy.xOnlyDummyPublicKey,
        network: this.network,
      });
      this.preConnectMintSats = sim.fundingRequirementSats;
    } catch {
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

  isSingleAddressWallet(wallet: WalletInfo | null | undefined): boolean {
    if (!wallet) {return false;}
    return wallet.ordinalsAddress === wallet.paymentAddress;
  }

  inscriptionId(revealTxId: string): string {
    return `${revealTxId}i0`;
  }

  inscribe(wallet: WalletInfo): void {
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
      this.orchestrator.mint().subscribe({
        next: () => this.cd.detectChanges(),
        error: () => this.cd.detectChanges(),
      });
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
    this.cd.detectChanges();
  }
}
