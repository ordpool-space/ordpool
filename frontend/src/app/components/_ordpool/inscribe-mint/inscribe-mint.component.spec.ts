/**
 * The component runs against the REAL SDK: `ordpool-sdk/core` is the same code
 * as the main entry minus the stateful service classes, and loads without the
 * wallet connectors' ESM chain that Jest's CJS runner cannot take. The real
 * `InscribeMintOrchestrator`, gate, fee simulator, encoders and funding policy
 * all run here, so a change to any of them reaches these assertions.
 *
 * Faked, and only these, because each is network IO:
 * - ord lookups: `checkInscriptionsExist`, `findRareSatsInOutputs`, `lookupRuneEtching`
 * - electrs and the content scan: the `Cat21Service.getUtxos` and
 *   `UtxoContentScanner.classify` ports handed to the orchestrator
 * - the wallet: `orchestrator.mint` (signing + broadcast)
 * The three service classes are DI tokens only; TestBed supplies the doubles.
 */
type Existence = 'exists' | 'missing' | 'invalid' | 'unknown';
let checkInscriptionsExistImpl = async (ids: ReadonlyArray<string>): Promise<Map<string, Existence>> =>
  new Map(ids.map((id) => [id, 'exists' as Existence]));

// Rare-sat scan (ord /output + /sat). Default: every coin scanned, none rare.
type PickerRow = { utxo: { txid: string; vout: number; value: number }; address: string | null; rareSat: { sat: number; offset: number; rarity: string } | null; status: 'scanned' | 'unknown' };
let findRareSatsInOutputsImpl = async (outputs: ReadonlyArray<{ txid: string; vout: number; value: number }>): Promise<PickerRow[]> =>
  outputs.map((u) => ({ utxo: u, address: ORDINALS_ADDRESS, rareSat: null, status: 'scanned' as const }));

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
    Cat21Service: class Cat21Service {},
    UtxoContentScanner: class UtxoContentScanner {},
    WalletService: class WalletService {},
    checkInscriptionsExist: (ids: ReadonlyArray<string>) => checkInscriptionsExistImpl(ids),
    findRareSatsInOutputs: (outputs: ReadonlyArray<{ txid: string; vout: number; value: number }>) => findRareSatsInOutputsImpl(outputs),
    // No etching link, so panel renders stay deterministic.
    lookupRuneEtching: jest.fn(async () => ({ kind: 'unavailable' as const })),
    // Observed, not replaced: the real functions run and the tests read their arguments.
    validateInscribeOperation: jest.fn(core.validateInscribeOperation),
    simulateInscribeFees: jest.fn(core.simulateInscribeFees),
    assessCompression: jest.fn(core.assessCompression),
  };
});


