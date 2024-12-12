import { Pipe, PipeTransform } from '@angular/core';

/**
 * A pipe that transforms the first letter of a string to uppercase.
 * It leaves the rest of the string unchanged.
 */
@Pipe({
  name: 'capitalizeFirst',
  standalone: true
})
export class CapitalizeFirstPipe implements PipeTransform {

  /**
   * Transforms the input string by capitalizing its first letter.
   * @param value The string to be transformed.
   * @returns The transformed string with the first letter in uppercase. If the input is falsy, it returns the input as is.
   */
  transform(value: string): string {
    if (!value) return value;

    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
