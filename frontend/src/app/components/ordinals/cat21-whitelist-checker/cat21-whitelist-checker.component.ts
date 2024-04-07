import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { catchError, of, retry, switchMap, tap } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { Cat21ApiService } from '../../../services/ordinals/cat21-api.service';
import { Cat21Service } from '../../../services/ordinals/cat21.service';
import { WalletService } from '../../../services/ordinals/wallet.service';
import { KnownOrdinalWalletType } from '../../../services/ordinals/wallet.service.types';
import { SeoService } from '../../../services/seo.service';
import { extractErrorMessage } from '../inscription-accelerator/extract-error-message';


@Component({
  selector: 'app-cat21-whitelist-checker',
  templateUrl: './cat21-whitelist-checker.component.html',
  styleUrls: ['./cat21-whitelist-checker.component.scss'],
  // changeDetection: ChangeDetectionStrategy.OnPush
})
export class Cat21WhitelistCheckerComponent implements OnInit {

  enableCat21Mint = environment.enableCat21Mint;

  unisatShowWarningThreshold = 10 * 1000;

  walletService = inject(WalletService);
  cat21Service = inject(Cat21Service);
  cat21ApiService = inject(Cat21ApiService);
  cd = inject(ChangeDetectorRef);

  seoService = inject(SeoService);
  connectedWallet$ = this.walletService.connectedWallet$;

  checkerLoading = false;
  checkerError = '';

  whitelistStatus$ = this.connectedWallet$.pipe(
    tap(() => {
      this.checkerLoading = true;
      this.checkerError = '';
    }),
    switchMap(wallet => this.cat21ApiService.getWhitelistStatus(wallet.ordinalsAddress).pipe(
      tap(() => {
        this.checkerLoading = false;
        this.checkerError = '';
      }),
      catchError(error => {
        this.checkerLoading = false;
        this.checkerError = error ? extractErrorMessage(error) : '';
        return of(undefined);
      })
    )));

  KnownOrdinalWalletType = KnownOrdinalWalletType;

  ngOnInit() {
    this.seoService.setTitle('CAT-21: Whitelist Checker');
    this.seoService.setDescription('Confirm Your Whitelist Status for the awesome CAT-21 ordinals mint!');
  }
}
