import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { hexToBytes } from 'ordpool-parser';
import { from, map, Observable, retry, switchMap } from 'rxjs';

import { Status } from '../../interfaces/electrs.interface';
import { ApiService } from '../api.service';
import {
  createInputScriptForLeather,
  createInputScriptForXverse,
  getHardcodedPrivateKey,
  getMinimumUtxoSize,
  LeatherPSBTBroadcastResponse,
  signTransactionAndBroadcastXverse,
  signTransactionLeather,
} from './cat21.service.helper';
import { KnownOrdinalWalletType, WalletService } from './wallet.service';



const mempoolMainnetApiUrl = 'https://mempool.space';
const mempoolTestnetApiUrl = 'https://mempool.space/testnet';

export interface TxnOutput {
  txid: string;
  vout: number;
  status: Status;
  value: number;
}


@Injectable({
  providedIn: 'root'
})
export class Cat21Service {

  walletService = inject(WalletService);
  http = inject(HttpClient);
  apiService = inject(ApiService);

  isMainnet = true;
  mempoolApiUrl = mempoolMainnetApiUrl;

  constructor() {
    this.walletService.isMainnet$.subscribe(isMainnet => {
      this.isMainnet = isMainnet;
      this.mempoolApiUrl = isMainnet ? mempoolMainnetApiUrl : mempoolTestnetApiUrl;
    });
  }

  /**
   * Get the list of unspent transaction outputs associated with the address/scripthash.
   * Available fields: txid, vout, value, and status (with the status of the funding tx).
   * @param address The Bitcoin address to query.
   * @returns An Observable of UTXO array.
   */
  private getUtxos(address: string): Observable<TxnOutput[]> {
    return this.http.get<TxnOutput[]>(`${this.mempoolApiUrl}/api/address/${address}/utxo`);
  }

  /**
   * Broadcast a transaction via the mempool API
   */
  private broadcastTransactionLeather(resp: LeatherPSBTBroadcastResponse): Observable<{ txId: string }> {

    // as seen in the Leather docs
    const hexRespFromLeather = resp.result.hex;
    const tx = btc.Transaction.fromPSBT(hexToBytes(hexRespFromLeather));
    tx.finalize();

    return this.apiService.postTransaction$(tx.hex).pipe(
      map(txId => ({ txId })),
    );
  }

  private createPSBT(
    walletType: KnownOrdinalWalletType,
    recipientAddress: string,

    paymentOutput: TxnOutput,
    paymentPublicKeyHex: string,
    paymentAddress: string
  ): Uint8Array {

    const network: typeof btc.NETWORK = this.isMainnet ? btc.NETWORK : btc.TEST_NETWORK;
    const paymentPublicKey: Uint8Array = hex.decode(paymentPublicKeyHex);

    let scriptInfo: {
      script: Uint8Array;
      redeemScript: Uint8Array | undefined
    };

    switch (walletType) {
      case KnownOrdinalWalletType.leather:
        scriptInfo = createInputScriptForLeather(paymentPublicKey, network);
        break;

      case KnownOrdinalWalletType.xverse:
        scriptInfo = createInputScriptForXverse(paymentPublicKey, network);
        break;

      case KnownOrdinalWalletType.unisat:
        throw new Error('The Unisat wallet is right now not supported!');

      default:
        // this case should never happen, but otherwise the code is not type-safe
        throw new Error('Unknown wallet');
    }

    const { script, redeemScript } = scriptInfo;

    const lockTime = 21; // THIS is the most important part 😺
    const tx = new btc.Transaction({ allowUnknownOutputs: true, lockTime: lockTime });

    tx.addInput({
      txid: paymentOutput.txid,
      index: paymentOutput.vout,
      witnessUtxo: {
        script: script,
        amount: BigInt(paymentOutput.value),
      },
      redeemScript: redeemScript,
      sighashType: btc.SigHash.SINGLE_ANYONECANPAY // 131
    });

    // Smallest possible amount
    const amountToRecipient = BigInt(getMinimumUtxoSize(paymentAddress));

    // Calculate change
    const totalAmount = BigInt(paymentOutput.value);
    const changeAmount = totalAmount - amountToRecipient - 10000n;

    if (changeAmount < 0) {
      throw new Error('Insufficient funds for transaction');
    }

    // Add outputs
    tx.addOutputAddress(recipientAddress, amountToRecipient, network);
    tx.addOutputAddress(paymentAddress, changeAmount, network);

    // PSBT as Uint8Array
    const psbt0 = tx.toPSBT(0);
    return psbt0;
  }

  createCat21Transaction(
    walletType: KnownOrdinalWalletType,
    recipientAddress: string,
    paymentAddress: string,
    paymentPublicKeyHex: string): Observable<{ txId: string }> {

    return this.getUtxos(paymentAddress).pipe(
      retry({ count: 3, delay: 500 }),
      switchMap(paymentUnspentOutputs => {

        if (!paymentUnspentOutputs || paymentUnspentOutputs.length === 0) {
          throw new Error(`No unspent outputs (UTXOs) found for payment address. Please load up your wallet's payment address: ${paymentAddress}`);
        }

        // Sort UTXOs by value in descending order and select the largest one
        const largestUTXO = paymentUnspentOutputs.sort((a, b) => b.value - a.value)[0];

        // TODO: calculate the required value (not just hardcoded)
        if (largestUTXO.value < 20000) {
          throw new Error(`Not enough funds in your payment address. Pleae load up your wallet's payment address: ${paymentAddress}`);
        }

        const paymentOutput = largestUTXO;

        // simulate the PSBT first
        const keyPair = getHardcodedPrivateKey(this.isMainnet);


        // create the real PSBT
        const psbtBytes: Uint8Array = this.createPSBT(
          walletType,
          recipientAddress,

          paymentOutput,
          paymentPublicKeyHex,
          paymentAddress
        );

        switch (walletType) {
          case KnownOrdinalWalletType.leather:
            return from(signTransactionLeather(psbtBytes, this.isMainnet)).pipe(
              switchMap(signedPsbt => this.broadcastTransactionLeather(signedPsbt).pipe(
                retry({ count: 3, delay: 500 })
              ))
            );

          case KnownOrdinalWalletType.xverse:
            return signTransactionAndBroadcastXverse(psbtBytes, paymentAddress, this.isMainnet);

          case KnownOrdinalWalletType.unisat:
            throw new Error('Due to technical limitations of the Unisat wallet, it is right now not supported!');

          default:
            // this case should never happen, but otherwise the code is not type-safe
            throw new Error('Unknown wallet');
        }
      })
    );
  }
}
