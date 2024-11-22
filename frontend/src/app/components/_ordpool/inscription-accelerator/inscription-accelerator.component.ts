import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { DigitalArtifact, DigitalArtifactType, ParsedInscription } from 'ordpool-parser';
import { map, Observable, take } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { Transaction } from '../../../interfaces/electrs.interface';
import {
  InscriptionAcceleration,
  InscriptionAcceleratorApiService,
} from '../../../services/ordinals/inscription-accelerator-api.service';
import { WalletService } from '../../../services/ordinals/wallet.service';
import { KnownOrdinalWalletType, WalletInfo } from '../../../services/ordinals/wallet.service.types';
import { StateService } from '../../../services/state.service';
import { fullNumberValidator } from '../full-number.validator';
import { extractErrorMessage } from './extract-error-message';


@Component({
  selector: 'app-inscription-accelerator',
  templateUrl: './inscription-accelerator.component.html',
  styleUrls: ['./inscription-accelerator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InscriptionAcceleratorComponent implements OnInit {

  enableInscriptionAccelerator = environment.enableInscriptionAccelerator;

  walletService = inject(WalletService);
  inscriptionAcceleratorApi = inject(InscriptionAcceleratorApiService);
  cd = inject(ChangeDetectorRef);

  recommendedFees$ = inject(StateService).recommendedFees$;
  connectedWallet$ = this.walletService.connectedWallet$;

  thisTxWasAccelerated$?: Observable<InscriptionAcceleration> = undefined;
  thisTxIsAccelerator$?: Observable<InscriptionAcceleration> = undefined;

  broadcastPsbtLoading = false;
  broadcastPsbtSuccess?: { txId: string } = undefined;
  broadcastPsbtError = '';

  KnownOrdinalWalletType = KnownOrdinalWalletType;

  hourFee: number = 0;
  minRequiredFee: number  = 0;
  currentFeePerVsize: number = 0;

  private _tx?: Transaction;
  public get tx(): Transaction {
    return this._tx;
  }


  // tx is always set (*ngIf wrapping this component)
  @Input({ required: true })
  public set tx(value: Transaction) {
    this._tx = value;

    this.thisTxWasAccelerated$ = this.inscriptionAcceleratorApi.allAccelerations$.pipe(
      map(acceration => acceration.reverse().find(a => a.acceleratedTxId === this._tx.txid))
    );

    this.thisTxIsAccelerator$ = this.inscriptionAcceleratorApi.allAccelerations$.pipe(
      map(acceration => acceration.reverse().find(a => a.txId === this._tx.txid))
    );

    this.currentFeePerVsize = this.tx.feePerVsize;
    this.updateMinRequiredFee();
  }

  // effectiveFeePerVsize is updated later on
  // see transaction.component.ts
  // --> this.fetchCpfpSubscription --> this.setCpfpInfo(cpfpInfo)
  @Input({ required: true })
  public set hasEffectiveFeeRate(hasRate: boolean) {

    if (hasRate) {
      this.currentFeePerVsize = this.tx.effectiveFeePerVsize;
      this.updateMinRequiredFee();
    }
  }

  @Input({ required: true }) digitalArtifacts?: DigitalArtifact[];

  private updateMinRequiredFee() {

    this.minRequiredFee = Math.ceil(Math.max(this.hourFee, this.currentFeePerVsize, 1));

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

  get parsedInscriptions(): ParsedInscription[] {
    if (!this.digitalArtifacts) {
      return [];
    }
    return this.digitalArtifacts.filter(x => x.type === DigitalArtifactType.Inscription) as ParsedInscription[];
  }

  form = new FormGroup({
    feeRate: new FormControl(0, {
      validators: [
        Validators.required,
        Validators.min(1),
        fullNumberValidator()],
      nonNullable: true
    })
  });

  cfeeRate = this.form.controls.feeRate;

  ngOnInit(): void {
    this.recommendedFees$.pipe(take(1))
      .subscribe(({ fastestFee, hourFee }) => {

        this.hourFee = hourFee;
        this.updateMinRequiredFee();

        // normal case, user just payed way to less
        if (fastestFee > this.minRequiredFee) {
          this.cfeeRate.setValue(fastestFee);
        }

        // special use case, user payed already fastestFee but want's to boost even more
        // --> this case is alread covered in updateMinRequiredFee

        // we are out of the CD
        this.cd.detectChanges();
      });
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
      feeRate: this.cfeeRate.value,

      buyerOrdinalAddress: walletInfo.ordinalsAddress,
      buyerOrdinalPublicKey: walletInfo.ordinalsPublicKey,

      buyerPaymentAddress: walletInfo.paymentAddress,
      buyerPaymentPublicKey: walletInfo.paymentPublicKey,
    };

    this.inscriptionAcceleratorApi.signPsbtAndBroadcast(walletInfo.type, cpfpRequest).subscribe({
      next: (result) => {

        this.broadcastPsbtSuccess = result,
        this.broadcastPsbtLoading = false;
        this.cd.detectChanges();
      },
      error: (err: Error) => {
        this.broadcastPsbtError = extractErrorMessage(err);
        this.broadcastPsbtLoading = false;
        this.cd.detectChanges();
      }
    });
  }
}
