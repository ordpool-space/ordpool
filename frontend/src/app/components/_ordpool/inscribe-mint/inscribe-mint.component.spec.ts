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
// Default: not worth it, so `compressed` is the original bytes, encoding none.
type Assessment = {
  worthIt: boolean; bestEncoding: 'none' | 'gzip' | 'br';
  originalSize: number; compressedSize: number;
  savedBytes: number; savedPercent: number; compressed: Uint8Array;
};
let assessCompressionImpl = async (bytes: Uint8Array): Promise<Assessment> => ({
  worthIt: false, bestEncoding: 'none', originalSize: bytes.length, compressedSize: bytes.length,
  savedBytes: 0, savedPercent: 0, compressed: bytes,
});

jest.mock('ordpool-sdk', () => {
  const { InjectionToken } = jest.requireActual('@angular/core');
  return {
    AUTO_SCAN_MAX_VALUE_SAT: 50_000,
    BITCOIN_MIN_RELAY_FEE_SAT_PER_VBYTE: 0.1,
    SMALL_UTXO_WARNING_THRESHOLD_SAT: 10_000,
    INSCRIBE_POSTAGE_SATS: 546,
    Network: { Mainnet: 'mainnet', Testnet3: 'testnet', Regtest: 'regtest' },
    // Constructed by the component (`new InscribeMintOrchestrator(deps)`), not
    // injected: this mock class IS the instance the component drives. Real
    // subscribe/getSnapshot surface + signal/subject-shaped shims → `_patch`.
    InscribeMintOrchestrator: class InscribeMintOrchestrator {
      deps: unknown;
      _snap: {
        state: string;
        feeRate: number | null;
        selectedUtxo: TxnOutput | null;
        content: unknown;
        simulations: unknown[];
        fundingRecommendation: { status: string; recommended: TxnOutput | null; candidates: TxnOutput[] };
        errorMessage: string | null;
        successResult: unknown;
      } = {
        state: 'ready', feeRate: null, selectedUtxo: null, content: null,
        simulations: [], fundingRecommendation: { status: 'scanning', recommended: null, candidates: [] },
        errorMessage: null, successResult: null,
      };
      _listeners: Array<(s: unknown) => void> = [];
      constructor(deps: unknown) { this.deps = deps; }
      getSnapshot() { return this._snap; }
      subscribe(l: (s: unknown) => void) {
        this._listeners.push(l);
        l(this._snap);
        return () => { this._listeners = this._listeners.filter((x) => x !== l); };
      }
      _patch(p: Record<string, unknown>) {
        this._snap = { ...this._snap, ...p };
        this._listeners.slice().forEach((l) => l(this._snap));
      }
      setWallet = jest.fn(async () => {});
      setFeeRate = jest.fn((rate: number) => this._patch({ feeRate: rate }));
      setSelectedUtxo = jest.fn((u: TxnOutput | null) => this._patch({ selectedUtxo: u }));
      setContent = jest.fn((c: unknown) => this._patch({ content: c }));
      mint = jest.fn(async () => ({ commitTxId: 'c'.repeat(64), revealTxId: 'r'.repeat(64) }));
      reset = jest.fn();
      // Signal/subject-shaped shims (harness drivers) → `_patch`.
      state = { set: (v: string) => this._patch({ state: v }) };
      errorMessage = { set: (v: string | null) => this._patch({ errorMessage: v }) };
      successResult = { set: (v: unknown) => this._patch({ successResult: v }) };
      fundingRecommendationSubject = { next: (v: unknown) => this._patch({ fundingRecommendation: v }) };
      selectedUtxo() { return this._snap.selectedUtxo; }
    },
    Cat21Service: class Cat21Service {},
    UtxoContentScanner: class UtxoContentScanner {},
    WalletService: class WalletService {},
    // Wired into the constructed orchestrator's scan port; the mock never calls it.
    classifyOutpoint: jest.fn(async () => ({ clean: true, inscriptionIds: [], runes: null, catIds: [], catSat: null, rareSat: null })),
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
    // Stand-in codec: UTF-8 of JSON so tests can decode + assert the value.
    // The real deterministic-CBOR encoder is unit-tested in the SDK.
    encodeCborDeterministic: (v: unknown) => new TextEncoder().encode(JSON.stringify(v)),
    ORD_TAGS: {
      content_type: 1, pointer: 2, parent: 3, metadata: 5, metaprotocol: 7,
      content_encoding: 9, delegate: 11, rune: 13, note: 15, properties: 17, property_encoding: 19,
    },
    encodeInscriptionId: (id: string) => new TextEncoder().encode(id),
  };
});

