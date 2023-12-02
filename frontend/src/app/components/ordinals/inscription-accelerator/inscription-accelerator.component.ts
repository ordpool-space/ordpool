import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Observable, of, take } from 'rxjs';

import { Transaction } from '../../../interfaces/electrs.interface';
import { InscriptionAcceleratorApiService } from '../../../services/ordinals/inscription-accelerator-api.service';
import { KnownOrdinalWalletType, WalletInfo, WalletService } from '../../../services/ordinals/wallet.service';
import { StateService } from '../../../services/state.service';


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
  isMainnet$ = this.walletService.isMainnet$;

  recommendedFees$ = inject(StateService).recommendedFees$;
  connectedWallet$ = this.walletService.connectedWallet$;
  broadcastPsbt$: Observable<any> = of(undefined);

  broadcastPsbtLoading = false;
  broadcastPsbtSuccess?: { txId: string } = undefined;
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

  accelerateInscription(walletInfo: WalletInfo): void {

    this.broadcastPsbtLoading = true;
    this.broadcastPsbtSuccess = undefined;
    this.broadcastPsbtError = '';

    const cpfpRequest = {
      // TODO: research!
      // my big assumption is the fact that the inscription is always sitting on Output #0
      utxos: [this.tx?.txid + ':0'],
      feeRate: this.c.feeRate.value,

      buyerOrdinalAddress: walletInfo.ordinalsAddress,
      buyerOrdinalPublicKey: walletInfo.ordinalsPublicKey,

      buyerPaymentAddress: walletInfo.paymentAddress,
      buyerPaymentPublicKey: walletInfo.paymentPublicKey,
    };

    this.inscriptionAcceleratorApi.signPsbtAndBroadcast(walletInfo.type, cpfpRequest).subscribe({
      next: (result) => {

        this.broadcastPsbtSuccess = result,
        this.broadcastPsbtLoading = false;
      },
      error: (err: Error) => {
        this.broadcastPsbtError = err.message;
        this.broadcastPsbtLoading = false;
      }
    });
  }
}
