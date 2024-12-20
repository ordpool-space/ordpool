import { getSqlInterval } from './get-sql-interval';
import { Interval } from './ordpool-statistics-interface';

describe('getSqlInterval', () => {
  const validIntervals: { input: Interval; expected: string }[] = [
    // Hourly intervals
    { input: '1h', expected: '1 HOUR' },
    { input: '2h', expected: '2 HOUR' },
    { input: '6h', expected: '6 HOUR' },
    { input: '12h', expected: '12 HOUR' },
    { input: '24h', expected: '24 HOUR' },
    // Daily intervals
    { input: '1d', expected: '1 DAY' },
    { input: '3d', expected: '3 DAY' },
    { input: '7d', expected: '7 DAY' },
    // Weekly intervals
    { input: '1w', expected: '1 WEEK' },
    { input: '2w', expected: '2 WEEK' },
    { input: '3w', expected: '3 WEEK' },
    // Monthly intervals
    { input: '1m', expected: '1 MONTH' },
    { input: '3m', expected: '3 MONTH' },
    { input: '6m', expected: '6 MONTH' },
    // Yearly intervals
    { input: '1y', expected: '1 YEAR' },
    { input: '2y', expected: '2 YEAR' },
    { input: '3y', expected: '3 YEAR' },
    { input: '4y', expected: '4 YEAR' },
  ];

  test.each(validIntervals)('returns correct SQL interval for %s', ({ input, expected }) => {
    const result = getSqlInterval(input);
    expect(result).toBe(expected);
  });

  test('throws an error for invalid interval formats', () => {
    const invalidCases = ['1hour', 'xyz', 'h1', '1', '', null, undefined];

    invalidCases.forEach((input) => {
      expect(() => getSqlInterval(input as any)).toThrowError(`Invalid interval: ${input}`);
    });
  });

  test('handles edge cases gracefully', () => {
    const edgeCases: { input: string | null; expected: string | null }[] = [
      { input: '0h', expected: '0 HOUR' },
      { input: '0d', expected: '0 DAY' },
      { input: '0m', expected: '0 MONTH' },
      { input: '0y', expected: '0 YEAR' }
    ];
    edgeCases.forEach(({ input, expected }) => {
      const result = getSqlInterval(input as Interval);
      expect(result).toBe(expected);
    });
  });

  test('handles unexpected inputs gracefully', () => {
    const unexpectedInputs = ['999h', '999d', '1000w', '1234m', '5678y'];
    unexpectedInputs.forEach((interval) => {
      const result = getSqlInterval(interval as Interval);
      expect(result).toMatch(/^\d+ (HOUR|DAY|WEEK|MONTH|YEAR)$/);
    });
  });
});
