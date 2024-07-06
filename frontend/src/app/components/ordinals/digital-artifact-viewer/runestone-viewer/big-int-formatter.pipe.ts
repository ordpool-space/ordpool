import { Pipe, PipeTransform } from '@angular/core';

@Pipe({name: 'bigIntFormatter'})
export class BigIntFormatterPipe implements PipeTransform {
  transform(value: bigint, locale: string = 'en-US'): string {
    return value.toLocaleString(locale);
  }
}
