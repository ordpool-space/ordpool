import { DivisibilityPipe } from './divisibility-pipe';

describe('DivisibilityPipe', () => {
  let pipe: DivisibilityPipe;

  beforeEach(() => {
    pipe = new DivisibilityPipe();
  });

  it('should handle divisibility 0 correctly', () => {
    expect(pipe.transform(12345, 0)).toBe('12,345');
  });

  it('should handle divisibility 1 correctly', () => {
    expect(pipe.transform(98765, 1)).toBe('9,876.5');
  });

  it('should handle divisibility 2 correctly', () => {
    expect(pipe.transform(12345, 2)).toBe('123.45');
  });

  it('should handle divisibility 3 correctly', () => {
    expect(pipe.transform(98765, 3)).toBe('98.765');
  });

  it('should handle non-integer numbers gracefully', () => {
    expect(pipe.transform(123.45, 2)).toBe('123.45');
  });

  it('should handle bigint values correctly', () => {
    expect(pipe.transform(123456789012345678901234567890n, 2)).toBe('1,234,567,890,123,456,789,012,345,678.90');
  });

  it('should handle divisibility greater than the number length correctly', () => {
    expect(pipe.transform(123, 5)).toBe('0.00123');
  });

  it('should format according to the specified locale', () => {
    expect(pipe.transform(98765, 1, 'de-DE')).toBe('9.876,5');
  });

  it('should not display decimal part if it is zero', () => {
    expect(pipe.transform(10000, 2, 'en-US')).toBe('100');
    expect(pipe.transform(10000n, 2, 'en-US')).toBe('100');
  });

  // Regression: BigInt(10 ** divisibility) evaluated 10 ** d as a JS double,
  // which is only exact to d = 22. The runes protocol allows divisibility up to
  // 38, so d >= 23 produced a wrong divisor (e.g. 10 ** 23 rounded to
  // 99999999999999991611392) and misplaced the decimal point. 10n ** BigInt(d)
  // keeps the divisor exact for every valid divisibility.
  it('should keep the divisor exact for divisibility 23 (10^23 renders as 1, not a spurious fraction)', () => {
    expect(pipe.transform(10n ** 23n, 23)).toBe('1');
  });

  it('should format the fractional part correctly at the maximum divisibility 38', () => {
    // 10^38 + 5 => integer part 1, fractional part 5 padded to 38 digits.
    expect(pipe.transform(10n ** 38n + 5n, 38, 'en-US')).toBe('1.' + '0'.repeat(37) + '5');
  });
});

