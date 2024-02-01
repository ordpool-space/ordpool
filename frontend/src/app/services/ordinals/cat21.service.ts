import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { from, map, Observable, retry, switchMap } from 'rxjs';
import { BitcoinNetworkType, signTransaction, SignTransactionResponse } from 'sats-connect';

import { Status } from '../../interfaces/electrs.interface';
import { ApiService } from '../api.service';
import { KnownOrdinalWalletType, WalletService } from './wallet.service';
import { bytesToHex, hexToBytes } from 'ordpool-parser';

const mempoolMainnetApiUrl = 'https://mempool.space';
const mempoolTestnetApiUrl = 'https://mempool.space/testnet';

export interface TxnOutput {
  txid: string;
  vout: number;
  status: Status;
  value: number;
}

export interface LeatherPSBTBroadcastResponse {
  jsonrpc: string;
  id: string;
  result: {
    hex: string;
  };
}

// see https://github.com/leather-wallet/extension/blob/8dbfefe8fcf5de687c2a137bce5eb2ff7a94b794/src/shared/rpc/methods/sign-psbt.ts#L49
interface LeatherSignPsbtRequestParams {
  hex: string;
  allowedSighash?: any[];
  signAtIndex?: number | number[];
  network?: 'mainnet' | 'testnet' | 'signet' | 'sbtcDevenv' | 'devnet'; // default is user's current network
  account?: number; // default is user's current account
  broadcast?: boolean; // default is false - finalize/broadcast tx
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
   * Broadcast transaction via the mempool API
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

  private createInputScriptForXverse(paymentPublicKey: Uint8Array, network: typeof btc.NETWORK) {
    const p2wpkh = btc.p2wpkh(paymentPublicKey, network);
    const p2sh = btc.p2sh(p2wpkh, network);
    return {
      script: p2sh.script,
      redeemScript: p2sh.redeemScript,
    };
  }

  private createInputScriptForLeather(paymentPublicKey: Uint8Array, network: typeof btc.NETWORK) {
    const p2wpkh = btc.p2wpkh(paymentPublicKey, network);
    return {
      script: p2wpkh.script,
      redeemScript: undefined,
    };
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
        scriptInfo = this.createInputScriptForLeather(paymentPublicKey, network);
        break;

      case KnownOrdinalWalletType.xverse:
        scriptInfo = this.createInputScriptForXverse(paymentPublicKey, network);
        break;

      case KnownOrdinalWalletType.unisat:
        throw new Error('Due to technical limitations of the Unisat wallet, it is right now not supported!');

      default:
        // this case should never happen, but otherwise it's not type-safe
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

    // Amounts to send
    const amountToRecipient = 5000n; // Example amount


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


  private signTransactionAndBroadcastXverse(psbtBytes: Uint8Array, paymentAddress: string): Observable<{ txId: string }> {

    const psbtBase64 = base64.encode(psbtBytes);

    return new Observable<{ txId: string }>((observer) => {

      signTransaction({
        payload: {
          network: {
            type: this.isMainnet ? BitcoinNetworkType.Mainnet : BitcoinNetworkType.Testnet
          },
          message: 'Sign Transaction (CAT-21 Mint)',
          psbtBase64,
          broadcast: true,
          inputsToSign: [
            {
              address: paymentAddress,
              signingIndexes: [0],
              sigHash: btc.SigHash.SINGLE_ANYONECANPAY // 131
            },
          ],
        },
        onFinish: (response: SignTransactionResponse) => {

          const txId = response.txId || '';

          observer.next({ txId });
          observer.complete();
        },
        onCancel: () => {
          observer.error(new Error('Request was cancelled'));
        }
      });
    });
  }

  private async signTransactionLeather(psbtBytes: Uint8Array): Promise<LeatherPSBTBroadcastResponse> {

    const psbtHex = bytesToHex(psbtBytes);

    const signRequestParams: LeatherSignPsbtRequestParams = {
      hex: psbtHex,
      allowedSighash: [btc.SigHash.SINGLE_ANYONECANPAY],
      signAtIndex: 0,
      network: this.isMainnet ? 'mainnet' : 'testnet',
      broadcast: false // we will broadcast it via the Mempool API
    };

    // Sign the PSBT (and broadcast)
    const result: LeatherPSBTBroadcastResponse = await (window as any).btc.request('signPsbt', signRequestParams);
    return result;
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

        const psbtBytes: Uint8Array = this.createPSBT(
          walletType,
          recipientAddress,

          paymentOutput,
          paymentPublicKeyHex,
          paymentAddress
        );

        switch (walletType) {
          case KnownOrdinalWalletType.leather:
            return from(this.signTransactionLeather(psbtBytes)).pipe(
              switchMap(signedPsbt => this.broadcastTransactionLeather(signedPsbt).pipe(
                retry({ count: 3, delay: 500 })
              ))
            );

          case KnownOrdinalWalletType.xverse:
            return this.signTransactionAndBroadcastXverse(psbtBytes, paymentAddress);

          case KnownOrdinalWalletType.unisat:
            throw new Error('Due to technical limitations of the Unisat wallet, it is right now not supported!');

          default:
            // this case should never happen, but otherwise it's not type-safe
            throw new Error('Unknown wallet');
        }
      })
    );
  }
}
