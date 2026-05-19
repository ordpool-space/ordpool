import * as fs from 'fs';
import * as path from 'path';

import { decodeSimulateData } from './ordpool-alkanes-metadata';

const SELECTOR_NAME = 99;
const SELECTOR_SYMBOL = 100;
const SELECTOR_TOTAL_SUPPLY = 101;

const TESTDATA_ROOT = path.join(__dirname, '..', '..', 'testdata', 'alkanes');

function loadFixture(alkaneDir: string, selectorLabel: string, endpoint: 'subfrost' | 'sandshrew'): any {
  const file = path.join(TESTDATA_ROOT, alkaneDir, `${selectorLabel}_${endpoint}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function dataHex(fixture: any): string {
  return fixture?.result?.execution?.data;
}

describe('decodeSimulateData — synthetic edge cases', () => {

  it('decodes a symbol with trailing nulls', () => {
    expect(decodeSimulateData('0x42544300000000', SELECTOR_SYMBOL)).toBe('BTC');
  });

  it('returns null for an empty data payload', () => {
    expect(decodeSimulateData('0x', SELECTOR_NAME)).toBeNull();
    expect(decodeSimulateData('0x', SELECTOR_TOTAL_SUPPLY)).toBeNull();
  });

  it('returns null when the string contains non-printable bytes', () => {
    expect(decodeSimulateData('0xff', SELECTOR_NAME)).toBeNull();
  });

  it('decodes short u128 payloads as little-endian bigint', () => {
    expect(decodeSimulateData('0x0100000000000000', SELECTOR_TOTAL_SUPPLY)).toBe(1n);
    expect(decodeSimulateData('0xff00000000000000', SELECTOR_TOTAL_SUPPLY)).toBe(255n);
    expect(decodeSimulateData('0x0001000000000000', SELECTOR_TOTAL_SUPPLY)).toBe(256n);
  });
});

// Each block below pins one real alkane (subfrost + sandshrew fixtures
// captured by `node fetch-alkanes-testdata.js`). Both endpoints must
// return identical bytes for the same on-chain query — the decoder is
// then verified against the bytes directly.

describe('decodeSimulateData — real on-chain responses (alkane 2:0 DIESEL)', () => {

  const alkane = '2_0_diesel';

  it('decodes name() = "DIESEL" from both endpoints', () => {
    const sub = loadFixture(alkane, '99_name', 'subfrost');
    const san = loadFixture(alkane, '99_name', 'sandshrew');
    expect(dataHex(sub)).toBe('0x44494553454c');
    expect(dataHex(san)).toBe(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_NAME)).toBe('DIESEL');
  });

  it('decodes symbol() = "DIESEL" from both endpoints', () => {
    const sub = loadFixture(alkane, '100_symbol', 'subfrost');
    const san = loadFixture(alkane, '100_symbol', 'sandshrew');
    expect(dataHex(sub)).toBe('0x44494553454c');
    expect(dataHex(san)).toBe(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_SYMBOL)).toBe('DIESEL');
  });

  it('decodes totalSupply() as a 16-byte u128 little-endian', () => {
    const sub = loadFixture(alkane, '101_total_supply', 'subfrost');
    const san = loadFixture(alkane, '101_total_supply', 'sandshrew');
    expect(dataHex(sub)).toBe('0x37055ace943a00000000000000000000');
    expect(dataHex(san)).toBe(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_TOTAL_SUPPLY)).toBe(64410791576887n);
  });
});

describe('decodeSimulateData — real on-chain responses (alkane 2:100 FARTUNE100)', () => {

  const alkane = '2_100_fartune100';

  it('decodes name() = "FARTUNE100" from both endpoints', () => {
    const sub = loadFixture(alkane, '99_name', 'subfrost');
    const san = loadFixture(alkane, '99_name', 'sandshrew');
    expect(dataHex(sub)).toBe('0x46415254554e45313030');
    expect(dataHex(san)).toBe(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_NAME)).toBe('FARTUNE100');
  });

  it('decodes symbol() = "F100" — different from the name', () => {
    const sub = loadFixture(alkane, '100_symbol', 'subfrost');
    const san = loadFixture(alkane, '100_symbol', 'sandshrew');
    expect(dataHex(sub)).toBe('0x46313030');
    expect(dataHex(san)).toBe(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_SYMBOL)).toBe('F100');
  });

  it('decodes totalSupply() = 10^15 (one quadrillion)', () => {
    const sub = loadFixture(alkane, '101_total_supply', 'subfrost');
    const san = loadFixture(alkane, '101_total_supply', 'sandshrew');
    expect(dataHex(sub)).toBe('0x0080c6a47e8d03000000000000000000');
    expect(dataHex(san)).toBe(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_TOTAL_SUPPLY)).toBe(1000000000000000n);
  });
});

describe('decodeSimulateData — real on-chain responses (alkane 2:1000 Alkane Pandas #342)', () => {

  const alkane = '2_1000_alkane_pandas_342';

  it('decodes name() = "Alkane Pandas #342" — name contains a space and a hash', () => {
    const sub = loadFixture(alkane, '99_name', 'subfrost');
    const san = loadFixture(alkane, '99_name', 'sandshrew');
    expect(dataHex(sub)).toBe('0x416c6b616e652050616e6461732023333432');
    expect(dataHex(san)).toBe(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_NAME)).toBe('Alkane Pandas #342');
  });

  it('decodes symbol() = "alkane-pandas-342" — symbol is hyphenated lowercase', () => {
    const sub = loadFixture(alkane, '100_symbol', 'subfrost');
    const san = loadFixture(alkane, '100_symbol', 'sandshrew');
    expect(dataHex(sub)).toBe('0x616c6b616e652d70616e6461732d333432');
    expect(dataHex(san)).toBe(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_SYMBOL)).toBe('alkane-pandas-342');
  });

  it('decodes totalSupply() = 1 (NFT-style single-supply token)', () => {
    const sub = loadFixture(alkane, '101_total_supply', 'subfrost');
    const san = loadFixture(alkane, '101_total_supply', 'sandshrew');
    expect(dataHex(sub)).toBe('0x01000000000000000000000000000000');
    expect(dataHex(san)).toBe(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_TOTAL_SUPPLY)).toBe(1n);
  });
});

describe('decodeSimulateData — non-existent alkane (negative-cache path)', () => {

  const alkane = '999999_999999_unknown';

  it.each([
    ['99_name',         SELECTOR_NAME],
    ['100_symbol',      SELECTOR_SYMBOL],
    ['101_total_supply', SELECTOR_TOTAL_SUPPLY],
  ])('returns null for selector %s on a non-existent alkane (both endpoints)', (label, selector) => {
    const sub = loadFixture(alkane, label, 'subfrost');
    const san = loadFixture(alkane, label, 'sandshrew');
    expect(dataHex(sub)).toBe('0x');
    expect(dataHex(san)).toBe('0x');
    expect(sub.result.execution.error).toBe('unexpected end-of-file (at offset 0x0)');
    expect(san.result.execution.error).toBe('unexpected end-of-file (at offset 0x0)');
    expect(sub.result.status).toBe(1);
    expect(decodeSimulateData(dataHex(sub), selector)).toBeNull();
  });
});

describe('alkanes_simulate wire format (pins the JSON-RPC response shape)', () => {

  it('every fixture is JSON-RPC 2.0 with result.execution.data at the canonical path', () => {
    const alkanes = ['2_0_diesel', '2_100_fartune100', '2_1000_alkane_pandas_342', '999999_999999_unknown'];
    const labels  = ['99_name', '100_symbol', '101_total_supply'];
    const endpoints: ('subfrost' | 'sandshrew')[] = ['subfrost', 'sandshrew'];

    for (const a of alkanes) {
      for (const l of labels) {
        for (const e of endpoints) {
          const f = loadFixture(a, l, e);
          expect(f.jsonrpc).toBe('2.0');
          expect(f.id).toBe(1);
          expect(typeof f.result.execution.data).toBe('string');
          expect(f.result.execution.data.startsWith('0x')).toBe(true);
        }
      }
    }
  });
});
