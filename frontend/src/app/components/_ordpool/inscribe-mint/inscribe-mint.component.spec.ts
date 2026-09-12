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
const setBatchSpy = jest.fn();
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

// Swappable gallery-existence stub. Default: every id passed in exists. Tests
// override to return 'missing'/'unknown' for specific ids. The component
// pre-filters to well-formed ids, so the stub only sees valid shapes.
type Existence = 'exists' | 'missing' | 'invalid' | 'unknown';
let checkInscriptionsExistImpl = async (ids: ReadonlyArray<string>): Promise<Map<string, Existence>> =>
  new Map(ids.map((id) => [id, 'exists' as Existence]));

// Swappable rare-sat scan stub. Default: every coin is scanned-but-common (no
// rare sat). Tests override to plant a rare sat or a failed lookup on a coin.
type PickerRow = { utxo: unknown; address: string | null; rareSat: { sat: number; offset: number; rarity: string } | null; status: 'scanned' | 'unknown' };
let findRareSatsInOutputsImpl = async (outputs: ReadonlyArray<{ txid: string; vout: number }>): Promise<PickerRow[]> =>
  outputs.map((u) => ({ utxo: u, address: 'bc1p-ord', rareSat: null, status: 'scanned' as const }));

// Swappable sat-source builder. Default: return a plausible source for a row
// with a rare sat, null otherwise. Tests override to throw a key mismatch.
let inscribeSatSourceFromRowImpl = (row: PickerRow): unknown =>
  row.rareSat ? { txid: (row.utxo as { txid: string }).txid, vout: 0, value: 10_000, scriptPubKey: new Uint8Array(34), tapInternalKey: new Uint8Array(32), address: row.address, offset: row.rareSat.offset } : null;

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
      setBatch = jest.fn((b: unknown) => this._patch({ batch: b }));
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
    // Four-character grouping for the "Fund <addr>" verification instruction.
    addressVerificationChunks: (a: string) => a.match(/.{1,4}/g) ?? [],
    // Display labels keyed by type — the component reads
    // KnownOrdinalWallets[wallet.type].label to name the wallet in the caveat.
    KnownOrdinalWallets: {
      xverse: { label: 'Xverse' },
      leather: { label: 'Leather' },
      unisat: { label: 'UniSat' },
    },
    // wallet-ux-round3 single-address custody API (faithful re-implementations;
    // canonical versions in the SDK's wallet-capabilities.ts). singleAddressCaveat
    // names the wallet in the opener when given a label ("Your UniSat wallet
    // keeps..."), mirroring the SDK's opener grammar (a label already ending in
    // "wallet" is not doubled).
    usesSingleAddress: (w: { ordinalsAddress?: string; paymentAddress?: string } | null | undefined) =>
      !!(w && w.ordinalsAddress && w.paymentAddress && w.ordinalsAddress === w.paymentAddress),
    singleAddressCaveat: (assets = 'cats', walletName?: string) => {
      const opener = !walletName
        ? 'This wallet'
        : /\bwallet$/i.test(walletName.trim()) ? `Your ${walletName.trim()}` : `Your ${walletName.trim()} wallet`;
      return `${opener} keeps your coins and your ${assets} at one address. That is fine here, because `
      + 'everything in the ordpool family checks what a coin is carrying before it spends it. '
      + `Other sites do not look, so a payment made elsewhere can spend the sat one of your `
      + `${assets} lives on and tip it to a miner. Start a fresh address here and keep it for `
      + 'cat21.space, ordpool.space, cubes.haushoppe.art and CAT-21 wallet, or use a wallet that '
      + `keeps your coins and your ${assets} apart.`;
    },
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
    checkInscriptionsExist: (ids: ReadonlyArray<string>) => checkInscriptionsExistImpl(ids),
    findRareSatsInOutputs: (outputs: ReadonlyArray<{ txid: string; vout: number }>) => findRareSatsInOutputsImpl(outputs),
    // Stand-in: build a plausible InscribeSatSource from a rare-sat row, or
    // null when the row has no rare sat. Tests override to throw (key mismatch).
    inscribeSatSourceFromRow: (row: PickerRow, _args: unknown) => inscribeSatSourceFromRowImpl(row),
    inscribeUserMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
    // Faithful stand-in for the SDK's per-address dust rule: taproot (bc1p)
    // floor 330, else p2wpkh 294. The real one is unit-tested in the SDK.
    satPaddingRequirement: (satOffset: number, paddingAddress: string) => {
      const dustLimitSats = paddingAddress.startsWith('bc1p') ? 330 : 294;
      const needsPadding = satOffset > 0 && satOffset < dustLimitSats;
      return { needsPadding, shortfallSats: needsPadding ? dustLimitSats - satOffset : 0, dustLimitSats };
    },
    // Stand-in codec: UTF-8 of JSON so tests can decode + assert the value.
    // The real deterministic-CBOR encoder is unit-tested in the SDK.
    encodeCborDeterministic: (v: unknown) => new TextEncoder().encode(JSON.stringify(v)),
    // Stand-in properties encoder: returns bytes when there is anything to
    // encode, else undefined (matching ord). The real min-size dance is
    // unit-tested in the SDK.
    encodeInscriptionProperties: (input: { title?: unknown; traits?: unknown; gallery?: unknown }) => {
      const has = input && (input.title !== undefined || input.traits !== undefined || input.gallery !== undefined);
      return has ? { properties: new TextEncoder().encode(JSON.stringify(input)) } : undefined;
    },
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

