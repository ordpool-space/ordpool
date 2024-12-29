import { parseActivity, parseAttempts } from './OrdpoolBlocksRepository.helper';

describe('parseActivity', () => {
  it('should parse a compact activity string into a key-value map', () => {
    const data = '840686:2338,1,876937:1691,3113';
    const result = parseActivity(data);
    expect(result).toEqual({
      '840686:2338': 1,
      '876937:1691': 3113,
    });
  });

  it('should handle an empty string gracefully', () => {
    const data = '';
    const result = parseActivity(data);
    expect(result).toEqual({});
  });

  it('should handle null input gracefully', () => {
    const result = parseActivity(null);
    expect(result).toEqual({});
  });

  it('should ignore malformed input and return an empty object', () => {
    const data = 'invalid,data';
    expect(() => parseActivity(data)).not.toThrow();
  });
});

describe('parseAttempts', () => {
  it('should parse a compact attempts string into a key-to-array map', () => {
    const data = '840686:2338,txid1,876937:1691,txid2';
    const result = parseAttempts(data);
    expect(result).toEqual({
      '840686:2338': ['txid1'],
      '876937:1691': ['txid2'],
    });
  });

  it('should handle multiple values for the same key', () => {
    const data = '840686:2338,txid1,840686:2338,txid2';
    const result = parseAttempts(data);
    expect(result).toEqual({
      '840686:2338': ['txid1', 'txid2'],
    });
  });

  it('should handle an empty string gracefully', () => {
    const data = '';
    const result = parseAttempts(data);
    expect(result).toEqual({});
  });

  it('should handle null input gracefully', () => {
    const result = parseAttempts(null);
    expect(result).toEqual({});
  });

  it('should ignore malformed input and return an empty object', () => {
    const data = 'invalid,data';
    expect(() => parseAttempts(data)).not.toThrow();
  });
});
