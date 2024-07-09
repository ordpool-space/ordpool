import { beforeEach, describe, expect, it } from '@jest/globals';

import { NumberSuffixPipe } from './number-suffix.pipe';

describe('NumberSuffixPipe', () => {
  let pipe: NumberSuffixPipe;

  beforeEach(() => {
    pipe = new NumberSuffixPipe();
  });

  it('should return "1st" for the number 1', () => {
    expect(pipe.transform(1)).toBe('1st');
  });

  it('should return "2nd" for the number 2', () => {
    expect(pipe.transform(2)).toBe('2nd');
  });

  it('should return "3rd" for the number 3', () => {
    expect(pipe.transform(3)).toBe('3rd');
  });

  it('should return "4th" for the number 4', () => {
    expect(pipe.transform(4)).toBe('4th');
  });

  it('should return "11th" for the number 11', () => {
    expect(pipe.transform(11)).toBe('11th');
  });

  it('should return "21st" for the number 21', () => {
    expect(pipe.transform(21)).toBe('21st');
  });

  it('should return "22nd" for the number 22', () => {
    expect(pipe.transform(22)).toBe('22nd');
  });

  it('should return "23rd" for the number 23', () => {
    expect(pipe.transform(23)).toBe('23rd');
  });

  it('should return "100th" for the number 100', () => {
    expect(pipe.transform(100)).toBe('100th');
  });

  it('should return "101st" for the number 101', () => {
    expect(pipe.transform(101)).toBe('101st');
  });

  it('should return "102nd" for the number 102', () => {
    expect(pipe.transform(102)).toBe('102nd');
  });

  it('should return "103rd" for the number 103', () => {
    expect(pipe.transform(103)).toBe('103rd');
  });

  it('should return "104th" for the number 104', () => {
    expect(pipe.transform(104)).toBe('104th');
  });

  it('should handle non-integer values gracefully', () => {
    expect(pipe.transform(1.5)).toBe('1.5');
    expect(pipe.transform(-1.5)).toBe('-1.5');
  });

  it('should return "100th" for the bigint 100n', () => {
    expect(pipe.transform(100n)).toBe('100th');
  });

  it('should return "101st" for the bigint 101n', () => {
    expect(pipe.transform(101n)).toBe('101st');
  });

  it('should return "102nd" for the bigint 102n', () => {
    expect(pipe.transform(102n)).toBe('102nd');
  });

  it('should return "103rd" for the bigint 103n', () => {
    expect(pipe.transform(103n)).toBe('103rd');
  });

  it('should return "104th" for the bigint 104n', () => {
    expect(pipe.transform(104n)).toBe('104th');
  });
});
