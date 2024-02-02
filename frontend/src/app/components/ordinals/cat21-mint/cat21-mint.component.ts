import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { take } from 'rxjs';

import { Cat21Service } from '../../../services/ordinals/cat21.service';
import { KnownOrdinalWalletType, WalletInfo, WalletService } from '../../../services/ordinals/wallet.service';
import { StateService } from '../../../services/state.service';
import { fullNumberValidator } from '../full-number.validator';
import { extractErrorMessage } from '../inscription-accelerator/extract-error-message';

@Component({
  selector: 'app-cat21-mint',
  templateUrl: './cat21-mint.component.html',
  styleUrls: ['./cat21-mint.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Cat21MintComponent implements OnInit {

  walletService = inject(WalletService);
  cat21Service = inject(Cat21Service);
  cd = inject(ChangeDetectorRef);

  recommendedFees$ = inject(StateService).recommendedFees$;
  connectedWallet$ = this.walletService.connectedWallet$;

  minRequiredFee: number  = 0;

  mintCat21Loading = false;
  mintCat21Success?: { txId: string } = undefined;
  mintCat21Error = '';

  KnownOrdinalWalletType = KnownOrdinalWalletType;

  form = new FormGroup({
    // TODO
    catRecipient: new FormControl(0, {
      validators: [Validators.required],
      nonNullable: true
    }),
    feeRate: new FormControl(0, {
      validators: [Validators.required, Validators.min(1)],
      nonNullable: true
    })
  });

  cfeeRate = this.form.controls.feeRate;

  ngOnInit(): void {
    this.recommendedFees$.pipe(take(1))
      .subscribe(({ fastestFee, hourFee }) => {

        this.updateMinRequiredFee(hourFee);

        if (fastestFee > this.minRequiredFee) {
          this.cfeeRate.setValue(fastestFee);
        }

        this.cd.detectChanges();
      });
  }

  private updateMinRequiredFee(hourFee: number) {

    this.minRequiredFee = hourFee;

    this.cfeeRate.setValidators([
      Validators.required,
      Validators.min(this.minRequiredFee),
      fullNumberValidator()
    ]);

    if (this.cfeeRate.value < this.minRequiredFee) {
      this.cfeeRate.setValue(this.minRequiredFee);
    }

    this.cfeeRate.updateValueAndValidity();
  }

  setFeeRate(feeRate: number): void {
    this.form.patchValue({ feeRate });
  }

  mintCat21(walletInfo: WalletInfo): void {

    this.mintCat21Loading = true;
    this.mintCat21Success = undefined;
    this.mintCat21Error = '';

    this.cat21Service.createCat21Transaction(
      walletInfo.type,
      walletInfo.ordinalsAddress,
      walletInfo.paymentAddress,
      walletInfo.paymentPublicKey).subscribe({
        next: (result) => {
          this.mintCat21Loading = false;
          this.mintCat21Success = result,
          this.cd.detectChanges();
        },
        error: (err: Error) => {
          this.mintCat21Loading = false;
          this.mintCat21Error = extractErrorMessage(err);
          this.cd.detectChanges();
        }
      });
  }
}
