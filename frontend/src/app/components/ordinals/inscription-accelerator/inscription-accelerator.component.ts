import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { take } from 'rxjs';

import { Transaction } from '../../../interfaces/electrs.interface';
import { KnownOrdinalWalletType, WalletService } from '../../../services/ordinals/wallet.service';
import { StateService } from '../../../services/state.service';


@Component({
  selector: 'app-inscription-accelerator',
  templateUrl: './inscription-accelerator.component.html',
  styleUrls: ['./inscription-accelerator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InscriptionAcceleratorComponent {

  walletService = inject(WalletService);
  recommendedFees$ = inject(StateService).recommendedFees$;
  connectedWallet$ = this.walletService.connectedWallet$;

  KnownOrdinalWalletType = KnownOrdinalWalletType;

  @Input({ required: true }) tx?: Transaction;

  form = new FormGroup({
    feeRate: new FormControl(0, {
      validators: Validators.required,
      nonNullable: true
    })
  });

  c = this.form.controls;

  constructor() {
    this.recommendedFees$.pipe(take(1))
      .subscribe(({ fastestFee }) => this.form.patchValue({ feeRate: fastestFee }));
  }

  setFeeRate(feeRate: number): void {
    this.form.patchValue({ feeRate });
  }
}