import { Cat21Service, UtxoContentScanner, WalletService, singleAddressCaveat, type TxnOutput, type WalletInfo } from 'ordpool-sdk';
import { bitcoinNetwork, cat21Config } from '@app/services/ordinals/sdk-tokens';

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
    checkInscriptionsExistImpl = async (ids: ReadonlyArray<string>) =>
      new Map(ids.map((id) => [id, 'exists' as Existence]));
    findRareSatsInOutputsImpl = async (outputs: ReadonlyArray<{ txid: string; vout: number }>) =>
      outputs.map((u) => ({ utxo: u, address: 'bc1p-ord', rareSat: null, status: 'scanned' as const }));
    inscribeSatSourceFromRowImpl = (row: PickerRow) =>
      row.rareSat ? { txid: (row.utxo as { txid: string }).txid, vout: 0, value: 10_000, scriptPubKey: new Uint8Array(34), tapInternalKey: new Uint8Array(32), address: row.address, offset: row.rareSat.offset } : null;
    setContentSpy.mockClear();
    setBatchSpy.mockClear();
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
    orchestrator.setBatch = setBatchSpy;
    orchestrator.mint = jest.fn(async () => { mintSpy(); return { commitTxId: 'c'.repeat(64), revealTxId: 'r'.repeat(64) }; });
    fixture.detectChanges();
  });

  it('reads a PNG file → content-type image/png and sets orchestrator content', async () => {
    await (component as any).handleFile(pngFile());
    expect(component.pickedFile?.contentType).toBe('image/png');
    expect(setContentSpy).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({ kind: 'file', contentType: 'image/png' }) }));
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
    expect(last.source.body).toBe(compressed);
    expect(last.contentEncoding).toBe('gzip');
  });

  it('not-worthIt (already compressed) → toggle off, raw body, no content_encoding', async () => {
    await (component as any).handleFile(pngFile());   // default mock: worthIt false, encoding none
    expect(component.compressEnabled).toBe(false);
    expect(component.activeContentEncoding).toBeUndefined();
    const last = lastContent();
    expect(last.contentEncoding).toBeUndefined();
    expect(last.source.body).toBe(component.pickedFile?.bytes);
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
    expect(last.source.body).toBe(component.pickedFile?.bytes);
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
    expect(c.source.kind).toBe('delegate');
    expect(c.source.delegate).toBe(DELEGATE_ID);
    expect(c.source.body).toBeUndefined();
    expect(c.source.contentType).toBeUndefined();
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
    expect(c.source.delegate).toBe(DELEGATE_ID);
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

  // The fee input is text (not type=number) so its DISPLAY is always dots,
  // matching the presets, regardless of the browser locale. onFeeRateInput
  // coerces the raw string back to the numeric control.
  describe('fee-rate decimal entry (locale-agnostic)', () => {
    it('a dot decimal sets the numeric control value', () => {
      component.onFeeRateInput('0.2');
      expect(component.cfeeRate.value).toBe(0.2);
      expect(component.feeRateDisplay).toBe('0.2');
    });

    it('a comma decimal (non-English browser) yields the same number, raw string preserved', () => {
      component.onFeeRateInput('0,2');
      expect(component.cfeeRate.value).toBe(0.2);
      expect(component.feeRateDisplay).toBe('0,2');
    });

    it('empty and non-numeric input clear to null and flag required (never NaN)', () => {
      component.onFeeRateInput('');
      expect(component.cfeeRate.value).toBeNull();
      expect(component.cfeeRate.hasError('required')).toBe(true);
      component.onFeeRateInput('abc');
      expect(component.cfeeRate.value).toBeNull();
      expect(component.cfeeRate.hasError('required')).toBe(true);
    });

    it('below-floor and above-ceiling still validate after text entry', () => {
      component.onFeeRateInput('0,05');
      expect(component.cfeeRate.hasError('min')).toBe(true);
      component.onFeeRateInput('2000');
      expect(component.cfeeRate.hasError('max')).toBe(true);
    });

    it('clicking a fee preset syncs the display to a dot string', () => {
      component.setFeeRate(1.71);
      expect(component.cfeeRate.value).toBe(1.71);
      expect(component.feeRateDisplay).toBe('1.71');
    });
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

  // wallet-ux-round3 §12: the single-address INFO note beside the Inscribe
  // button, against the REAL template this spec renders (NO_ERRORS_SCHEMA).
  // Shown whenever a single-address wallet is connected; absent otherwise. No
  // acknowledgement, no amber — info, not a warning.
  describe('single-address note (wallet-ux-round3 §12)', () => {
    const q = (sel: string): Element | null => (fixture.nativeElement as HTMLElement).querySelector(sel);

    it('renders the note, naming the wallet, when a single-address wallet is connected', () => {
      // A real single-address wallet type (UniSat) so the caveat names it; Xverse
      // is genuinely dual-address. usesSingleAddress keys on the two equal addresses.
      walletSubject.next(wallet({ type: 'unisat' as WalletInfo['type'], ordinalsAddress: 'bc1p-same', paymentAddress: 'bc1p-same' }));
      fixture.detectChanges();
      const note = q('[data-testid="single-address-note"]');
      expect(note).toBeTruthy();
      // Mutation-worthy on the wallet name: if the component dropped the label the
      // note would open "This wallet keeps..." and not contain the UniSat sentence.
      expect(note!.textContent).toContain(singleAddressCaveat('cats', 'UniSat'));
      expect(note!.textContent).toContain('Your UniSat wallet keeps');
    });

    it('does NOT render the note for a dual-address wallet', () => {
      walletSubject.next(wallet()); // default helper: distinct ordinals/payment addresses
      fixture.detectChanges();
      expect(q('[data-testid="single-address-note"]')).toBeNull();
    });
  });

  describe('Title + Traits (tag-17 properties)', () => {
    // Delegate mode with a valid id lets syncContent produce content without a
    // file, so setContentSpy carries whatever title/traits the editor built.
    const VALID_DELEGATE = '6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i0';
    function enterDelegate(): void {
      component.switchInscribeMode('delegate');
      component.onDelegateIdChange(VALID_DELEGATE);
    }
    const lastContent = () => {
      const calls = setContentSpy.mock.calls;
      return calls.length ? calls[calls.length - 1][0] : undefined;
    };

    it('sends the title on the content, and omits it when empty', () => {
      enterDelegate();
      component.titleControl.setValue('My inscription');
      expect(lastContent()?.title).toBe('My inscription');
      component.titleControl.setValue('');
      expect(lastContent()?.title).toBeUndefined();
    });

    it('sends traits as ordered [name, value] pairs in row order, dropping empty-named rows', () => {
      enterDelegate();
      component.addTraitRow();
      component.addTraitRow();
      component.addTraitRow();
      component.onTraitNameChange(0, 'zeta');  component.onTraitValueChange(0, '1');
      component.onTraitNameChange(1, '   ');   component.onTraitValueChange(1, 'dropped'); // empty name
      component.onTraitNameChange(2, 'alpha'); component.onTraitValueChange(2, '2');
      // row order preserved (zeta before alpha), empty-named row dropped
      expect(lastContent()?.traits).toEqual([['zeta', '1'], ['alpha', '2']]);
    });

    it('omits traits entirely when no named rows remain', () => {
      enterDelegate();
      component.addTraitRow();
      component.onTraitValueChange(0, 'value with no name');
      expect(lastContent()?.traits).toBeUndefined();
    });

    it('flags the first duplicate trait name (ord drops all properties on a dup)', () => {
      component.addTraitRow();
      component.addTraitRow();
      component.addTraitRow();
      component.onTraitNameChange(0, 'Color');
      component.onTraitNameChange(1, 'Rank');
      component.onTraitNameChange(2, 'Color');
      expect(component.traitDuplicateName).toBe('Color');
      // rename the duplicate away -> no warning
      component.onTraitNameChange(2, 'Shade');
      expect(component.traitDuplicateName).toBe('');
    });

    it('removeTraitRow drops the row', () => {
      component.addTraitRow();
      component.onTraitNameChange(0, 'keep');
      expect(component.traitRows.length).toBe(1);
      component.removeTraitRow(0);
      expect(component.traitRows.length).toBe(0);
    });
  });

  describe('Gallery (ord --gallery, tag-17 properties)', () => {
    // Two well-formed inscription ids for the gallery rows.
    const ID_A = 'a'.repeat(64) + 'i0';
    const ID_B = 'b'.repeat(64) + 'i1';

    // Delegate mode so setContentSpy carries whatever gallery the editor built,
    // with no dependence on a picked file.
    function enterDelegate(): void {
      component.switchInscribeMode('delegate');
      component.onDelegateIdChange('6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i0');
    }
    const lastContent = () => {
      const calls = setContentSpy.mock.calls;
      return calls.length ? calls[calls.length - 1][0] : undefined;
    };
    // Run the debounced existence check now (bypass the 400ms), then flush.
    const runCheck = async () => {
      await (component as any).checkGalleryExistence();
    };

    it('sends gallery ids as an ordered array in row order, dropping empty rows', () => {
      enterDelegate();
      component.addGalleryRow();
      component.addGalleryRow();
      component.addGalleryRow();
      component.onGalleryIdChange(0, ID_A);
      component.onGalleryIdChange(1, '   ');   // empty -> dropped
      component.onGalleryIdChange(2, ID_B);
      expect(lastContent()?.gallery).toEqual([ID_A, ID_B]);
    });

    it('omits gallery entirely when no non-empty rows remain', () => {
      enterDelegate();
      component.addGalleryRow();
      component.onGalleryIdChange(0, '   ');
      expect(lastContent()?.gallery).toBeUndefined();
    });

    it('marks a well-formed id that exists as "exists"', async () => {
      component.addGalleryRow();
      component.onGalleryIdChange(0, ID_A);
      await runCheck();
      expect(component.galleryItemStatus(ID_A)).toBe('exists');
    });

    it('marks a well-formed id the server does not have as "missing"', async () => {
      checkInscriptionsExistImpl = async (ids) => new Map(ids.map((id) => [id, 'missing' as Existence]));
      component.addGalleryRow();
      component.onGalleryIdChange(0, ID_A);
      await runCheck();
      expect(component.galleryItemStatus(ID_A)).toBe('missing');
    });

    it('marks a malformed id as "invalid" without any lookup', async () => {
      const seen: string[] = [];
      checkInscriptionsExistImpl = async (ids) => { seen.push(...ids); return new Map(ids.map((id) => [id, 'exists' as Existence])); };
      component.addGalleryRow();
      component.onGalleryIdChange(0, 'not-an-id');
      await runCheck();
      expect(component.galleryItemStatus('not-an-id')).toBe('invalid');
      expect(seen).toEqual([]); // never sent to the server
    });

    it('shows a failed lookup ("unknown") as "checking", never "missing"', async () => {
      checkInscriptionsExistImpl = async (ids) => new Map(ids.map((id) => [id, 'unknown' as Existence]));
      component.addGalleryRow();
      component.onGalleryIdChange(0, ID_A);
      await runCheck();
      expect(component.galleryItemStatus(ID_A)).toBe('checking');
    });

    it('galleryInvalid is true for a missing/invalid row and false when all exist', async () => {
      // one missing id blocks
      checkInscriptionsExistImpl = async (ids) => new Map(ids.map((id) => [id, 'missing' as Existence]));
      component.addGalleryRow();
      component.onGalleryIdChange(0, ID_A);
      await runCheck();
      expect(component.galleryInvalid).toBe(true);
      // resolve it to exists -> no longer blocks
      (component as any).galleryExistence.set(ID_A, 'exists');
      expect(component.galleryInvalid).toBe(false);
    });

    it('removeGalleryRow drops the row', () => {
      component.addGalleryRow();
      component.onGalleryIdChange(0, ID_A);
      expect(component.galleryRows.length).toBe(1);
      component.removeGalleryRow(0);
      expect(component.galleryRows.length).toBe(0);
    });
  });

  describe('Metaprotocol / postage / commit-fee-rate (tag-7 + output economics)', () => {
    function enterDelegate(): void {
      component.switchInscribeMode('delegate');
      component.onDelegateIdChange('6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i0');
    }
    const lastContent = () => {
      const calls = setContentSpy.mock.calls;
      return calls.length ? calls[calls.length - 1][0] : undefined;
    };

    it('sends metaprotocol on the content, and omits it when empty', () => {
      enterDelegate();
      component.metaprotocolControl.setValue('brc-20');
      expect(lastContent()?.metaprotocol).toBe('brc-20');
      component.metaprotocolControl.setValue('');
      expect(lastContent()?.metaprotocol).toBeUndefined();
    });

    it('omits postageSats at the 546 default, sends it when changed', () => {
      enterDelegate();
      // default 546 -> omitted (SDK defaults to it)
      expect(lastContent()?.postageSats).toBeUndefined();
      component.postageControl.setValue(10_000);
      expect(lastContent()?.postageSats).toBe(10_000);
    });

    it('omits commitFeeRatePerVbyte when empty, sends it when set', () => {
      enterDelegate();
      expect(lastContent()?.commitFeeRatePerVbyte).toBeUndefined();
      component.commitFeeRateControl.setValue(5);
      expect(lastContent()?.commitFeeRatePerVbyte).toBe(5);
    });

    it('a below-minimum postage makes the form invalid (blocks the mint)', () => {
      component.postageControl.setValue(100);
      expect(component.postageControl.invalid).toBe(true);
      expect(component.form.invalid).toBe(true);
      component.postageControl.setValue(546);
      expect(component.postageControl.invalid).toBe(false);
    });

    it('a below-floor commit fee rate makes the form invalid (blocks the mint)', () => {
      component.commitFeeRateControl.setValue(0.05);
      expect(component.commitFeeRateControl.invalid).toBe(true);
      expect(component.form.invalid).toBe(true);
      component.commitFeeRateControl.setValue(null); // empty is valid (defaults to reveal rate)
      expect(component.commitFeeRateControl.invalid).toBe(false);
    });
  });

  describe('Rare-sat picker (ord --sat targeting)', () => {
    const coin = (txid: string, vout = 0) => ({ txid, vout, value: 10_000, status: { confirmed: true } });
    const row = (over: Partial<PickerRow>): PickerRow => ({
      utxo: coin('a'.repeat(64)), address: 'bc1p-ord', rareSat: null, status: 'scanned', ...over,
    });

    it('scan splits rows into rare candidates, common, and unknown', async () => {
      findRareSatsInOutputsImpl = async () => [
        row({ utxo: coin('a'.repeat(64)), rareSat: { sat: 5_000_000_000, offset: 0, rarity: 'uncommon' } }),
        row({ utxo: coin('b'.repeat(64)), rareSat: null, status: 'scanned' }),       // common
        row({ utxo: coin('c'.repeat(64)), rareSat: null, status: 'unknown', address: null }), // couldn't check
      ];
      await component.scanForRareSats('bc1p-ord');
      expect(component.rareSatCandidates.length).toBe(1);
      expect(component.rareSatCandidates[0].rareSat?.rarity).toBe('uncommon');
      expect(component.rareSatUnknownCount).toBe(1);
      expect(component.rareSatScannedEmpty).toBe(false);
    });

    it('a coin that is scanned-but-common is not a candidate and reads as empty', async () => {
      findRareSatsInOutputsImpl = async () => [row({ rareSat: null, status: 'scanned' })];
      await component.scanForRareSats('bc1p-ord');
      expect(component.rareSatCandidates.length).toBe(0);
      expect(component.rareSatUnknownCount).toBe(0);
      expect(component.rareSatScannedEmpty).toBe(true);
    });

    it('an unknown row is counted separately, never as a rare-sat candidate', async () => {
      findRareSatsInOutputsImpl = async () => [row({ status: 'unknown', address: null, rareSat: null })];
      await component.scanForRareSats('bc1p-ord');
      expect(component.rareSatCandidates.length).toBe(0);
      expect(component.rareSatUnknownCount).toBe(1);
    });

    it('pickRareSat selects, re-pick and clearRareSat both clear', async () => {
      findRareSatsInOutputsImpl = async () => [row({ rareSat: { sat: 1, offset: 0, rarity: 'rare' } })];
      await component.scanForRareSats('bc1p-ord');
      const r = component.rareSatCandidates[0];
      component.pickRareSat(r);
      expect(component.selectedRareSat).toBe(r);
      component.pickRareSat(r);                 // re-pick toggles off
      expect(component.selectedRareSat).toBeNull();
      component.pickRareSat(r);
      component.clearRareSat();
      expect(component.selectedRareSat).toBeNull();
    });

    it('padding is required when the offset is below the sat coin\'s dust floor', async () => {
      // taproot coin (bc1p) floor 330; offset 100 -> needs 230 padding
      findRareSatsInOutputsImpl = async () => [row({ address: 'bc1p-ord', rareSat: { sat: 1, offset: 100, rarity: 'epic' } })];
      await component.scanForRareSats('bc1p-ord');
      component.pickRareSat(component.rareSatCandidates[0]);
      expect(component.rareSatPadding).toEqual({ needsPadding: true, shortfallSats: 230, dustLimitSats: 330 });
    });

    it('no padding when the offset is at or above the dust floor, and null when nothing is picked', async () => {
      findRareSatsInOutputsImpl = async () => [row({ address: 'bc1p-ord', rareSat: { sat: 1, offset: 900, rarity: 'legendary' } })];
      await component.scanForRareSats('bc1p-ord');
      expect(component.rareSatPadding).toBeNull(); // nothing picked yet
      component.pickRareSat(component.rareSatCandidates[0]);
      expect(component.rareSatPadding).toEqual({ needsPadding: false, shortfallSats: 0, dustLimitSats: 330 });
    });

    it('a scan failure sets an error and leaves no rows', async () => {
      findRareSatsInOutputsImpl = async () => { throw new Error('ord down'); };
      await component.scanForRareSats('bc1p-ord');
      expect(component.rareSatError).toBeTruthy();
      expect(component.rareSatRows).toBeNull();
    });

    // --- satTarget construction (needs a connected wallet + content) ---
    const VALID_DELEGATE = '6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i0';
    const withWalletAndContent = () => {
      walletSubject.next(wallet());        // ordinalsPublicKey present on the default helper
      fixture.detectChanges();
      component.switchInscribeMode('delegate');
      component.onDelegateIdChange(VALID_DELEGATE); // content for the satTarget to ride on
    };
    const lastContent = () => {
      const calls = setContentSpy.mock.calls;
      return calls.length ? calls[calls.length - 1][0] : undefined;
    };

    it('picking a no-padding rare sat threads an in-utxo satTarget onto the content', async () => {
      withWalletAndContent();
      findRareSatsInOutputsImpl = async () => [row({ address: 'bc1p-ord', rareSat: { sat: 5, offset: 900, rarity: 'rare' } })];
      await component.scanForRareSats('bc1p-ord');
      component.pickRareSat(component.rareSatCandidates[0]);
      expect(component.rareSatBlocked).toBe(false);
      expect(lastContent()?.satTarget?.kind).toBe('in-utxo');
      // clearing removes the satTarget again
      component.clearRareSat();
      expect(lastContent()?.satTarget).toBeUndefined();
    });

    it('a key mismatch blocks the mint with a reason and no satTarget', async () => {
      withWalletAndContent();
      inscribeSatSourceFromRowImpl = () => { throw new Error('ordinals key does not derive this coin address'); };
      findRareSatsInOutputsImpl = async () => [row({ rareSat: { sat: 5, offset: 900, rarity: 'rare' } })];
      await component.scanForRareSats('bc1p-ord');
      component.pickRareSat(component.rareSatCandidates[0]);
      expect(component.rareSatBlocked).toBe(true);
      expect(component.rareSatBlockReason).toContain('key');
      expect(lastContent()?.satTarget).toBeUndefined();
    });

    it('a sat below the dust floor is blocked (needs a padding coin) with no satTarget', async () => {
      withWalletAndContent();
      findRareSatsInOutputsImpl = async () => [row({ address: 'bc1p-ord', rareSat: { sat: 5, offset: 100, rarity: 'epic' } })];
      await component.scanForRareSats('bc1p-ord');
      component.pickRareSat(component.rareSatCandidates[0]);
      expect(component.rareSatBlocked).toBe(true);
      expect(component.rareSatBlockReason).toContain('padding');
      expect(lastContent()?.satTarget).toBeUndefined();
    });
  });

  describe('Batch mode (several files in one commit)', () => {
    const lastBatch = () => {
      const calls = setBatchSpy.mock.calls;
      return calls.length ? calls[calls.length - 1][0] : undefined;
    };

    it('toggling batch on clears single content; off clears the batch', () => {
      component.toggleBatchMode(true);
      expect(component.batchMode).toBe(true);
      expect(setContentSpy).toHaveBeenCalledWith(null);
      component.toggleBatchMode(false);
      expect(component.batchMode).toBe(false);
      expect(setBatchSpy).toHaveBeenCalledWith(null);
    });

    it('adding files builds a separate-outputs batch, one file inscription each', async () => {
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([pngFile(8, 'a.png'), pngFile(8, 'b.png')]);
      expect(component.batchFiles.length).toBe(2);
      expect(component.hasContent).toBe(true);
      const batch = lastBatch();
      expect(batch.mode).toBe('separate-outputs');
      expect(batch.inscriptions.length).toBe(2);
      expect(batch.inscriptions[0].source.kind).toBe('file');
      expect(batch.inscriptions[0].source.contentType).toBe('image/png');
    });

    it('a JavaScript file is skipped from the batch with a note', async () => {
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([jsFile(), pngFile(8, 'ok.png')]);
      expect(component.batchFiles.length).toBe(1);          // only the png
      expect(component.batchError).toContain('Skipped');
      expect(lastBatch().inscriptions.length).toBe(1);
    });

    it('removeBatchFile and clearBatch shrink / empty the batch', async () => {
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([pngFile(8, 'a.png'), pngFile(8, 'b.png')]);
      component.removeBatchFile(0);
      expect(component.batchFiles.length).toBe(1);
      component.clearBatch();
      expect(component.batchFiles.length).toBe(0);
      expect(setBatchSpy).toHaveBeenCalledWith(null);
    });

    it('postage and commit-fee thread onto the batch when set', async () => {
      component.toggleBatchMode(true);
      component.postageControl.setValue(3000);
      component.commitFeeRateControl.setValue(4);
      await (component as any).addBatchFiles([pngFile(8, 'a.png')]);
      const batch = lastBatch();
      expect(batch.postageSats).toBe(3000);
      expect(batch.commitFeeRatePerVbyte).toBe(4);
    });

    it('inscribeBatch gates every entry: minting proceeds when the gate passes', async () => {
      gateResult = { ok: true, resources: {} };
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([pngFile(8, 'a.png')]);
      component.inscribe(wallet());
      expect(mintSpy).toHaveBeenCalled();
    });

    it('inscribeBatch blocks with an error and does not mint when the gate fails', async () => {
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([pngFile(8, 'a.png')]);
      gateResult = { ok: false, reason: 'blocked-content-type', detail: 'nope' };
      mintSpy.mockClear();
      component.inscribe(wallet());
      expect(component.mintGateError).toContain('refused');
      expect(mintSpy).not.toHaveBeenCalled();
    });
  });
});
