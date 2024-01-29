import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { map, Observable, take } from 'rxjs';

import { Transaction } from '../../../interfaces/electrs.interface';
import { InscriptionAcceleration, InscriptionAcceleratorApiService } from '../../../services/ordinals/inscription-accelerator-api.service';
import { KnownOrdinalWalletType, WalletInfo, WalletService } from '../../../services/ordinals/wallet.service';
import { StateService } from '../../../services/state.service';
import { extractErrorMessage } from './extract-error-message';
import { DigitalArtifact, DigitalArtifactType, ParsedInscription } from 'ordpool-parser';
import { environment } from '../../../../environments/environment';


@Component({
  selector: 'app-inscription-accelerator',
  templateUrl: './inscription-accelerator.component.html',
  styleUrls: ['./inscription-accelerator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InscriptionAcceleratorComponent implements OnInit  {

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

  }

  @Input({ required: true }) digitalArtifacts?: DigitalArtifact[];

  get parsedInscriptions(): ParsedInscription[] {
    if (!this.digitalArtifacts) {
      return [];
    }
    return this.digitalArtifacts.filter(x => x.type === DigitalArtifactType.Inscription) as ParsedInscription[];
  }

  form = new FormGroup({
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
