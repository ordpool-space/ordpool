import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject, catchError, combineLatest, map, of, switchMap, take, tap } from 'rxjs';

import { Cat21Service } from '../../../services/ordinals/cat21.service';
import { SimulateTransactionResult, TxnOutput } from '../../../services/ordinals/cat21.service.types';
import { WalletService } from '../../../services/ordinals/wallet.service';
import { KnownOrdinalWalletType, WalletInfo } from '../../../services/ordinals/wallet.service.types';
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
  selectedFeeRate$ = new BehaviorSubject<number>(0);

  selectedPaymentOutput: {
    simulation: SimulateTransactionResult;
    paymentOutput: TxnOutput;
  } | undefined = undefined;


  form = new FormGroup({
    // TODO
    // catRecipient: new FormControl(0, {
    //   validators: [Validators.required],
    //   nonNullable: true
    // }),
    feeRate: new FormControl(1, {
      validators: [Validators.required, Validators.min(1)],
      nonNullable: true
    })
  });

  cfeeRate = this.form.controls.feeRate;

  paymentOutputsForCurrentWallet$ = this.connectedWallet$.pipe(
    switchMap(wallet => this.cat21Service.getUtxos(wallet?.paymentAddress).pipe(
      tap(() => {
        this.utxoLoading = true;
        this.utxoError = '';
      }),
      // retry({ count: 3, delay: 500 }), // Ordpool has a global interceptor for this, otherwise add this line
      map(paymentOutputs => ({
        paymentOutputs,
        wallet,
        error: undefined as Error
      })),
      catchError(error => of({
        paymentOutputs: [] as TxnOutput[],
        wallet: undefined as WalletInfo,
        error: error as Error
      })),
      tap(({ error }) => {
        this.utxoLoading = false;
        this.utxoError = error ? extractErrorMessage(error) : '';
      }),
    ))
  );

  paymentOutputs$ = combineLatest([
    this.paymentOutputsForCurrentWallet$,
    this.selectedFeeRate$
  ]).pipe(

    map(([{ paymentOutputs, wallet, error }, feeRate]) => {

      if (error) {
        return [];
      }

      // feeRate is not yet available, or user removed the input
      if (!feeRate) {
        return [];
      }

      // Sort UTXOs by value in descending order
      return (paymentOutputs || [])
        .sort((a, b) => b.value - a.value)
        .map((paymentOutput: TxnOutput) => {

          try {
            // simulate the transaction with 0 miner fee
            const simulation1 = this.cat21Service.simulateTransaction(
              wallet.type,
              wallet.ordinalsAddress,

              paymentOutput,
              wallet.paymentAddress,
              wallet.paymentPublicKey,
              BigInt(0)
            );

            const transactionFee = BigInt(simulation1.vsize * feeRate);

            // simulate the transaction again, with exact transactionFee
            const simulation2 = this.cat21Service.simulateTransaction(
              wallet.type,
              wallet.ordinalsAddress,

              paymentOutput,
              wallet.paymentAddress,
              wallet.paymentPublicKey,
              transactionFee
            );

            return {
              simulation: simulation2,
              paymentOutput
            };

          } catch(error) {
            // Throws an Error if paymentOutput has not enough funds!
            // - 'Insufficient funds for transaction' via the createTransaction
            // - 'Outputs spends more than inputs amount' when we finalize (second safety net)
            return undefined;
          }
        })
        .filter(x => x); // removes payments with not enough funds
    }),
    // sets it to the largest available UTXO or to undefined
    tap(simulateTransactions => this.selectedPaymentOutput = simulateTransactions[0])
  );

  minRequiredFee: number = 0;

  mintCat21Loading = false;
  mintCat21Success?: { txId: string } = undefined;
  mintCat21Error = '';

  utxoLoading = false;
  utxoError = '';

  KnownOrdinalWalletType = KnownOrdinalWalletType;


  ngOnInit(): void {
    this.recommendedFees$.pipe(take(1))
      .subscribe(({ fastestFee, hourFee }) => {

        this.updateMinRequiredFee(hourFee);

        if (fastestFee > this.minRequiredFee) {
          this.cfeeRate.setValue(fastestFee);
        }

        // always tigger event manually here, otherwise we will miss it in some constellations
        this.selectedFeeRate$.next(this.cfeeRate.value);
        this.cd.detectChanges();
      });

    // triggers an update to for every form change
    this.cfeeRate.valueChanges.subscribe(this.selectedFeeRate$);
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

  mintCat21(wallet: WalletInfo): void {

    if (!this.selectedPaymentOutput) {
      throw new Error('No UTXO selected!');
    }

    const paymentOutput = this.selectedPaymentOutput.paymentOutput;
    const transactionFee = this.selectedPaymentOutput.simulation.finalTransactionFee;

    this.mintCat21Loading = true;
    this.mintCat21Success = undefined;
    this.mintCat21Error = '';


    this.cat21Service.createCat21Transaction(
      wallet.type,
      wallet.ordinalsAddress,

      paymentOutput,
      wallet.paymentAddress,
      wallet.paymentPublicKey,
      transactionFee
    ).subscribe({
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

  toNumber(number: bigint): number {
    return Number(number);
  }
}
