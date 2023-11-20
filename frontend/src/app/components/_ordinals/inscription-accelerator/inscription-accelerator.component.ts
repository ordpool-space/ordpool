import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Observable, take } from 'rxjs';
import { Recommendedfees } from '../../../interfaces/websocket.interface';
import { StateService } from '../../../services/state.service';


@Component({
  selector: 'app-inscription-accelerator',
  templateUrl: './inscription-accelerator.component.html',
  styleUrls: ['./inscription-accelerator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InscriptionAcceleratorComponent {

  form = new FormGroup({
    utxo: new FormControl('', {
      validators: Validators.required,
      nonNullable: true
    }),

    feeRate: new FormControl(0, {
      validators: Validators.required,
      nonNullable: true
    }),

    buyerOrdinalAddress: new FormControl('', {
      validators: Validators.required,
      nonNullable: true
    }),

    buyerOrdinalPublicKey: new FormControl('', {
      validators: Validators.required,
      nonNullable: true
    }),

    buyerPaymentAddress: new FormControl('', {
      validators: Validators.required,
      nonNullable: true
    }),

    buyerPaymentPublicKey: new FormControl('', {
      validators: Validators.required,
      nonNullable: true
    })
  });

  c = this.form.controls;

  @Input() set utxo(utxo: string) {
    this.form.patchValue({ utxo });
  }

  set feeRate(feeRate: number) {
    this.form.patchValue({ feeRate });
  }

  stateService = inject(StateService);
  recommendedFees$ = this.stateService.recommendedFees$;


  constructor() {

    this.recommendedFees$.pipe(
      take(1),
    ).subscribe(fees => {
      this.form.patchValue({ feeRate: fees.fastestFee });
    });

  }



}
