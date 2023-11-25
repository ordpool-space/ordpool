import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Observable, of, retry, take, tap } from 'rxjs';

import { Transaction } from '../../../interfaces/electrs.interface';
import { KnownOrdinalWalletType, WalletInfo, WalletService } from '../../../services/ordinals/wallet.service';
import { StateService } from '../../../services/state.service';
import { InscriptionAcceleratorApiService } from '../../../services/ordinals/inscription-accelerator-api.service';


@Component({
  selector: 'app-inscription-accelerator',
  templateUrl: './inscription-accelerator.component.html',
  styleUrls: ['./inscription-accelerator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InscriptionAcceleratorComponent {

  walletService = inject(WalletService);
  inscriptionAcceleratorApi = inject(InscriptionAcceleratorApiService);
  cd = inject(ChangeDetectorRef);

  recommendedFees$ = inject(StateService).recommendedFees$;
  connectedWallet$ = this.walletService.connectedWallet$;
  broadcastPsbt$: Observable<any> = of(undefined);

  broadcastPsbtLoading = false;
  broadcastPsbtSuccess = false;
  broadcastPsbtError = '';

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

  accelerateInscription(walletInfo: WalletInfo) {

    this.broadcastPsbtLoading = true;
    this.broadcastPsbtSuccess = false;
    this.broadcastPsbtError = '';

    const cpfpRequest = {
      utxos: [this.tx?.txid + ':0'],
      feeRate: this.c.feeRate.value,

      buyerOrdinalAddress: walletInfo.ordinalsAddress,
      buyerOrdinalPublicKey: walletInfo.ordinalsPublicKey,

      buyerPaymentAddress: walletInfo.paymentAddress,
      buyerPaymentPublicKey: walletInfo.paymentPublicKey,
    };

    this.inscriptionAcceleratorApi.requestSignPsbtAndBroadcast(cpfpRequest).pipe(
      tap(() => this.broadcastPsbtLoading = false)
    ).subscribe({
      next: () => this.broadcastPsbtSuccess = true,
      error: (err: Error) => this.broadcastPsbtError = err.message
    });
  }
}
