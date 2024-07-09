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
});

