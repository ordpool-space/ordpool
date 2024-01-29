import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';

import { StateService } from '../../../services/state.service';
import { KnownOrdinalWalletType, WalletInfo, WalletService } from '../../../services/ordinals/wallet.service';
import { take } from 'rxjs';
import { extractErrorMessage } from '../inscription-accelerator/extract-error-message';

@Component({
  selector: 'app-cat21-mint',
  templateUrl: './cat21-mint.component.html',
  styleUrls: ['./cat21-mint.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Cat21MintComponent implements OnInit {

  walletService = inject(WalletService);
  cd = inject(ChangeDetectorRef);

  recommendedFees$ = inject(StateService).recommendedFees$;
  connectedWallet$ = this.walletService.connectedWallet$;

  mintCat21Loading = false;
  mintCat21Success?: { txId: string } = undefined;
  mintCat21Error = '';

  KnownOrdinalWalletType = KnownOrdinalWalletType;

  form = new FormGroup({
    catRecipient: new FormControl(0, {
      validators: [Validators.required],
      nonNullable: true
    }),
    feeRate: new FormControl(0, {
      validators: [Validators.required, Validators.min(1)],
      nonNullable: true
    })
  });

  c = this.form.controls;
  ngOnInit(): void {
    this.recommendedFees$.pipe(take(1))
      .subscribe(({ fastestFee }) => {
        this.form.patchValue({ feeRate: fastestFee });
        this.cd.detectChanges();
      });
  }

  setFeeRate(feeRate: number): void {
    this.form.patchValue({ feeRate });
  }

  mintCat21(walletInfo: WalletInfo): void {

    this.mintCat21Loading = true;
    this.mintCat21Success = undefined;
    this.mintCat21Error = '';





    // this.inscriptionAcceleratorApi.signPsbtAndBroadcast(walletInfo.type, cpfpRequest).subscribe({
    //   next: (result) => {

    //     this.mintCat21Success = result,
    //     this.mintCat21Loading = false;
    //     this.cd.detectChanges();
    //   },
    //   error: (err: Error) => {
    //     this.mintCat21Error = extractErrorMessage(err);
    //     this.mintCat21Loading = false;
    //     this.cd.detectChanges();
    //   }
    // });
  }
}
