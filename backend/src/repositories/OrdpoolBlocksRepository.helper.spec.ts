import { parseKeyValueMap, parseKeyToArrayMap } from './OrdpoolBlocksRepository.helper';

describe('parseKeyValueMap', () => {
  it('should parse a valid JSON string into a key-value map', () => {
    const jsonString = '{"identifier": "foo", "count": 42},{"identifier": "bar", "count": 7}';
    const result = parseKeyValueMap<number>(jsonString, 'identifier', 'count');
    expect(result).toEqual({ foo: 42, bar: 7 });
  });

  it('should return an empty object for null input', () => {
    const result = parseKeyValueMap<number>(null, 'identifier', 'count');
    expect(result).toEqual({});
  });

  it('should ignore invalid items', () => {
    const jsonString = '{"identifier": "valid", "count": 123},{"invalid": true}';
    const result = parseKeyValueMap<number>(jsonString, 'identifier', 'count');
    expect(result).toEqual({ valid: 123 });
  });
});

describe('parseKeyToArrayMap', () => {
  it('should parse a valid JSON string into a key-to-array map', () => {
    const jsonString = '{"identifier": "foo", "txid": "txid1"},{"identifier": "foo", "txid": "txid2"},{"identifier": "bar", "txid": "txid3"}';
    const result = parseKeyToArrayMap<string>(jsonString, 'identifier', 'txid');
    expect(result).toEqual({ foo: ['txid1', 'txid2'], bar: ['txid3'] });
  });

  it('should return an empty object for null input', () => {
    const result = parseKeyToArrayMap<string>(null, 'identifier', 'txid');
    expect(result).toEqual({});
  });

  it('should ignore invalid items', () => {
    const jsonString = '{"identifier": "valid", "txid": "txid1"},{"invalid": true}';
    const result = parseKeyToArrayMap<string>(jsonString, 'identifier', 'txid');
    expect(result).toEqual({ valid: ['txid1'] });
  });
});
