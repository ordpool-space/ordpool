/**
 * Shared harness for the mint and inscribe funding-panel specs that run the
 * REAL ordpool-sdk (orchestrator, scanner, services, funding policy) behind
 * ordpool's DI wiring. About this app only: it builds the providers
 * `app.module.ts` builds and answers the network calls those SDK classes make.
 *
 * Faked, and only at the IO boundary:
 *   - `globalThis.fetch`: electrs `GET /api/address/:a/utxo` in esplora's
 *     documented shape (esplora API.md, typed by the SDK's `TxnOutput`), ord
 *     and cat21-ord `GET /output/:outpoint` from the SDK's canonical
 *     `/output` fixtures, or an HTTP 503 for a coin whose scan must fail.
 *     Every other URL is answered 404, the indexer status reads on the mint
 *     hero fall back to their empty state on it.
 *   - WalletService's storage: a persisted `LAST_CONNECTED_WALLET`, which is
 *     how a reload restores a connection.
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import {
  Cat21ApiService, Cat21Service, KnownOrdinalWalletType, LAST_CONNECTED_WALLET, Network, OutputFixture,
  TxnOutput, UtxoContentScanner, WalletInfo, WalletService,
} from 'ordpool-sdk';

import { bitcoinNetwork, cat21Config } from '@app/services/ordinals/sdk-tokens';

export const HARNESS_CONFIG = {
  mempoolApiUrl: 'http://electrs.test',
  cat21ApiUrl: 'http://cat21-api.test',
  ordApiUrl: 'http://ord.test',
  cat21OrdApiUrl: 'http://cat21-ord.test',
};

/** A deterministic key from one repeated byte. Only for building real addresses. */
function pubkeyFrom(byte: number): Uint8Array {
  return secp256k1.getPublicKey(new Uint8Array(32).fill(byte), true);
}

/**
 * A wallet whose payment and ordinals addresses are DIFFERENT (Xverse's
 * layout): `recommendFunding` sees topology `separate-payment-address`.
 */
export function separateAddressWallet(): WalletInfo {
  const pay = pubkeyFrom(0x11);
  const ord = pubkeyFrom(0x22);
  return {
    type: KnownOrdinalWalletType.xverse,
    paymentAddress: btc.p2wpkh(pay).address!, // why: p2wpkh of a valid compressed key always has an address
    paymentPublicKey: hex.encode(pay),
    ordinalsAddress: btc.p2tr(ord.slice(1)).address!, // why: p2tr of a valid x-only key always has an address
    ordinalsPublicKey: hex.encode(ord),
    signingSupported: true,
  };
}

/**
 * A wallet that uses ONE taproot address for both (UniSat's layout):
 * `recommendFunding` sees topology `one-address`.
 */
export function oneAddressWallet(): WalletInfo {
  const key = pubkeyFrom(0x33);
  const address = btc.p2tr(key.slice(1)).address!; // why: p2tr of a valid x-only key always has an address
  return {
    type: KnownOrdinalWalletType.unisat,
    paymentAddress: address,
    paymentPublicKey: hex.encode(key),
    ordinalsAddress: address,
    ordinalsPublicKey: hex.encode(key),
    signingSupported: true,
  };
}

/** One confirmed electrs UTXO row (esplora `GET /address/:a/utxo` element). */
export function electrsUtxo(byte: string, value: number): TxnOutput {
  return {
    txid: byte.repeat(64),
    vout: 0,
    value,
    status: { confirmed: true, block_height: 900_000, block_hash: 'f'.repeat(64), block_time: 1_760_000_000 },
  };
}

export const outpointOf = (u: TxnOutput): string => `${u.txid}:${u.vout}`;

/** What the fake network answers for one coin's two `/output` reads. */
export type CoinScan = OutputFixture | 'ord-unavailable';

/**
 * The fake network. `scans` is mutable so a spec can change what ord answers
 * between two reads (the retry path).
 */
export class FakeNetwork {
  readonly utxosByAddress = new Map<string, TxnOutput[]>();
  readonly scans = new Map<string, CoinScan>();
  readonly requested: string[] = [];

  install(): void {
    globalThis.fetch = (async (input: RequestInfo | URL) => this.answer(String(input))) as typeof fetch;
  }

  private answer(url: string): Response {
    this.requested.push(url);
    // The two members the SDK's fetch helpers read (`ok`, `status`) plus the
    // body readers; jsdom ships no `Response` to construct.
    const json = (body: unknown): Response => ({
      ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
    }) as unknown as Response;
    const fail = (status: number, body: string): Response => ({
      ok: false, status, json: async () => { throw new Error(body); }, text: async () => body,
    }) as unknown as Response;

    const utxoMatch = url.match(/^http:\/\/electrs\.test\/api\/address\/([^/]+)\/utxo$/);
    if (utxoMatch) {
      return json(this.utxosByAddress.get(utxoMatch[1]) ?? []);
    }
    const outputMatch = url.match(/^http:\/\/(ord|cat21-ord)\.test\/output\/(.+)$/);
    if (outputMatch) {
      const scan = this.scans.get(outputMatch[2]);
      if (!scan) { return fail(404, `no fixture for ${outputMatch[2]}`); }
      if (scan === 'ord-unavailable') { return fail(503, 'ord unavailable'); }
      return json(outputMatch[1] === 'ord' ? scan.ord : scan.cat21Ord);
    }
    return fail(404, `not served by the harness: ${url}`);
  }
}

/** The SDK providers `app.module.ts` registers, constructed for real. */
export function sdkProviders(wallet: WalletInfo) {
  const stored = new Map<string, string>([[LAST_CONNECTED_WALLET, JSON.stringify(wallet)]]);
  const storage = {
    getValue: (k: string) => stored.get(k) ?? null,
    setValue: (k: string, v: string) => { stored.set(k, v); },
    removeItem: (k: string) => { stored.delete(k); },
  };
  return [
    { provide: bitcoinNetwork, useValue: Network.Mainnet },
    { provide: cat21Config, useValue: HARNESS_CONFIG },
    { provide: Cat21ApiService, useFactory: () => new Cat21ApiService(HARNESS_CONFIG) },
    { provide: UtxoContentScanner, useFactory: () => new UtxoContentScanner(HARNESS_CONFIG) },
    { provide: WalletService, useFactory: () => new WalletService({ storage, network: Network.Mainnet }) },
    { provide: Cat21Service, useFactory: () => new Cat21Service(HARNESS_CONFIG, Network.Mainnet) },
  ];
}

/**
 * Let the SDK's promise chains run until `done()` holds, rendering between
 * turns. Bounded: the fake network answers synchronously, so a state that
 * needs more turns than this is a defect in the wiring, not a slow network.
 */
export async function settle(render: () => void, done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200; turn++) {
    render();
    if (done()) { return; }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  render();
  if (!done()) { throw new Error('settle: the funding panel never reached the awaited state'); }
}

/** Visible text of an element, whitespace collapsed the way a reader sees it. */
export function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
