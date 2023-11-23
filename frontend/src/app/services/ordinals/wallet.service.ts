import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, EMPTY, Observable, distinctUntilChanged, from, map, of, take, tap, timer } from 'rxjs';
import { AddressPurpose, BitcoinNetworkType, getAddress } from 'sats-connect';
import { StorageService } from '../storage.service';

export enum KnownOrdinalWalletType {
  unisat = 'unisat',
  leather = 'leather',
  xverse = 'xverse'
}

export interface KnownOrdinalWallet {
  type: KnownOrdinalWalletType;
  label: string;
  logo: string;
  downloadLink: string;
}

export const KnownOrdinalWallets: { [K in KnownOrdinalWalletType]: KnownOrdinalWallet } = {
  [KnownOrdinalWalletType.xverse]: {
    type: KnownOrdinalWalletType.xverse,
    label: 'Xverse',
    logo: '/resources/ordinal-wallets/btc-xverse-logo.png',
    downloadLink: 'https://unisat.io/download'
  },
  [KnownOrdinalWalletType.leather]: {
    type: KnownOrdinalWalletType.leather,
    label: 'Leather',
    logo: '/resources/ordinal-wallets/btc-leather-logo.png',
    downloadLink: 'https://leather.io/install-extension'
  },
  [KnownOrdinalWalletType.unisat]: {
    type: KnownOrdinalWalletType.unisat,
    label: 'Unisat (not fully supported!)',
    logo: '/resources/ordinal-wallets/btc-unisat-logo.svg',
    downloadLink: 'https://www.xverse.app/download'
  }
};

export interface WalletInfo {
  type: KnownOrdinalWalletType,

  ordinalsAddress: string;
  ordinalsPublicKey: string;

  paymentAddress: string;
  paymentPublicKey: string;
}


export interface XverseAddressResponse {
  addresses: {
    address: string,
    publicKey: string,
    purpose: AddressPurpose.Ordinals | AddressPurpose.Payment
  }[];
}

interface LeatherAddressResponse {
  jsonrpc: string;
  id: string;
  result: {
    addresses: LeatherAddress[];
  };
}

type LeatherAddress = LeatherBtcAddress | LeatherStxAddress;

interface LeatherBtcAddress {
  symbol: 'BTC';
  type: string;
  address: string;
  publicKey: string;
  derivationPath: string;
  tweakedPublicKey?: string;
}

interface LeatherStxAddress {
  symbol: 'STX';
  address: string;
}

// CodeReview @ Leather
// is this a safe assumption? p2wpkh for payments, p2tr for ordinals?
export const leatherOrdinalsAddressType = 'p2tr';
export const leatherPaymentAddressType = 'p2wpkh';

export const LAST_CONNECTED_WALLET = 'LAST_CONNECTED_WALLET';


@Injectable({
  providedIn: 'root'
})
export class WalletService {

  storageService = inject(StorageService);

  connectedWallet$ = new BehaviorSubject<WalletInfo | null>(null);
  wallets$ = timer(0, 500) // Start immediately and repeat every 500ms
    .pipe(
      take(4), // Take 4 intervals only, i.e., perform the check four times
      map(() => this.getInstalledWallets()),
      distinctUntilChanged((prev, curr) => {
        return JSON.stringify(prev) === JSON.stringify(curr);
      })
    );

  constructor() {
    const lastConnectedWallet = this.storageService.getValue(LAST_CONNECTED_WALLET);
    if (lastConnectedWallet) {
      this.connectedWallet$.next(JSON.parse(lastConnectedWallet));
    }
  }


  getInstalledWallets(): {
    installedWallets: KnownOrdinalWallet[],
    notInstalledWallets: KnownOrdinalWallet[]
  } {

    const installedWallets: KnownOrdinalWallet[] = [];
    const notInstalledWallets: KnownOrdinalWallet[] = [];

    if (this.getXverseInstalled()) {
      installedWallets.push(KnownOrdinalWallets.xverse);
    } else {
      notInstalledWallets.push(KnownOrdinalWallets.xverse);
    }

    if (this.getLeatherInstalled()) {
      installedWallets.push(KnownOrdinalWallets.leather);
    } else {
      notInstalledWallets.push(KnownOrdinalWallets.leather);
    }

    if (this.getUnisatInstalled()) {
      installedWallets.push(KnownOrdinalWallets.unisat);
    } else {
      notInstalledWallets.push(KnownOrdinalWallets.unisat);
    }

    return {
      installedWallets,
      notInstalledWallets
    };
  }

