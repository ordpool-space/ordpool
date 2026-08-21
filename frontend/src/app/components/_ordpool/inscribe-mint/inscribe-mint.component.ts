import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { combineLatest, map, take, tap } from 'rxjs';

import { detectMimeType } from 'ordpool-parser';
import {
  AUTO_SCAN_MAX_VALUE_SAT,
  INSCRIBE_POSTAGE_SATS,
  InscribeMintOrchestrator,
  InscribeOperationGateResult,
  InscribeUtxoSimulation,
  SMALL_UTXO_WARNING_THRESHOLD_SAT,
  SimulateInscribeFeesResult,
  TxnOutput,
  UtxoContent,
  UtxoContentScanner,
  UtxoScanBucket,
  UtxoScanState,
  WalletInfo,
  WalletService,
  bitcoinNetwork,
  bucketOf,
  cat21Config,
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
 * gate's DEFAULT_MAX_CONTENT_BYTES — keeps the reveal under standard
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
  });
  cfeeRate = this.form.controls.feeRate;

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
        this.fileError = `This file is ${Math.ceil(bytes.length / 1024)} KB. On-chain inscriptions are capped at ${MAX_CONTENT_BYTES / 1000} KB — compress it or pick a smaller file.`;
        this.cd.markForCheck();
        return;
      }

      this.pickedFile = { name: file.name, bytes, contentType, sizeBytes: bytes.length };
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

  /** Push the current file into the orchestrator (no tip: no service fee). */
  private syncContent(): void {
    if (!this.pickedFile) {return;}
    this.orchestrator.setContent({
      body: this.pickedFile.bytes,
      contentType: this.pickedFile.contentType,
    });
  }

  private recomputePreConnectCost(): void {
    this.preConnectMintSats = null;
    const file = this.pickedFile;
    const feeRate = this.cfeeRate.value;
    if (!file || !feeRate || feeRate <= 0) {return;}
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
        body: file.bytes,
        contentType: file.contentType,
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
        return 'We checked this UTXO against ord and cat21-ord. No inscriptions, runes, or cats — safe to use as a mint input.';
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
    if (!this.pickedFile) {return;}
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
          body: this.pickedFile.bytes,
          contentType: this.pickedFile.contentType,
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
    this.mintGateError = `Inscription refused (${failure.reason}${detail}). This is a safety check — please report if you were inscribing a normal file.`;
    this.cd.detectChanges();
  }

  inscribeAnother(): void {
    this.orchestrator.reset();
    this.pickedFile = null;
    this.fileError = '';
    this.mintGateError = '';
    this.preConnectMintSats = null;
    this.mintAttempted = false;
    this.cd.detectChanges();
  }
}
