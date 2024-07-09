import { Pipe, PipeTransform } from '@angular/core';

/**
 * Pipe to adjust a number based on the divisibility rule and format the result according to locale.
 *
 * Example usage:
 *   {{ 12345 | divisibility:2:'en-US' }} => "123.45"
 *   {{ 98765 | divisibility:1:'de-DE' }} => "9.876,5"
 */
@Pipe({
  name: 'divisibility'
})
export class DivisibilityPipe implements PipeTransform {

  /**
   * Transforms a given number based on the divisibility value and formats the result.
   *
   * @param value - The number to be adjusted.
   * @param divisibility - The divisibility factor.
   * @param locale - The locale for formatting.
   * @returns The adjusted and formatted number as a string.
   */
  transform(value: number | bigint, divisibility: number, locale: string = 'en-US'): string {

    // completely wrong type
    if (typeof value !== 'number' && typeof value !== 'bigint') {
      return value + '';
    }
        
    // number, but has a decimal point
    if (typeof value === 'number' && !Number.isInteger(value)) {
      return value.toString();
    }

    const num = BigInt(value);
    const divisor = BigInt(10 ** divisibility);
    const integerPart = num / divisor;
    const fractionalPart = num % divisor;

    // Format the integer part with locale
    const integerStr = integerPart.toLocaleString(locale);
    
    // exit if there are no decimals
    if (fractionalPart === BigInt(0)) {
      return integerStr;
    }

    // Format the fractional part
    const fractionalStr = fractionalPart.toString().padStart(divisibility, '0');

    // Get the locale-specific decimal separator
    const decimalSeparator = new Intl.NumberFormat(locale).format(1.1).charAt(1);

    // Concatenate the integer and fractional parts with the correct decimal separator
    return `${integerStr}${decimalSeparator}${fractionalStr}`;
  }
}