  /**
   * as seen here: https://github.com/orenyomtov/openordex/blob/44581ec727c439c15178413b1d46c8f6176f253a/js/app.js#L103
   */
  getUnisatInstalled(): boolean {
    return !!(typeof (window as any).unisat !== 'undefined');
  }

  /**
   * as seen here: https://github.com/orenyomtov/openordex/blob/44581ec727c439c15178413b1d46c8f6176f253a/js/app.js#L107
   */
  getLeatherInstalled(): boolean {
    return !!((window as any)?.StacksProvider?.psbtRequest);
  }

  /**
   * as seen here: https://github.com/orenyomtov/openordex/blob/44581ec727c439c15178413b1d46c8f6176f253a/js/app.js#L111
   */
  getXverseInstalled(): boolean {
    return !!(((window as any)?.BitcoinProvider?.signTransaction?.toString()?.includes('Psbt')));
  }


  connectWallet(key: KnownOrdinalWalletType): Observable<WalletInfo> {

    let obs: Observable<WalletInfo>;

    if (key === KnownOrdinalWalletType.xverse) {
      obs = this.connectXverseWallet();
    }

    if (key === KnownOrdinalWalletType.leather) {
      obs = this.connectLeatherWallet();
    }

    if (key === KnownOrdinalWalletType.unisat) {
      obs = this.connectUnisatWallet();
    }

    return obs.pipe(
      tap(walletInfo => this.storageService.setValue(LAST_CONNECTED_WALLET, JSON.stringify(walletInfo))),
      tap(walletInfo => this.connectedWallet$.next(walletInfo))
    );
  }

  disconnectWallet(): void {
    this.storageService.removeItem(LAST_CONNECTED_WALLET);
    this.connectedWallet$.next(undefined);
  }

  /**
   * Get adresses:
   * see also: https://docs.xverse.app/sats-connect/get-address
   */
  connectXverseWallet(): Observable<WalletInfo> {

    return new Observable<WalletInfo>((observer) => {
      getAddress({
        payload: {
          purposes: [AddressPurpose.Ordinals, AddressPurpose.Payment],
          message: 'Please share your address for receiving Ordinals and payments.',
          network: {
            type: BitcoinNetworkType.Mainnet
          }
        },
        onFinish: (response: XverseAddressResponse) => {

          const addresses = response.addresses;
          const ordinalsAddress = addresses.find(x => x.purpose === AddressPurpose.Ordinals);
          const paymentAddress = addresses.find(x => x.purpose === AddressPurpose.Payment);

          if (!ordinalsAddress) {
            observer.error(new Error('No Ordinals address found?!'));
          } else if (!paymentAddress) {
            observer.error(new Error('No Payment address found?!'));
          }
          else {
            observer.next({
              type: KnownOrdinalWalletType.xverse,

              ordinalsAddress: ordinalsAddress.address,
              ordinalsPublicKey: ordinalsAddress.publicKey,

              paymentAddress: paymentAddress.address,
              paymentPublicKey: paymentAddress.publicKey
            });
            observer.complete();
          }
        },
        onCancel: () => {
          observer.error(new Error('Request was cancelled'));
        }
      });
    });
  }

  /**
   * Get addresses
   * see also: https://leather.gitbook.io/developers/bitcoin/connect-users/get-addresses
   */
  connectLeatherWallet(): Observable<WalletInfo> {

    return from((window as any).btc?.request('getAddresses')).pipe(
      map((response: LeatherAddressResponse) => {

        const addresses = response.result.addresses as LeatherBtcAddress[];

        const ordinalsAddress = addresses.find(x => x.type === leatherOrdinalsAddressType);
        const paymentAddress = addresses.find(x => x.type === leatherPaymentAddressType);

        if (!ordinalsAddress) {
          throw new Error('No Ordinals address found?!');
        } else if (!paymentAddress) {
          throw new Error('No Payment address found?!');
        }

        return {
            type: KnownOrdinalWalletType.leather,

            ordinalsAddress: ordinalsAddress.address,
            ordinalsPublicKey: ordinalsAddress.publicKey,

            paymentAddress: paymentAddress.address,
            paymentPublicKey: paymentAddress.publicKey
          };
        })
    );
  }

    /**
   * Get addresses
   * see ???
   */
    connectUnisatWallet(): Observable<WalletInfo> {
      return EMPTY as any;
    }

}