import type { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';

import { secp256k1 } from '@noble/curves/secp256k1';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import {
  Cat21Service, UtxoContentScanner, WalletService, assessCompression, encodeCborDeterministic, simulateInscribeFees, singleAddressCaveat, validateInscribeOperation,
  type CompressionAssessment, type InscribeBroadcastTransport, type InscribeMintOrchestrator, type InscribeSnapshot, type SimulateInscribeFeesResult, type TxnOutput, type UtxoClassification, type WalletInfo,
} from 'ordpool-sdk';
import { bitcoinNetwork, cat21Config } from '@app/services/ordinals/sdk-tokens';

import { InscribeMintComponent, type ViableInscribeSimulation } from './inscribe-mint.component';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { SafeResourceUrlPipe } from '../safe-url.pipe';
import { SeoService } from '../../../services/seo.service';
import { StateService } from '../../../services/state.service';

// Real keys, so the real gate, simulator and taproot derivation accept them.
const PAYMENT_PRIV = new Uint8Array(32).fill(1);
const ORDINALS_PRIV = new Uint8Array(32).fill(2);
const OTHER_PRIV = new Uint8Array(32).fill(3);
const PAYMENT_PUB = secp256k1.getPublicKey(PAYMENT_PRIV, true);
const ORDINALS_PUB = secp256k1.getPublicKey(ORDINALS_PRIV, true);
const PAYMENT_ADDRESS = btc.p2wpkh(PAYMENT_PUB).address as string;
const ORDINALS_ADDRESS = btc.p2tr(ORDINALS_PUB.slice(1)).address as string;
/** A taproot address the connected wallet holds no key for. */
const FOREIGN_TAPROOT = btc.p2tr(secp256k1.getPublicKey(OTHER_PRIV, true).slice(1)).address as string;
/** A valid address on the wrong network for this mainnet page (BIP173 testnet vector). */
const TESTNET_ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

function wallet(over: Partial<WalletInfo> = {}): WalletInfo {
  return {
    type: 'xverse',
    ordinalsAddress: ORDINALS_ADDRESS,
    paymentAddress: PAYMENT_ADDRESS,
    paymentPublicKey: hex.encode(PAYMENT_PUB),
    ordinalsPublicKey: hex.encode(ORDINALS_PUB),
    ...over,
  } as WalletInfo;
}

/** A single-address wallet: one taproot address and key for coins and assets. */
function singleAddressWallet(over: Partial<WalletInfo> = {}): WalletInfo {
  return wallet({
    type: 'unisat' as WalletInfo['type'],
    paymentAddress: ORDINALS_ADDRESS,
    paymentPublicKey: hex.encode(ORDINALS_PUB),
    ...over,
  });
}

function coin(seed: string, value: number, vout = 0): TxnOutput {
  return { txid: seed.repeat(64).slice(0, 64), vout, value, status: { confirmed: true } } as TxnOutput;
}

const validateSpy = validateInscribeOperation as unknown as jest.Mock;
const simulateSpy = simulateInscribeFees as unknown as jest.Mock;

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

/** Highly repetitive text: every codec shrinks it well past the worth-it threshold. */
function textFile(): File {
  return makeFile(new TextEncoder().encode('ordpool '.repeat(500)), 'notes.txt', 'text/plain');
}

function jsFile(): File {
  return makeFile(new Uint8Array([0x2f, 0x2f]), 'evil.js', 'application/javascript');
}

describe('InscribeMintComponent', () => {
  let component: InscribeMintComponent;
  let fixture: ComponentFixture<InscribeMintComponent>;
  let orchestrator: InscribeMintOrchestrator;
  let walletSubject: BehaviorSubject<WalletInfo | null>;
  /** The electrs port: what `getUtxos` answers for the payment address. */
  let utxos: TxnOutput[];
  /** The content-scan port: verdict per outpoint, `clean` when unlisted. */
  let verdicts: Map<string, UtxoClassification>;
  let setContentSpy: jest.SpyInstance;
  let setBatchSpy: jest.SpyInstance;
  let setWalletSpy: jest.SpyInstance;
  let resetSpy: jest.SpyInstance;
  let mintSpy: jest.SpyInstance;
  /** jsdom has no fetch; the real transport resolves it when it is built. */
  let fetchSpy: jest.Mock;

  /**
   * Hands the component a snapshot that only the wallet can produce (signing
   * progress, a sourced padding coin, resolved parents, a failed mint). The
   * base is the REAL orchestrator's current snapshot and the override is typed
   * `Partial<InscribeSnapshot>`, so a renamed or removed SDK field fails here.
   */
  function emit(over: Partial<InscribeSnapshot>): void {
    (component as unknown as { snap: WritableSignal<InscribeSnapshot> }).snap.set({ ...orchestrator.getSnapshot(), ...over });
  }

  /** Lets the real orchestrator's async UTXO load and recompute settle. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); }
    fixture.detectChanges();
  }

  beforeEach(async () => {
    checkInscriptionsExistImpl = async (ids: ReadonlyArray<string>) =>
      new Map(ids.map((id) => [id, 'exists' as Existence]));
    findRareSatsInOutputsImpl = async (outputs) =>
      outputs.map((u) => ({ utxo: u, address: ORDINALS_ADDRESS, rareSat: null, status: 'scanned' as const }));
    validateSpy.mockClear();
    simulateSpy.mockClear();
    utxos = [];
    verdicts = new Map();

    walletSubject = new BehaviorSubject<WalletInfo | null>(null);
    fetchSpy = jest.fn(async () => { throw new Error('unexpected network call'); });
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;

    const cat21 = {
      getUtxos: jest.fn((_: string) => of(utxos)),
      mempoolApiUrl: 'http://electrs.test.invalid',
    };
    const walletService = {
      connectedWallet$: walletSubject.asObservable(),
      requestWalletConnect: jest.fn(),
    };
    const scanner = {
      states$: new BehaviorSubject(new Map()),
      autoScan: jest.fn(),
      reset: jest.fn(),
      scan: () => of(null),
      classify: async (outpoint: string): Promise<UtxoClassification> => verdicts.get(outpoint) ?? 'clean',
    };
    const stateService = {
      recommendedFees$: of({ fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 }),
      // Read by the real `relativeUrl` pipe on the asset links.
      network: 'mainnet',
      env: { ROOT_NETWORK: '', BASE_MODULE: 'ordpool' },
    };
    const seo = { setTitle: jest.fn(), setDescription: jest.fn() };

    await TestBed.configureTestingModule({
      declarations: [InscribeMintComponent, RelativeUrlPipe],
      imports: [SafeResourceUrlPipe],
      providers: [
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
    // The real orchestrator the component constructed. Spies call through,
    // except `mint`, which is the wallet: signing and broadcast.
    orchestrator = (component as unknown as { orchestrator: InscribeMintOrchestrator }).orchestrator;
    setContentSpy = jest.spyOn(orchestrator, 'setContent');
    setBatchSpy = jest.spyOn(orchestrator, 'setBatch');
    setWalletSpy = jest.spyOn(orchestrator, 'setWallet');
    resetSpy = jest.spyOn(orchestrator, 'reset');
    mintSpy = jest.spyOn(orchestrator, 'mint').mockResolvedValue(
      { commitTxId: 'c'.repeat(64), revealTxId: 'r'.repeat(64) } as Awaited<ReturnType<InscribeMintOrchestrator['mint']>>,
    );
    fixture.detectChanges();
  });

  it('sends commit and reveal through a package transport on our own electrs', async () => {
    // The real transport, asked for its dry run: the request must reach our
    // electrs' package endpoint, nowhere else.
    const { transport } = (orchestrator as unknown as { deps: { transport: InscribeBroadcastTransport } }).deps;
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '[]' });
    await transport.testPackage(['00', '11']).catch(() => undefined);
    expect(fetchSpy.mock.calls[0][0]).toBe('http://electrs.test.invalid/api/txs/test');
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
    // The estimate is the real simulator's funding requirement, unaltered.
    const sim = simulateSpy.mock.results[simulateSpy.mock.results.length - 1].value as SimulateInscribeFeesResult;
    expect(sim.fundingRequirementSats).toBeGreaterThan(0);
    expect(component.preConnectMintSats).toBe(sim.fundingRequirementSats);
  });

  it('runs the gate before minting; ok → orchestrator.mint()', async () => {
    await (component as any).handleFile(pngFile());
    component.inscribe(wallet());
    expect(validateSpy.mock.results[0].value).toEqual(expect.objectContaining({ ok: true }));
    expect(mintSpy).toHaveBeenCalled();
    expect(component.mintGateError).toBe('');
  });

  it('gate rejection → mintGateError set, mint NOT called', async () => {
    await (component as any).handleFile(pngFile());
    // A testnet recipient on this mainnet page: the real gate refuses it.
    component.inscribe(wallet({ ordinalsAddress: TESTNET_ADDRESS }));
    expect(mintSpy).not.toHaveBeenCalled();
    expect(component.mintGateError).toContain('recipient-wrong-network');
  });

  it('single-address wallet → gate ownPaymentAddress is undefined', async () => {
    await (component as any).handleFile(pngFile());
    component.inscribe(singleAddressWallet());
    const cfg = validateSpy.mock.calls[0][0].config;
    expect(cfg.ownPaymentAddress).toBeUndefined();
  });

  it('dual-address wallet → gate ownPaymentAddress is the payment address', async () => {
    await (component as any).handleFile(pngFile());
    component.inscribe(wallet());
    const cfg = validateSpy.mock.calls[0][0].config;
    expect(cfg.ownPaymentAddress).toBe(PAYMENT_ADDRESS);
  });

  it('derives the inscription id as revealTxId + i0', () => {
    expect(component.inscriptionId('r'.repeat(64))).toBe('r'.repeat(64) + 'i0');
  });

  it('txidFromInscriptionId strips the i<index> suffix (single- and multi-digit)', () => {
    const txid = 'a'.repeat(64);
    expect(component.txidFromInscriptionId(`${txid}i0`)).toBe(txid);
    expect(component.txidFromInscriptionId(`${txid}i15`)).toBe(txid);
    expect(component.txidFromInscriptionId(txid)).toBe(txid);
  });

  it('inscribeAnother resets orchestrator + local file state', () => {
    component.pickedFile = { name: 'x', bytes: new Uint8Array(1), contentType: 'image/png', sizeBytes: 1 };
    component.inscribeAnother();
    expect(resetSpy).toHaveBeenCalled();
    expect(component.pickedFile).toBeNull();
  });

  // ---- Compression (native gzip) ------------------------------------------

  /**
   * jsdom lacks the platform codec the SDK compresses with (`Blob.stream`,
   * `CompressionStream`, `Response`), so a worth-it assessment is built here:
   * the SDK's own type, with the body gzipped by Node's zlib. Image types never
   * reach a codec, so the not-worth-it path runs the real function.
   */
  function gzipAssessmentOnce(): void {
    (assessCompression as unknown as jest.Mock).mockImplementationOnce(async (bytes: Uint8Array): Promise<CompressionAssessment> => {
      const compressed = new Uint8Array(require('zlib').gzipSync(bytes));
      return {
        worthIt: true, bestEncoding: 'gzip', originalSize: bytes.length, compressedSize: compressed.length,
        savedBytes: bytes.length - compressed.length,
        savedPercent: Math.round(((bytes.length - compressed.length) / bytes.length) * 100),
        compressed,
      };
    });
  }

  it('worthIt → toggle on by default, compressed body + the winning content_encoding', async () => {
    gzipAssessmentOnce();
    await (component as any).handleFile(textFile());
    const assessment = component.compression;
    expect(assessment?.worthIt).toBe(true);
    expect(component.compressEnabled).toBe(true);
    expect(component.isCompressed).toBe(true);
    expect(component.activeContentEncoding).toBe(assessment?.bestEncoding);
    const last = lastContent();
    expect(last.source.body).toBe(assessment?.compressed);
    expect(last.source.body.length).toBeLessThan(component.pickedFile?.sizeBytes ?? 0);
    expect(last.contentEncoding).toBe(assessment?.bestEncoding);
  });

  it('not-worthIt (already compressed) → toggle off, raw body, no content_encoding', async () => {
    await (component as any).handleFile(pngFile());   // image/png is already compressed: worthIt false
    expect(component.compressEnabled).toBe(false);
    expect(component.activeContentEncoding).toBeUndefined();
    const last = lastContent();
    expect(last.contentEncoding).toBeUndefined();
    expect(last.source.body).toBe(component.pickedFile?.bytes);
  });

  it('toggleCompression(false) after a worthIt pick → falls back to the raw body', async () => {
    gzipAssessmentOnce();
    await (component as any).handleFile(textFile());
    expect(component.isCompressed).toBe(true);
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
  /** The bytes the real deterministic-CBOR encoder writes for `value`. */
  const cbor = (value: unknown): Uint8Array => encodeCborDeterministic(value);

  it('KV metadata → encoded bytes threaded into content', async () => {
    await (component as any).handleFile(pngFile());
    component.addMetadataRow();
    component.setMetadataRow(0, 'collection', 'cats');
    expect(component.metadataBytes).not.toBeNull();
    expect(lastContent().metadata).toEqual(cbor({ collection: 'cats' }));
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
    expect(bytes).toEqual(cbor({ a: { b: 1 }, list: [1, 2] }));
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
    expect(c.metadata).toEqual(cbor({ k: 'v' }));
  });

  it('inscribe() in delegate mode → gate intent has empty body + no contentType, mint runs', () => {
    component.switchInscribeMode('delegate');
    component.onDelegateIdChange(DELEGATE_ID);
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

  // Every verdict here comes out of the real orchestrator and the real funding
  // policy (`recommendFunding`), fed through its two IO ports: the coins electrs
  // lists and what the content scan says about each.
  describe('funding-status gating (inscribe-button enable)', () => {
    const DELEGATE = '6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i0';
    const INSCRIPTION_ON_COIN = 'e'.repeat(64) + 'i0';
    const carriesInscription: UtxoClassification = {
      verdict: 'has-assets',
      assets: { inscriptionIds: [INSCRIPTION_ON_COIN], runeNames: [], catIds: [], rareSat: null },
    };
    const outpoint = (u: TxnOutput) => `${u.txid}:${u.vout}`;

    /** Connect `w` holding `coins`, give it something to inscribe, let the SDK decide. */
    async function fund(w: WalletInfo, coins: TxnOutput[], dirty: TxnOutput[] = []): Promise<void> {
      utxos = coins;
      dirty.forEach((u) => verdicts.set(outpoint(u), carriesInscription));
      walletSubject.next(w);
      fixture.detectChanges();
      await settle();
      component.switchInscribeMode('delegate');
      component.onDelegateIdChange(DELEGATE);
      component.setFeeRate(2);
      await settle();
    }

    it('a clean covering coin resolves to ready: CTA enabled, no notice', async () => {
      await fund(wallet(), [coin('a', 100_000)]);
      expect(component.fundingStatus()).toBe('auto');
      expect(component.fundingCta().kind).toBe('ready');
      expect(component.hasFundingSource()).toBe(true);
      expect(component.assetNotice()).toBeNull();
    });

    it('only a dirty coin covers, separate payment address: CTA enabled WITH a notice naming the inscription', async () => {
      const dirty = coin('b', 100_000);
      await fund(wallet(), [dirty], [dirty]);
      expect(component.fundingCta().kind).toBe('notice');
      expect(component.hasFundingSource()).toBe(true);
      expect(component.assetNotice()?.inscriptionIds).toEqual([INSCRIPTION_ON_COIN]);
    });

    it('only a dirty coin covers, one address for everything: CTA disabled with the warning', async () => {
      const dirty = coin('c', 100_000);
      await fund(singleAddressWallet(), [dirty], [dirty]);
      expect(component.fundingStatus()).toBe('expert-required');
      expect(component.fundingCta().kind).toBe('warning');
      expect(component.hasFundingSource()).toBe(false);
    });

    it('no coin covers: insufficient, CTA disabled', async () => {
      await fund(wallet(), [coin('d', 1_000)]);
      expect(component.fundingStatus()).toBe('insufficient');
      expect(component.fundingCta().kind).toBe('insufficient');
      expect(component.hasFundingSource()).toBe(false);
    });

    it('a scan that has not answered holds the CTA in scanning', async () => {
      const pending = coin('f', 100_000);
      // A content scan that never answers: the verdict is unknown, so not clean.
      const scanner = TestBed.inject(UtxoContentScanner) as unknown as { classify: (outpoint: string) => Promise<UtxoClassification> };
      scanner.classify = () => new Promise<UtxoClassification>(() => undefined);
      await fund(wallet(), [pending]);
      expect(component.fundingCta().kind).toBe('scanning');
      expect(component.hasFundingSource()).toBe(false);
      // The snapshot type also allows no resolved verdict at all; that holds too.
      emit({ resolvedFundingStatus: null });
      expect(component.fundingCta().kind).toBe('scanning');
      expect(component.hasFundingSource()).toBe(false);
    });

    it('the CTA follows the RESOLVED coin, not the recommendation: a hand-picked dirty coin on a one-address wallet is enabled WITH the assets named', async () => {
      const dirty = coin('a', 100_000);
      await fund(singleAddressWallet(), [dirty], [dirty]);
      expect(component.fundingStatus()).toBe('expert-required');
      expect(component.hasFundingSource()).toBe(false);
      // The user picks the dirty coin by hand in the picker; the SDK re-decides
      // for that coin.
      const sim = orchestrator.getSnapshot().simulations.find((r) => outpoint(r.utxo) === outpoint(dirty));
      expect(sim?.simulation).toBeTruthy();
      component.selectPaymentOutput({ paymentOutput: dirty, simulation: sim?.simulation ?? null, available: true, scan: { kind: 'scanned-with-assets', content: {} } as never, bucket: 'assets' });
      await settle();
      expect(orchestrator.getSnapshot().resolvedFundingStatus).toBe('asset-notice');
      expect(component.hasFundingSource()).toBe(true);
      expect(component.fundingCta().kind).toBe('notice');
      expect(component.assetNotice()?.inscriptionIds).toEqual([INSCRIPTION_ON_COIN]);
    });
  });

  // The per-coin fee column (FAMILY_UX): the inscribe row marks, in place, the
  // coin selection would auto-pick (joined by outpoint), AND carries the over-pay
  // note, read off the per-row simulation's commitAbsorbedSubDustSats (the
  // inscribe orchestrator exposes no candidateFees map). Only the commit folds
  // sub-dust change; the reveal's fee is reserved in the commit output.
  describe('per-coin fee column (recommended mark + over-pay)', () => {
    const out = (v: number): TxnOutput =>
      ({ txid: String(v).repeat(64).slice(0, 64), vout: 0, value: v, status: { confirmed: true } } as TxnOutput);
    const row = (u: TxnOutput, commitAbsorbedSubDustSats = 0): ViableInscribeSimulation =>
      ({ paymentOutput: u, simulation: { fundingRequirementSats: 4321, totalFeeSats: 3000, commitAbsorbedSubDustSats } as SimulateInscribeFeesResult, available: true, scan: { kind: 'scanned-clean' }, bucket: 'clean' });

    it('marks the auto-pick coin, and only that one, by outpoint', async () => {
      // Both cover; ord's best fit (the SDK's selection) takes the smaller one.
      const recCoin = out(40_000);
      const other = out(50_000);
      utxos = [other, recCoin];
      walletSubject.next(wallet());
      fixture.detectChanges();
      await settle();
      component.switchInscribeMode('delegate');
      component.onDelegateIdChange('6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i0');
      component.setFeeRate(2);
      await settle();
      expect(orchestrator.getSnapshot().fundingRecommendation.recommended?.txid).toBe(recCoin.txid);
      expect(component.isRecommendedRow(row(recCoin))).toBe(true);
      expect(component.isRecommendedRow(row(other))).toBe(false);
    });

    it('marks nothing when there is no recommendation', () => {
      expect(orchestrator.getSnapshot().fundingRecommendation.recommended).toBeNull();
      expect(component.isRecommendedRow(row(out(50_000)))).toBe(false);
    });

    it('overPaidSats is the folded sats when the commit over-pays (commitAbsorbedSubDustSats > 0)', () => {
      expect(component.overPaidSats(row(out(50_000), 1_200))).toBe(1_200);
    });

    it('overPaidSats is null when the commit emits change (commitAbsorbedSubDustSats === 0) — NOT 0', () => {
      // The 0-vs-positive boundary: returning 0 here (the mutation) would misfire
      // the "change folded into the fee" note on every roomy coin. Assert null.
      expect(component.overPaidSats(row(out(50_000), 0))).toBeNull();
    });

    it('feeClass routes through the shared classifier (normal / overpay / unavailable)', () => {
      // Inscribe builds a CandidateFeeRow from the per-row simulation and classifies
      // it with the same SDK function the mint page uses, so the two can't drift.
      expect(component.feeClass(row(out(50_000), 0))).toBe('normal');
      expect(component.feeClass(row(out(50_000), 1_200))).toBe('overpay');
      const unavailable: ViableInscribeSimulation = { paymentOutput: out(500), simulation: null, available: false, scan: { kind: 'not-scanned' }, bucket: 'unscanned' };
      expect(component.feeClass(unavailable)).toBe('unavailable');
    });

    it('overPaidSats is null on an unavailable row (null simulation), never a crash', () => {
      const unavailable: ViableInscribeSimulation = { paymentOutput: out(500), simulation: null, available: false, scan: { kind: 'not-scanned' }, bucket: 'unscanned' };
      expect(component.overPaidSats(unavailable)).toBeNull();
      expect(component.changeSats(unavailable)).toBe(0);
    });

    // show-the-row (FAMILY_UX): a coin that can't fund the inscription at the
    // current rate is unpickable, and the rule lives in the HANDLER, not only the
    // hidden button. Mutation-checkable: dropping the guard lets the pick land.
    it('selectPaymentOutput REFUSES an unavailable row (handler is the authority)', () => {
      const unavailable: ViableInscribeSimulation = { paymentOutput: out(500), simulation: null, available: false, scan: { kind: 'not-scanned' }, bucket: 'unscanned' };
      component.selectPaymentOutput(unavailable);
      expect(component.selectedPaymentOutput).toBeUndefined();
      expect(orchestrator.getSnapshot().selectedUtxo).toBeNull();
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
      utxo: coin('a'.repeat(64)), address: ORDINALS_ADDRESS, rareSat: null, status: 'scanned', ...over,
    });

    it('scan splits rows into rare candidates, common, and unknown', async () => {
      findRareSatsInOutputsImpl = async () => [
        row({ utxo: coin('a'.repeat(64)), rareSat: { sat: 5_000_000_000, offset: 0, rarity: 'uncommon' } }),
        row({ utxo: coin('b'.repeat(64)), rareSat: null, status: 'scanned' }),       // common
        row({ utxo: coin('c'.repeat(64)), rareSat: null, status: 'unknown', address: null }), // couldn't check
      ];
      await component.scanForRareSats(ORDINALS_ADDRESS);
      expect(component.rareSatCandidates.length).toBe(1);
      expect(component.rareSatCandidates[0].rareSat?.rarity).toBe('uncommon');
      expect(component.rareSatUnknownCount).toBe(1);
      expect(component.rareSatScannedEmpty).toBe(false);
    });

    it('a coin that is scanned-but-common is not a candidate and reads as empty', async () => {
      findRareSatsInOutputsImpl = async () => [row({ rareSat: null, status: 'scanned' })];
      await component.scanForRareSats(ORDINALS_ADDRESS);
      expect(component.rareSatCandidates.length).toBe(0);
      expect(component.rareSatUnknownCount).toBe(0);
      expect(component.rareSatScannedEmpty).toBe(true);
    });

    it('an unknown row is counted separately, never as a rare-sat candidate', async () => {
      findRareSatsInOutputsImpl = async () => [row({ status: 'unknown', address: null, rareSat: null })];
      await component.scanForRareSats(ORDINALS_ADDRESS);
      expect(component.rareSatCandidates.length).toBe(0);
      expect(component.rareSatUnknownCount).toBe(1);
    });

    it('pickRareSat selects, re-pick and clearRareSat both clear', async () => {
      findRareSatsInOutputsImpl = async () => [row({ rareSat: { sat: 1, offset: 0, rarity: 'rare' } })];
      await component.scanForRareSats(ORDINALS_ADDRESS);
      const r = component.rareSatCandidates[0];
      component.pickRareSat(r);
      expect(component.selectedRareSat).toBe(r);
      component.pickRareSat(r);                 // re-pick toggles off
      expect(component.selectedRareSat).toBeNull();
      component.pickRareSat(r);
      component.clearRareSat();
      expect(component.selectedRareSat).toBeNull();
    });

    it('a below-floor sat is no longer blocked: the orchestrator sources padding, satTarget still builds', async () => {
      walletSubject.next(wallet());
      fixture.detectChanges();
      findRareSatsInOutputsImpl = async () => [row({ address: ORDINALS_ADDRESS, rareSat: { sat: 1, offset: 100, rarity: 'epic' } })];
      await component.scanForRareSats(ORDINALS_ADDRESS);
      component.pickRareSat(component.rareSatCandidates[0]);
      expect(component.rareSatBlocked).toBe(false);              // padding is not a block anymore
      expect((component as any).satTarget?.kind).toBe('in-utxo'); // target still built
    });

    it('rareSatPadding surfaces the padding coin the orchestrator sourced (snapshot.padding)', () => {
      expect(component.rareSatPadding()).toBeNull(); // none by default
      emit({ padding: { utxo: { txid: 'p'.repeat(64), vout: 2, value: 546, status: { confirmed: true } } as TxnOutput, shortfallSats: 230, automatic: true } });
      const pad = component.rareSatPadding();
      expect(pad?.automatic).toBe(true);
      expect(pad?.utxo.vout).toBe(2);
      expect(pad?.shortfallSats).toBe(230);
    });

    it('a scan failure sets an error and leaves no rows', async () => {
      findRareSatsInOutputsImpl = async () => { throw new Error('ord down'); };
      await component.scanForRareSats(ORDINALS_ADDRESS);
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
      findRareSatsInOutputsImpl = async () => [row({ address: ORDINALS_ADDRESS, rareSat: { sat: 5, offset: 900, rarity: 'rare' } })];
      await component.scanForRareSats(ORDINALS_ADDRESS);
      component.pickRareSat(component.rareSatCandidates[0]);
      expect(component.rareSatBlocked).toBe(false);
      expect(lastContent()?.satTarget?.kind).toBe('in-utxo');
      // clearing removes the satTarget again
      component.clearRareSat();
      expect(lastContent()?.satTarget).toBeUndefined();
    });

    it('a key mismatch blocks the mint with a reason and no satTarget', async () => {
      withWalletAndContent();
      // The rare sat sits at a taproot address this wallet holds no key for.
      findRareSatsInOutputsImpl = async () => [row({ address: FOREIGN_TAPROOT, rareSat: { sat: 5, offset: 900, rarity: 'rare' } })];
      await component.scanForRareSats(ORDINALS_ADDRESS);
      component.pickRareSat(component.rareSatCandidates[0]);
      expect(component.rareSatBlocked).toBe(true);
      expect(component.rareSatBlockReason).toContain("not at your wallet's ordinals address");
      expect(lastContent()?.satTarget).toBeUndefined();
    });

    it('a sat below the dust floor still threads a satTarget (orchestrator pads it, no block)', async () => {
      withWalletAndContent();
      findRareSatsInOutputsImpl = async () => [row({ address: ORDINALS_ADDRESS, rareSat: { sat: 5, offset: 100, rarity: 'epic' } })];
      await component.scanForRareSats(ORDINALS_ADDRESS);
      component.pickRareSat(component.rareSatCandidates[0]);
      expect(component.rareSatBlocked).toBe(false);            // padding is the orchestrator's job now
      expect(lastContent()?.satTarget?.kind).toBe('in-utxo');  // target still threaded
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
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([pngFile(8, 'a.png')]);
      component.inscribe(wallet());
      expect(mintSpy).toHaveBeenCalled();
    });

    it('inscribeBatch blocks with an error and does not mint when the gate fails', async () => {
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([pngFile(8, 'a.png')]);
      // The entry's destination is a testnet address on a mainnet page.
      component.setBatchEntryDestination(0, TESTNET_ADDRESS);
      component.inscribe(wallet());
      expect(component.mintGateError).toContain('refused');
      expect(mintSpy).not.toHaveBeenCalled();
    });

    it('per-entry title and destination thread onto that batch inscription', async () => {
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([pngFile(8, 'a.png'), pngFile(8, 'b.png')]);
      component.setBatchEntryTitle(0, 'Cat #1');
      component.setBatchEntryDestination(1, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
      const batch = lastBatch();
      expect(batch.inscriptions[0].title).toBe('Cat #1');
      expect(batch.inscriptions[0].destination).toBeUndefined();       // entry 0 has no destination
      expect(batch.inscriptions[1].destination).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
      expect(batch.inscriptions[1].title).toBeUndefined();             // entry 1 has no title
    });

    it('an invalid destination flags the row and blocks the mint; a valid one clears it', async () => {
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([pngFile(8, 'a.png')]);
      component.setBatchEntryDestination(0, 'not-an-address');
      expect(component.batchEntryDestinationInvalid('not-an-address')).toBe(true);
      expect(component.batchInvalid).toBe(true);
      component.setBatchEntryDestination(0, 'bc1p64fa7mjsvlfcutnfapwhxyuvchxgk22l4at7xsh4z02tuuqwaj5syt6x2e');
      expect(component.batchInvalid).toBe(false);
    });

    it('parent ids thread onto the batch as parentIds; a malformed one blocks', async () => {
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([pngFile(8, 'a.png')]);
      component.addBatchParentRow();
      component.onBatchParentIdChange(0, 'a'.repeat(64) + 'i0');
      expect(lastBatch().parentIds).toEqual(['a'.repeat(64) + 'i0']);
      expect(component.batchParentsInvalid).toBe(false);
      component.addBatchParentRow();
      component.onBatchParentIdChange(1, 'not-an-id');
      expect(component.batchParentIdInvalid('not-an-id')).toBe(true);
      expect(component.batchParentsInvalid).toBe(true);
      // a malformed parent is dropped from the wire, valid one stays
      expect(lastBatch().parentIds).toEqual(['a'.repeat(64) + 'i0']);
    });
  });

  describe('Parents resolution, signing indicator, userMessage', () => {
    it('threads ordinalsPublicKey onto the wallet context (parent resolution needs it)', () => {
      walletSubject.next(wallet());
      fixture.detectChanges();
      expect(setWalletSpy).toHaveBeenCalledWith(
        expect.objectContaining({ ordinalsPublicKey: hex.encode(ORDINALS_PUB) }),
      );
    });

    it('a duplicate same-identity re-emission does NOT re-drive setWallet', () => {
      // The WalletService BehaviorSubject replays the SAME wallet identity on
      // every onAccountChange (fires repeatedly on regtest). A re-fired
      // setWallet drops the orchestrator to 'loading-utxos' and tears the
      // Inscribe button out of the DOM for a frame, swallowing an in-flight
      // click. The component must dedupe.
      const w = wallet();
      walletSubject.next(w);
      fixture.detectChanges();
      const callsAfterFirst = setWalletSpy.mock.calls.length;
      walletSubject.next({ ...w }); // same identity, fresh object reference
      fixture.detectChanges();
      expect(setWalletSpy.mock.calls.length).toBe(callsAfterFirst);
    });

    it('resolvedParents surfaces snapshot.parents', () => {
      expect(component.resolvedParents()).toBeNull();
      emit({ parents: [{ id: 'a'.repeat(64) + 'i0', address: ORDINALS_ADDRESS, value: 546, outpoint: 'a'.repeat(64) + ':0' }] });
      expect(component.resolvedParents()?.[0].value).toBe(546);
    });

    it('signingMessage names the step for a two-signature batch, generic otherwise', () => {
      expect(component.signingMessage()).toContain('confirm in your wallet'); // no signing yet
      emit({ signing: { step: 2, of: 2, what: 'parent-inputs' } });
      expect(component.signingMessage()).toBe('Signature 2 of 2: approve the parent inputs in your wallet');
      emit({ signing: { step: 1, of: 1, what: 'commit' } });
      expect(component.signingMessage()).toContain('confirm in your wallet'); // single-sig stays generic
    });

    it('mintError shows the person-facing userMessage, not the developer errorMessage', () => {
      (component as any).mintAttempted = true;
      emit({ state: 'error', errorMessage: 'sat-offset-needs-padding', userMessage: 'No single coin covers the padding shortfall.' });
      expect(component.mintError()).toBe('No single coin covers the padding shortfall.');
    });
  });

  describe('Code-review fixes', () => {
    const VALID_DELEGATE = '6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i0';
    const TAPROOT = 'bc1p64fa7mjsvlfcutnfapwhxyuvchxgk22l4at7xsh4z02tuuqwaj5syt6x2e';

    it('a duplicate trait name disables the inscribe button (was warn-only)', async () => {
      // everything else valid: delegate content + a clean covering coin + a valid form
      utxos = [coin('a', 100_000)];
      walletSubject.next(wallet());
      fixture.detectChanges();
      await settle();
      component.switchInscribeMode('delegate');
      component.onDelegateIdChange(VALID_DELEGATE);
      component.setFeeRate(2);
      await settle();
      expect(component.fundingCta().kind).toBe('ready');
      expect(component.mintDisabled).toBe(false);                 // baseline
      component.addTraitRow(); component.addTraitRow();
      component.onTraitNameChange(0, 'Color'); component.onTraitNameChange(1, 'Color');
      expect(component.traitDuplicateName).toBe('Color');
      expect(component.mintDisabled).toBe(true);                  // now blocked
    });

    it('inscribeBatch gates each entry with its OWN destination, not the ordinals address', async () => {
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([pngFile(8, 'a.png')]);
      component.setBatchEntryDestination(0, TAPROOT);
      validateSpy.mockClear();
      component.inscribe(wallet());
      const intent = validateSpy.mock.calls[validateSpy.mock.calls.length - 1][0].operation.intent;
      expect(intent.recipient).toBe(TAPROOT);                    // the entry's destination, gated
    });

    it('inscribeBatch gates the ordinals address when an entry has no destination', async () => {
      component.toggleBatchMode(true);
      await (component as any).addBatchFiles([pngFile(8, 'a.png')]);
      validateSpy.mockClear();
      component.inscribe(wallet({ ordinalsAddress: 'bc1p-ord-default' }));
      const intent = validateSpy.mock.calls[validateSpy.mock.calls.length - 1][0].operation.intent;
      expect(intent.recipient).toBe('bc1p-ord-default');
    });

    it('batchEntryDestinationInvalid is network-agnostic and rejects bad charset/garbage', () => {
      expect(component.batchEntryDestinationInvalid('')).toBe(false);                 // empty ok
      expect(component.batchEntryDestinationInvalid(TAPROOT)).toBe(false);            // mainnet bech32
      expect(component.batchEntryDestinationInvalid('bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080')).toBe(false); // regtest no longer rejected
      expect(component.batchEntryDestinationInvalid('not-an-address')).toBe(true);    // garbage
      expect(component.batchEntryDestinationInvalid('bc1' + 'b'.repeat(30))).toBe(true); // 'b' not in bech32 charset
    });

    it('a duplicate trait does not throw in the pre-connect estimate (simEnvelopeFields catches)', async () => {
      await (component as any).handleFile(pngFile()); // a file so recomputePreConnectCost runs the sim
      component.addTraitRow(); component.addTraitRow();
      component.onTraitNameChange(0, 'Color');
      expect(() => component.onTraitNameChange(1, 'Color')).not.toThrow(); // dup would throw in the encoder
    });

    it('clearFile resets the Advanced options so they do not ride onto the next file', async () => {
      await (component as any).handleFile(pngFile());
      component.titleControl.setValue('Stale');
      component.addTraitRow(); component.onTraitNameChange(0, 'x');
      component.addGalleryRow(); component.onGalleryIdChange(0, 'a'.repeat(64) + 'i0');
      component.postageControl.setValue(9000);
      component.clearFile();
      expect(component.titleControl.value).toBe('');
      expect(component.traitRows.length).toBe(0);
      expect(component.galleryRows.length).toBe(0);
      expect(component.postageControl.value).toBe(546);
      expect(component.selectedRareSat).toBeNull();
    });
  });
});
