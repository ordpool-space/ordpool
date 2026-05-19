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

// Independent reference decoder. Splits the 16-byte payload into two u64s
// via Buffer.readBigUInt64LE (Node stdlib, separately implemented from the
// hand-rolled BigInt loop in production code) and recombines them. Used to
// verify totalSupply assertions without baking hand-computed numbers into
// the test — the values float as fixtures get refetched.
function referenceDecodeU128LE(hex: string): bigint {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  const buf = Buffer.alloc(16);
  Buffer.from(stripped, 'hex').copy(buf, 0, 0, Math.min(16, stripped.length / 2));
  const low  = buf.readBigUInt64LE(0);
  const high = buf.readBigUInt64LE(8);
  return (high << 64n) | low;
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

// Fixture-driven tests. Names and symbols are immutable contract state,
// asserted as exact literals. totalSupply is asserted against the
// reference decoder above — that way mint activity between refetches
// doesn't break tests. Cross-endpoint byte equality is checked for
// every selector (subfrost vs sandshrew must return identical bytes).

const FIXTURES: { dir: string; name: string; symbol: string; cross_check_url: string }[] = [
  {
    dir: '2_0_diesel',
    name: 'DIESEL',
    symbol: 'DIESEL',
    cross_check_url: 'https://ordiscan.com/alkane/2:0',
  },
  {
    dir: '2_50_alker',
    name: 'ALKer',
    symbol: 'R',
    cross_check_url: 'https://ordiscan.com/alkane/2:50',
  },
  {
    dir: '2_100_fartune100',
    name: 'FARTUNE100',
    symbol: 'F100',
    cross_check_url: 'https://ordiscan.com/alkane/2:100',
  },
  {
    dir: '2_200_hydrogen',
    name: 'HYDROGEN',
    symbol: 'H',
    cross_check_url: 'https://ordiscan.com/alkane/2:200',
  },
  {
    dir: '2_1000_alkane_pandas_342',
    name: 'Alkane Pandas #342',
    symbol: 'alkane-pandas-342',
    cross_check_url: 'https://ordiscan.com/alkane/2:1000',
  },
];

describe.each(FIXTURES)('real on-chain alkane $dir', ({ dir, name, symbol }) => {

  it(`decodes name() = "${name}" from both endpoints`, () => {
    const sub = loadFixture(dir, '99_name', 'subfrost');
    const san = loadFixture(dir, '99_name', 'sandshrew');
    expect(dataHex(san)).toBe(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_NAME)).toBe(name);
  });

  it(`decodes symbol() = "${symbol}" from both endpoints`, () => {
    const sub = loadFixture(dir, '100_symbol', 'subfrost');
    const san = loadFixture(dir, '100_symbol', 'sandshrew');
    expect(dataHex(san)).toBe(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_SYMBOL)).toBe(symbol);
  });

  it('decodes totalSupply() matching an independent stdlib u128 LE decoder', () => {
    const sub = loadFixture(dir, '101_total_supply', 'subfrost');
    const san = loadFixture(dir, '101_total_supply', 'sandshrew');
    expect(dataHex(san)).toBe(dataHex(sub));
    const expected = referenceDecodeU128LE(dataHex(sub));
    expect(decodeSimulateData(dataHex(sub), SELECTOR_TOTAL_SUPPLY)).toBe(expected);
    expect(expected).toBeGreaterThan(0n);
  });
});

describe('non-existent alkane (negative-cache path)', () => {

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
    const dirs = [...FIXTURES.map((f) => f.dir), '999999_999999_unknown'];
    const labels = ['99_name', '100_symbol', '101_total_supply'];
    const endpoints: ('subfrost' | 'sandshrew')[] = ['subfrost', 'sandshrew'];

    for (const d of dirs) {
      for (const l of labels) {
        for (const e of endpoints) {
          const f = loadFixture(d, l, e);
          expect(f.jsonrpc).toBe('2.0');
          expect(f.id).toBe(1);
          expect(typeof f.result.execution.data).toBe('string');
          expect(f.result.execution.data.startsWith('0x')).toBe(true);
        }
      }
    }
  });
});

describe('reference decoder sanity', () => {

  it('matches known fixed-width little-endian values', () => {
    expect(referenceDecodeU128LE('0x01000000000000000000000000000000')).toBe(1n);
    expect(referenceDecodeU128LE('0x00000000000000000100000000000000')).toBe(1n << 64n);
    expect(referenceDecodeU128LE('0xffffffffffffffff0000000000000000')).toBe((1n << 64n) - 1n);
    expect(referenceDecodeU128LE('0x00000000000000000000000000000000')).toBe(0n);
  });
});
