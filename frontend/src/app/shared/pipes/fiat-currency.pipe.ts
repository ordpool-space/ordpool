import { formatCurrency, getCurrencySymbol } from '@angular/common';
import { Inject, LOCALE_ID, Pipe, PipeTransform } from '@angular/core';
import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';

@Pipe({
  name: 'fiatCurrency',
  standalone: false,
})
export class FiatCurrencyPipe implements PipeTransform {
  fiatSubscription: Subscription;
  currency: string;

  constructor(
    @Inject(LOCALE_ID) public locale: string,
    private stateService: StateService,
  ) {
    this.fiatSubscription = this.stateService.fiatCurrency$.subscribe((fiat) => {
      this.currency = fiat;
    });
  }

  transform(num: number, ...args: any[]): unknown {
    const digitsInfo = args[0];
    const currency = args[1] || this.currency || 'USD';

    const options: Intl.NumberFormatOptions = { style: 'currency', currency };

    if (digitsInfo) {
      const match = digitsInfo.match(/^(\d+)\.(\d+)-(\d+)$/);
      if (match) {
        const minFrac = parseInt(match[2], 10);
        const maxFrac = parseInt(match[3], 10);
        const currencyMaxFrac =
          new Intl.NumberFormat(this.locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ??
          Number.POSITIVE_INFINITY;
        options.minimumFractionDigits = Math.min(minFrac, currencyMaxFrac);
        options.maximumFractionDigits = Math.min(maxFrac, currencyMaxFrac);
      }
    }

    return new Intl.NumberFormat(this.locale, options).format(num);
  }
}