jest.mock('ordpool-parser', () => ({
  detectMimeType: (bytes: Uint8Array): string | null => {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
    return null;
  },
}));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';

import {
  Cat21Service,
  UtxoContentScanner,
  WalletService,
  bitcoinNetwork,
  cat21Config,
  type TxnOutput,
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
      worthIt: false, bestEncoding: 'none', originalSize: bytes.length, compressedSize: bytes.length,
      savedBytes: 0, savedPercent: 0, compressed: bytes,
    });
    setContentSpy.mockClear();
    mintSpy.mockClear();
    validateSpy.mockClear();
    simulateSpy.mockClear();

    walletSubject = new BehaviorSubject<WalletInfo | null>(null);

    const cat21 = {
      getUtxos: jest.fn((_: string) => of([] as TxnOutput[])),
      postTransaction: jest.fn((_: string) => of('t'.repeat(64))),
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
        // The orchestrator is constructed by the component (not injected); we
        // provide its deps + grab the constructed instance off the component.
        { provide: Cat21Service, useValue: cat21 },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: walletService },
        { provide: cat21Config, useValue: { ordApiUrl: 'https://ord.example', cat21OrdApiUrl: 'https://cat21-ord.example' } },
        { provide: bitcoinNetwork, useValue: 'mainnet' },
        { provide: StateService, useValue: stateService },
        { provide: SeoService, useValue: seo },
      ],
      schemas: [require('@angular/core').NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(InscribeMintComponent);
    component = fixture.componentInstance;
    orchestrator = (component as unknown as { orchestrator: any }).orchestrator;
    // Alias the constructed orchestrator's setContent + mint to the module spies
    // the tests assert on (harness IO; construction + ngOnInit call neither).
    orchestrator.setContent = setContentSpy;
    orchestrator.mint = jest.fn(async () => { mintSpy(); return { commitTxId: 'c'.repeat(64), revealTxId: 'r'.repeat(64) }; });
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

  // ---- Compression (native gzip) ------------------------------------------

  it('worthIt gzip → toggle on by default, compressed body + content_encoding gzip', async () => {
    const compressed = new Uint8Array([1, 2, 3]);
    assessCompressionImpl = async () => ({
      worthIt: true, bestEncoding: 'gzip', originalSize: 100, compressedSize: 3, savedBytes: 97, savedPercent: 97, compressed,
    });
    await (component as any).handleFile(pngFile());
    expect(component.compressEnabled).toBe(true);
    expect(component.isCompressed).toBe(true);
    expect(component.activeContentEncoding).toBe('gzip');
    const last = lastContent();
    expect(last.body).toBe(compressed);
    expect(last.contentEncoding).toBe('gzip');
  });

  it('not-worthIt (already compressed) → toggle off, raw body, no content_encoding', async () => {
    await (component as any).handleFile(pngFile());   // default mock: worthIt false, encoding none
    expect(component.compressEnabled).toBe(false);
    expect(component.activeContentEncoding).toBeUndefined();
    const last = lastContent();
    expect(last.contentEncoding).toBeUndefined();
    expect(last.body).toBe(component.pickedFile?.bytes);
  });

  it('toggleCompression(false) after a worthIt pick → falls back to the raw body', async () => {
    assessCompressionImpl = async () => ({
      worthIt: true, bestEncoding: 'gzip', originalSize: 100, compressedSize: 3, savedBytes: 97, savedPercent: 97,
      compressed: new Uint8Array([9, 9, 9]),
    });
    await (component as any).handleFile(pngFile());
    setContentSpy.mockClear();
    component.toggleCompression(false);
    const last = lastContent();
    expect(component.isCompressed).toBe(false);
    expect(last.contentEncoding).toBeUndefined();
    expect(last.body).toBe(component.pickedFile?.bytes);
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

  // ---- Metadata -----------------------------------------------------------

  function lastContent(): any {
    return setContentSpy.mock.calls[setContentSpy.mock.calls.length - 1]?.[0];
  }
  function decodeMeta(bytes: Uint8Array): unknown {
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  it('KV metadata → encoded bytes threaded into content', async () => {
    await (component as any).handleFile(pngFile());
    component.addMetadataRow();
    component.setMetadataRow(0, 'collection', 'cats');
    expect(component.metadataBytes).not.toBeNull();
    expect(decodeMeta(lastContent().metadata)).toEqual({ collection: 'cats' });
  });

  it('empty metadata → no metadata tag', async () => {
    await (component as any).handleFile(pngFile());
    expect(lastContent().metadata).toBeUndefined();
  });

  it('blank keys are dropped from KV metadata', async () => {
    await (component as any).handleFile(pngFile());
    component.addMetadataRow();
    component.setMetadataRow(0, '   ', 'ignored');
    expect(component.metadataBytes).toBeNull();
    expect(lastContent().metadata).toBeUndefined();
  });

  it('invalid JSON → metadataInvalid, no bytes, mint blocked', async () => {
    await (component as any).handleFile(pngFile());
    component.switchMetadataMode('json');
    component.onMetadataJsonChange('{ not valid');
    expect(component.metadataInvalid).toBe(true);
    expect(component.metadataError).toContain('Invalid JSON');
    expect(component.metadataBytes).toBeNull();
  });

  it('valid nested JSON → bytes encode the nested object', async () => {
    await (component as any).handleFile(pngFile());
    component.switchMetadataMode('json');
    component.onMetadataJsonChange('{"a":{"b":1},"list":[1,2]}');
    expect(component.metadataInvalid).toBe(false);
    const bytes = component.metadataBytes;
    expect(bytes).not.toBeNull();
    expect(decodeMeta(bytes as Uint8Array)).toEqual({ a: { b: 1 }, list: [1, 2] });
  });

  it('KV → JSON mode serialises the current object', async () => {
    await (component as any).handleFile(pngFile());
    component.addMetadataRow();
    component.setMetadataRow(0, 'edition', '21');
    component.switchMetadataMode('json');
    expect(component.metadataMode).toBe('json');
    expect(JSON.parse(component.metadataJson)).toEqual({ edition: '21' });
  });

  it('JSON → KV parses back a flat object', async () => {
    await (component as any).handleFile(pngFile());
    component.switchMetadataMode('json');
    component.onMetadataJsonChange('{"a":"1","b":"2"}');
    component.switchMetadataMode('kv');
    expect(component.metadataMode).toBe('kv');
    expect(component.metadataRows).toEqual([{ key: 'a', value: '1' }, { key: 'b', value: '2' }]);
  });

  it('JSON → KV refused for nested data (JSON stays authoritative)', async () => {
    await (component as any).handleFile(pngFile());
    component.switchMetadataMode('json');
    component.onMetadataJsonChange('{"a":{"b":1}}');
    component.switchMetadataMode('kv');
    expect(component.metadataMode).toBe('json');
    expect(component.metadataModeHint).toContain('nested');
  });

  it('inscribeAnother resets metadata state', () => {
    component.metadataRows = [{ key: 'a', value: 'b' }];
    component.metadataBytes = new Uint8Array([1]);
    component.metadataMode = 'json';
    component.inscribeAnother();
    expect(component.metadataRows).toEqual([]);
    expect(component.metadataBytes).toBeNull();
    expect(component.metadataMode).toBe('kv');
  });

  // ---- Delegate mode ------------------------------------------------------

  const DELEGATE_ID = 'a'.repeat(64) + 'i0';

  it('switch to delegate mode clears the picked file', async () => {
    await (component as any).handleFile(pngFile());
    expect(component.pickedFile).not.toBeNull();
    component.switchInscribeMode('delegate');
    expect(component.inscribeMode).toBe('delegate');
    expect(component.pickedFile).toBeNull();
  });

  it('valid delegate id → empty body + delegate in content, no contentType', () => {
    component.switchInscribeMode('delegate');
    component.onDelegateIdChange(DELEGATE_ID);
    expect(component.delegateIdError).toBe('');
    expect(component.hasContent).toBe(true);
    const c = lastContent();
    expect(c.delegate).toBe(DELEGATE_ID);
    expect(c.body.length).toBe(0);
    expect(c.contentType).toBeUndefined();
  });

  it('invalid delegate id → error, blocked, no content', () => {
    component.switchInscribeMode('delegate');
    component.onDelegateIdChange('not-an-id');
    expect(component.delegateIdError).toContain('valid inscription id');
    expect(component.delegateInvalid).toBe(true);
    expect(lastContent()).toBeNull();
  });

  it('delegate content still carries note + metadata', () => {
    component.switchInscribeMode('delegate');
    component.addMetadataRow();
    component.setMetadataRow(0, 'k', 'v');
    component.onDelegateIdChange(DELEGATE_ID);
    const c = lastContent();
    expect(c.delegate).toBe(DELEGATE_ID);
    expect(c.note).toBe('ordpool.space');
    expect(decodeMeta(c.metadata)).toEqual({ k: 'v' });
  });

  it('inscribe() in delegate mode → gate intent has empty body + no contentType, mint runs', () => {
    component.switchInscribeMode('delegate');
    component.onDelegateIdChange(DELEGATE_ID);
    gateResult = { ok: true, resources: {} };
    component.inscribe(wallet());
    const intent = validateSpy.mock.calls[validateSpy.mock.calls.length - 1][0].operation.intent;
    expect(intent.body.length).toBe(0);
    expect(intent.contentType).toBeUndefined();
    expect(mintSpy).toHaveBeenCalled();
  });

  it('leaving delegate mode clears the delegate id', () => {
    component.switchInscribeMode('delegate');
    component.onDelegateIdChange(DELEGATE_ID);
    component.switchInscribeMode('file');
    expect(component.inscribeMode).toBe('file');
    expect(component.delegateId).toBe('');
    expect(component.delegateInvalid).toBe(false);
  });

  // ---- Total-size cap + cost accuracy (review fixes) ----------------------

  it('oversize total (small file + huge metadata) is blocked before minting', async () => {
    await (component as any).handleFile(pngFile());
    // 400 KB of metadata pushes body+metadata+note past the 350 KB cap even
    // though the file itself is tiny (the SDK gate only sees the 8-byte file).
    component.metadataBytes = new Uint8Array(400_000);
    gateResult = { ok: true, resources: {} };
    component.inscribe(wallet());
    expect(component.mintGateError).toMatch(/cap|350/);
    expect(mintSpy).not.toHaveBeenCalled();
  });

  it('pre-connect cost sim includes the note + metadata envelope fields', async () => {
    await (component as any).handleFile(pngFile());   // note defaults to 'ordpool.space'
    component.addMetadataRow();
    component.setMetadataRow(0, 'k', 'v');
    const lastSim = simulateSpy.mock.calls[simulateSpy.mock.calls.length - 1][0];
    const tags = (lastSim.envelopeFields ?? []).map((f: { tag: number }) => f.tag);
    expect(tags).toContain(15); // note
    expect(tags).toContain(5);  // metadata
  });

  it('non-finite Infinity fee-rate does not produce a pre-connect estimate', async () => {
    await (component as any).handleFile(pngFile());
    component.cfeeRate.setValue(Infinity);
    expect(component.preConnectMintSats).toBeNull();
  });

  describe('funding-status gating (inscribe-button enable)', () => {
    const rec = (status: 'auto' | 'expert-required' | 'scanning' | 'insufficient') =>
      orchestrator.fundingRecommendationSubject.next({ status, recommended: null, candidates: [] });

    it('fundingStatus() mirrors the orchestrator recommendation', () => {
      rec('expert-required');
      expect(component.fundingStatus()).toBe('expert-required');
      rec('insufficient');
      expect(component.fundingStatus()).toBe('insufficient');
    });

    it('hasFundingSource() is true on status auto (safe-auto funds, no manual pick)', () => {
      rec('auto');
      expect(orchestrator.selectedUtxo()).toBeNull();
      expect(component.hasFundingSource()).toBe(true);
    });

    it('hasFundingSource() is false on expert-required / insufficient / scanning with no manual pick', () => {
      rec('expert-required');
      expect(component.hasFundingSource()).toBe(false);
      rec('insufficient');
      expect(component.hasFundingSource()).toBe(false);
      rec('scanning');
      expect(component.hasFundingSource()).toBe(false);
    });

    it('hasFundingSource() is true once the user manually picks, even in expert-required', () => {
      rec('expert-required');
      expect(component.hasFundingSource()).toBe(false);
      orchestrator.setSelectedUtxo({ txid: 'a'.repeat(64), vout: 0, value: 50_000 } as TxnOutput);
      expect(component.hasFundingSource()).toBe(true);
    });
  });
});
