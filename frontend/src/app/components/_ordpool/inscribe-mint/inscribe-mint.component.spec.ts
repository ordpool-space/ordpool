/**
 * Same ESM-dodge as cat21-mint.component.spec: mock ordpool-sdk +
 * ordpool-parser wholesale so Jest's CJS runner never loads the
 * sats-connect ESM chain. The component's DI targets the same class
 * identities we provide via TestBed.
 */
let gateResult: { ok: true; resources: object } | { ok: false; reason: string; detail?: string } = {
  ok: true,
  resources: {},
};
const setContentSpy = jest.fn();
const mintSpy = jest.fn();
const validateSpy = jest.fn();
const simulateSpy = jest.fn();

// Swappable per-test so we can exercise the worthIt / not-worthIt branches.
// Default: brotli isn't worth it, so `compressed` is the original bytes.
type Assessment = {
  worthIt: boolean; originalSize: number; compressedSize: number;
  savedBytes: number; savedPercent: number; compressed: Uint8Array;
};
let assessCompressionImpl = async (bytes: Uint8Array): Promise<Assessment> => ({
  worthIt: false, originalSize: bytes.length, compressedSize: bytes.length,
  savedBytes: 0, savedPercent: 0, compressed: bytes,
});

jest.mock('ordpool-sdk', () => {
  const { InjectionToken } = jest.requireActual('@angular/core');
  return {
    AUTO_SCAN_MAX_VALUE_SAT: 50_000,
    SMALL_UTXO_WARNING_THRESHOLD_SAT: 10_000,
    INSCRIBE_POSTAGE_SATS: 546,
    Network: { Mainnet: 'mainnet', Testnet3: 'testnet', Regtest: 'regtest' },
    InscribeMintOrchestrator: class InscribeMintOrchestrator {},
    UtxoContentScanner: class UtxoContentScanner {},
    WalletService: class WalletService {},
    cat21Config: new InjectionToken('cat21Config'),
    bitcoinNetwork: new InjectionToken('bitcoinNetwork'),
    bucketOf: (s: { kind: string }) => {
      switch (s.kind) {
        case 'not-scanned': return 'unscanned';
        case 'scanning': return 'scanning';
        case 'scanned-clean': return 'clean';
        case 'scanned-with-assets': return 'assets';
        case 'scan-failed': return 'failed';
        default: return 'unscanned';
      }
    },
    findAutoPickCandidate: <T extends { bucket: string }>(rows: T[]): T | null =>
      rows.find((r) => r.bucket === 'clean') ?? null,
    runeNamesFromContent: () => [],
    getMinimumUtxoSize: () => 294,
    toScureNetwork: () => ({}),
    getDummyKeypair: () => ({
      dummyPublicKey: new Uint8Array(33),
      xOnlyDummyPublicKey: new Uint8Array(32),
      addressP2WPKH: 'bc1qdummy',
      addressP2TR: 'bc1pdummy',
    }),
    prepareInscribeFundingInput: () => ({ txid: 'f'.repeat(64), vout: 0, value: 10_000_000 }),
    simulateInscribeFees: (...args: unknown[]) => { simulateSpy(...args); return { fundingRequirementSats: 4321, totalFeeSats: 3000 }; },
    validateInscribeOperation: (args: unknown) => { validateSpy(args); return gateResult; },
    assessCompression: (bytes: Uint8Array) => assessCompressionImpl(bytes),
  };
});

jest.mock('ordpool-parser', () => ({
  detectMimeType: (bytes: Uint8Array): string | null => {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
    return null;
  },
}));

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';

import {
  InscribeMintOrchestrator,
  UtxoContentScanner,
  WalletService,
  bitcoinNetwork,
  cat21Config,
  type WalletInfo,
} from 'ordpool-sdk';

import { InscribeMintComponent } from './inscribe-mint.component';
import { SeoService } from '../../../services/seo.service';
import { StateService } from '../../../services/state.service';

function wallet(over: Partial<WalletInfo> = {}): WalletInfo {
  return {
    type: 'xverse',
    ordinalsAddress: 'bc1p-ordinals',
    paymentAddress: 'bc1q-payment',
    paymentPublicKey: '02'.repeat(33),
    ordinalsPublicKey: '02'.repeat(33),
    ...over,
  } as WalletInfo;
}

