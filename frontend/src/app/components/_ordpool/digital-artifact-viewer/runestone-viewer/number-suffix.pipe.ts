import { Pipe, PipeTransform } from '@angular/core';

/**
 * Transforms a given number or bigint into its corresponding ordinal form. 
 *
 * Example usage:
 *   {{ 1 | numberSuffix }}  => "1st"
 *   {{ 2 | numberSuffix }}  => "2nd"
 *   {{ 3 | numberSuffix }}  => "3rd"
 *   {{ 4 | numberSuffix }}  => "4th"
 *   {{ 21 | numberSuffix }} => "21st"
 */
@Pipe({
  name: 'numberSuffix'
})
export class NumberSuffixPipe implements PipeTransform {

  /**
   * Transforms a given number or bigint into its corresponding ordinal form.
   * 
   * @param value - The number to be transformed.
   * @returns The ordinal form of the given number or bigint.
   */
  transform(value: number | bigint): string {

    // completely wrong type
    if (typeof value !== 'number' && typeof value !== 'bigint') {
      return value + '';
    }

    // number, but has a decimal point
    if (typeof value === 'number' && !Number.isInteger(value)) {
      return value.toString();
    }

    const suffixes = ['th', 'st', 'nd', 'rd'];
    const num = BigInt(value);
    const v = num % 100n;
    const suffixIndex = (v > 3n && v < 21n) ? 0 : Number((num % 10n) === 0n ? 0 : (num % 10n));
    const suffix = suffixes[suffixIndex] || suffixes[0];
    return `${num}${suffix}`;
  }
}
