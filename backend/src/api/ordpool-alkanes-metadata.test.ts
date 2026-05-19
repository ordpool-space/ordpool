import { decodeSimulateData } from './ordpool-alkanes-metadata';

const SELECTOR_NAME = 99;
const SELECTOR_SYMBOL = 100;
const SELECTOR_TOTAL_SUPPLY = 101;

describe('decodeSimulateData', () => {

  // Real on-chain response for alkanes_simulate(target=2:0, inputs=[99])
  // against https://mainnet.subfrost.io/v4/jsonrpc on 2026-05-19.
  it('decodes DIESEL name from real response', () => {
    expect(decodeSimulateData('0x44494553454c', SELECTOR_NAME)).toBe('DIESEL');
  });

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

  it('decodes a u128 total_supply as little-endian bigint', () => {
    // 0x0100000000000000 LE = 1
    expect(decodeSimulateData('0x0100000000000000', SELECTOR_TOTAL_SUPPLY)).toBe(1n);
    // 0xff000000... = 255
    expect(decodeSimulateData('0xff00000000000000', SELECTOR_TOTAL_SUPPLY)).toBe(255n);
    // 0x0001000000... = 256
    expect(decodeSimulateData('0x0001000000000000', SELECTOR_TOTAL_SUPPLY)).toBe(256n);
  });
});