// jsdom's File lacks arrayBuffer(); attach a deterministic one so the
// component's `await file.arrayBuffer()` returns the known bytes.
function makeFile(bytes: Uint8Array, name: string, type: string): File {
  const f = new File([bytes], name, { type });
  (f as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer =
    async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return f;
}

function pngFile(sizeBytes = 8, name = 'test.png'): File {
  const bytes = new Uint8Array(sizeBytes);
  bytes[0] = 0x89; bytes[1] = 0x50; bytes[2] = 0x4e; bytes[3] = 0x47;
  return makeFile(bytes, name, 'image/png');
}

function jsFile(): File {
  return makeFile(new Uint8Array([0x2f, 0x2f]), 'evil.js', 'application/javascript');
}

describe('InscribeMintComponent', () => {
  let component: InscribeMintComponent;
  let fixture: ComponentFixture<InscribeMintComponent>;
  let orchestrator: any;
  let walletSubject: BehaviorSubject<WalletInfo | null>;

  beforeEach(async () => {
    gateResult = { ok: true, resources: {} };
    assessCompressionImpl = async (bytes: Uint8Array) => ({
      worthIt: false, originalSize: bytes.length, compressedSize: bytes.length,
      savedBytes: 0, savedPercent: 0, compressed: bytes,
    });
    setContentSpy.mockClear();
    mintSpy.mockClear();
    validateSpy.mockClear();
    simulateSpy.mockClear();

    walletSubject = new BehaviorSubject<WalletInfo | null>(null);

    orchestrator = {
      state: signal('ready'),
      errorMessage: signal(null),
      successResult: signal(null),
      simulations$: of([]),
      recommendedFees$: of({ fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 }),
      setFeeRate: jest.fn(),
      setSelectedUtxo: jest.fn(),
      setContent: setContentSpy,
      mint: () => { mintSpy(); return of({ commitTxId: 'c'.repeat(64), revealTxId: 'r'.repeat(64) }); },
      reset: jest.fn(),
    };

    const walletService = {
      connectedWallet$: walletSubject.asObservable(),
      requestWalletConnect: jest.fn(),
    };
    const scanner = { states$: new BehaviorSubject(new Map()), autoScan: jest.fn(), reset: jest.fn(), scan: () => of(null) };
    const stateService = { recommendedFees$: of({ fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 }) };
    const seo = { setTitle: jest.fn(), setDescription: jest.fn() };

    await TestBed.configureTestingModule({
      declarations: [InscribeMintComponent],
      providers: [
        { provide: InscribeMintOrchestrator, useValue: orchestrator },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: walletService },
        { provide: cat21Config, useValue: { ordApiUrl: 'https://ord.example' } },
        { provide: bitcoinNetwork, useValue: 'mainnet' },
        { provide: StateService, useValue: stateService },
        { provide: SeoService, useValue: seo },
      ],
      schemas: [require('@angular/core').NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(InscribeMintComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('reads a PNG file → content-type image/png and sets orchestrator content', async () => {
    await (component as any).handleFile(pngFile());
    expect(component.pickedFile?.contentType).toBe('image/png');
    expect(setContentSpy).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/png' }));
    expect(component.fileError).toBe('');
  });

  it('blocks JavaScript MIME → fileError set, no content pushed', async () => {
    await (component as any).handleFile(jsFile());
    expect(component.pickedFile).toBeNull();
    expect(component.fileError).toContain("can't be inscribed");
    // setContent only ever called with null on the reject path
    expect(setContentSpy).not.toHaveBeenCalledWith(expect.objectContaining({ contentType: expect.stringContaining('javascript') }));
  });

  it('refuses a file over 350 KB → fileError, no content', async () => {
    await (component as any).handleFile(pngFile(350_001));
    expect(component.pickedFile).toBeNull();
    expect(component.fileError).toContain('350');
  });

  it('falls back to application/octet-stream for unknown bytes', async () => {
    const unknown = makeFile(new Uint8Array([0, 1, 2, 3, 4]), 'blob.bin', '');
    await (component as any).handleFile(unknown);
    expect(component.pickedFile?.contentType).toBe('application/octet-stream');
  });

  it('computes a pre-connect cost estimate once a file is picked', async () => {
    await (component as any).handleFile(pngFile());
    expect(simulateSpy).toHaveBeenCalled();
    expect(component.preConnectMintSats).toBe(4321);
  });

  it('runs the gate before minting; ok → orchestrator.mint()', async () => {
    await (component as any).handleFile(pngFile());
    gateResult = { ok: true, resources: {} };
    component.inscribe(wallet());
    expect(validateSpy).toHaveBeenCalled();
    expect(mintSpy).toHaveBeenCalled();
    expect(component.mintGateError).toBe('');
  });

  it('gate rejection → mintGateError set, mint NOT called', async () => {
    await (component as any).handleFile(pngFile());
    gateResult = { ok: false, reason: 'content-type-blocked', detail: 'application/javascript' };
    component.inscribe(wallet());
    expect(mintSpy).not.toHaveBeenCalled();
    expect(component.mintGateError).toContain('content-type-blocked');
  });

  it('single-address wallet → gate ownPaymentAddress is undefined', async () => {
    await (component as any).handleFile(pngFile());
    const single = wallet({ ordinalsAddress: 'bc1q-same', paymentAddress: 'bc1q-same' });
    component.inscribe(single);
    const cfg = validateSpy.mock.calls[0][0].config;
    expect(cfg.ownPaymentAddress).toBeUndefined();
  });

  it('dual-address wallet → gate ownPaymentAddress is the payment address', async () => {
    await (component as any).handleFile(pngFile());
    component.inscribe(wallet());
    const cfg = validateSpy.mock.calls[0][0].config;
    expect(cfg.ownPaymentAddress).toBe('bc1q-payment');
  });

  it('derives the inscription id as revealTxId + i0', () => {
    expect(component.inscriptionId('r'.repeat(64))).toBe('r'.repeat(64) + 'i0');
  });

  it('inscribeAnother resets orchestrator + local file state', () => {
    component.pickedFile = { name: 'x', bytes: new Uint8Array(1), contentType: 'image/png', sizeBytes: 1 };
    component.inscribeAnother();
    expect(orchestrator.reset).toHaveBeenCalled();
    expect(component.pickedFile).toBeNull();
  });

  // ---- Compression --------------------------------------------------------

  it('worthIt compression → toggle on, content carries the compressed body + content_encoding br', async () => {
    const compressed = new Uint8Array([1, 2, 3]);
    assessCompressionImpl = async () => ({
      worthIt: true, originalSize: 100, compressedSize: 3, savedBytes: 97, savedPercent: 97, compressed,
    });
    await (component as any).handleFile(pngFile());
    expect(component.compressEnabled).toBe(true);
    expect(component.isCompressed).toBe(true);
    const last = setContentSpy.mock.calls[setContentSpy.mock.calls.length - 1][0];
    expect(last.body).toBe(compressed);
    expect(last.contentEncoding).toBe('br');
  });

  it('not-worthIt compression → toggle off, raw body, no content_encoding tag', async () => {
    const f = pngFile();
    await (component as any).handleFile(f);
    expect(component.compressEnabled).toBe(false);
    const last = setContentSpy.mock.calls[setContentSpy.mock.calls.length - 1][0];
    expect(last.contentEncoding).toBeUndefined();
    expect(last.body).toBe(component.pickedFile!.bytes);
  });

  it('toggleCompression(false) after a worthIt pick → falls back to the raw body', async () => {
    assessCompressionImpl = async () => ({
      worthIt: true, originalSize: 100, compressedSize: 3, savedBytes: 97, savedPercent: 97,
      compressed: new Uint8Array([9, 9, 9]),
    });
    await (component as any).handleFile(pngFile());
    setContentSpy.mockClear();
    component.toggleCompression(false);
    const last = setContentSpy.mock.calls[setContentSpy.mock.calls.length - 1][0];
    expect(component.isCompressed).toBe(false);
    expect(last.contentEncoding).toBeUndefined();
    expect(last.body).toBe(component.pickedFile!.bytes);
  });

  // ---- Note ---------------------------------------------------------------

  it('note defaults to "ordpool.space" and is threaded into content', async () => {
    await (component as any).handleFile(pngFile());
    const last = setContentSpy.mock.calls[setContentSpy.mock.calls.length - 1][0];
    expect(last.note).toBe('ordpool.space');
  });

  it('empty note → the tag is omitted (undefined)', async () => {
    await (component as any).handleFile(pngFile());
    setContentSpy.mockClear();
    component.noteControl.setValue('   ');
    const last = setContentSpy.mock.calls[setContentSpy.mock.calls.length - 1][0];
    expect(last.note).toBeUndefined();
  });
});
