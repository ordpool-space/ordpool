import { BigIntFormatterPipe } from './big-int-formatter.pipe';

describe('BigIntFormatterPipe', () => {
  let pipe: BigIntFormatterPipe;

  beforeEach(() => {
    pipe = new BigIntFormatterPipe();
  });

  it('should create an instance', () => {
    expect(pipe).toBeTruthy();
  });

  it('should format bigint values according to the default locale (en-US)', () => {
    expect(pipe.transform(123456789012345678901234567890n)).toBe('123,456,789,012,345,678,901,234,567,890');
  });

  it('should format bigint values according to the specified locale (en-US)', () => {
    expect(pipe.transform(123456789012345678901234567890n, 'en-US')).toBe('123,456,789,012,345,678,901,234,567,890');
  });

  it('should format bigint values according to the specified locale (de-DE)', () => {
    expect(pipe.transform(123456789012345678901234567890n, 'de-DE')).toBe('123.456.789.012.345.678.901.234.567.890');
  });

  it('should format small bigint values according to the specified locale (en-US)', () => {
    expect(pipe.transform(1234567890n, 'en-US')).toBe('1,234,567,890');
  });

  it('should format small bigint values according to the specified locale (de-DE)', () => {
    expect(pipe.transform(1234567890n, 'de-DE')).toBe('1.234.567.890');
  });
});
