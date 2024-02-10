import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged, filter, from, map, Observable, shareReplay, startWith, Subject, take, tap, timer } from 'rxjs';
import { AddressPurpose, BitcoinNetworkType, getAddress } from 'sats-connect';

import { StorageService } from '../storage.service';
import { NavigationEnd, Router } from '@angular/router';

export enum KnownOrdinalWalletType {
  xverse = 'xverse',
  leather = 'leather',
  unisat = 'unisat'
}

export interface KnownOrdinalWallet {
  type: KnownOrdinalWalletType;
  label: string;
  subLabel?: string;
  logo: string;
  downloadLink: string;
}

export const KnownOrdinalWallets: { [K in KnownOrdinalWalletType]: KnownOrdinalWallet } = {
  [KnownOrdinalWalletType.xverse]: {
    type: KnownOrdinalWalletType.xverse,
    label: 'Xverse',
    logo: '/resources/ordinal-wallets/btc-xverse-logo.png',
    downloadLink: 'https://www.xverse.app/download'
  },
  [KnownOrdinalWalletType.leather]: {
    type: KnownOrdinalWalletType.leather,
    label: 'Leather',
    logo: '/resources/ordinal-wallets/btc-leather-logo.png',
    downloadLink: 'https://leather.io/install-extension'
  },
  [KnownOrdinalWalletType.unisat]: {
    type: KnownOrdinalWalletType.unisat,
    label: 'Unisat',
    subLabel: '(not fully supported)',
    logo: '/resources/ordinal-wallets/btc-unisat-logo.svg',
    downloadLink: 'https://unisat.io/download'
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
// is this a correct    assumption? p2wpkh always for payments, p2tr always for ordinals?
export const leatherOrdinalsAddressType = 'p2tr';  // Taproot
export const leatherPaymentAddressType = 'p2wpkh'; // Native Segwit

export const LAST_CONNECTED_WALLET = 'LAST_CONNECTED_WALLET';


@Injectable({
  providedIn: 'root'
})
export class WalletService {

  storageService = inject(StorageService);

  walletConnectRequested$ = new Subject<boolean>();

  connectedWallet$ = new BehaviorSubject<WalletInfo | null>(null);
  wallets$ = timer(0, 500) // Start immediately and repeat every 500ms
    .pipe(
      take(4), // Take 4 intervals only, i.e., perform the check four times
      map(() => this.getInstalledWallets()),
      distinctUntilChanged((prev, curr) => {
        return JSON.stringify(prev) === JSON.stringify(curr);
      })
    );

  router = inject(Router);
  isMainnet$ = this.router.events.pipe(
    filter(event => event instanceof NavigationEnd),
    startWith(undefined), // start with current URL
    map(() => {
      const url = this.router.url;
      return !url.includes('testnet');
    }),
    shareReplay({
      refCount: true,
      bufferSize: 1
    })
  );
  isMainnet = true;

  constructor() {
    const lastConnectedWallet = this.storageService.getValue(LAST_CONNECTED_WALLET);
    if (lastConnectedWallet) {
      this.connectedWallet$.next(JSON.parse(lastConnectedWallet));
    }

    this.isMainnet$.subscribe(isMainnet => this.isMainnet = isMainnet);
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

  getUnisatInstalled(): boolean {
    return !!((window as any).unisat);
  }

  getLeatherInstalled(): boolean {
    return !!((window as any)?.HiroWalletProvider);
  }

  getXverseInstalled(): boolean {
    return !!((window as any)?.XverseProviders);
  }


  connectWallet(key: KnownOrdinalWalletType): Observable<WalletInfo> {

    let obs: Observable<WalletInfo>;

    if (key === KnownOrdinalWalletType.xverse) {
      obs = this.connectWalletXverse();
    }

    if (key === KnownOrdinalWalletType.leather) {
      obs = this.connectWalletLeather();
    }

    if (key === KnownOrdinalWalletType.unisat) {
      obs = this.connectWalletUnisat();
    }

    return obs.pipe(
      tap(walletInfo => this.storageService.setValue(LAST_CONNECTED_WALLET, JSON.stringify(walletInfo))),
      tap(walletInfo => this.connectedWallet$.next(walletInfo))
    );
  }

  connectFakeWallet(walletInfo: WalletInfo): void {
    this.storageService.setValue(LAST_CONNECTED_WALLET, JSON.stringify(walletInfo));
    this.connectedWallet$.next(walletInfo);
  }

  disconnectWallet(): void {
    this.storageService.removeItem(LAST_CONNECTED_WALLET);
    this.connectedWallet$.next(undefined);
  }

  requestWalletConnect(): void {
    this.walletConnectRequested$.next(true);
  }

  /**
   * Get adresses:
   * see also: https://docs.xverse.app/sats-connect/get-address
   */
  connectWalletXverse(): Observable<WalletInfo> {

    return new Observable<WalletInfo>((observer) => {
      getAddress({
        payload: {
          purposes: [AddressPurpose.Ordinals, AddressPurpose.Payment],
          message: 'Please share your address for receiving Ordinals and payments.',
          network: {
            type: this.isMainnet ? BitcoinNetworkType.Mainnet : BitcoinNetworkType.Testnet
          }
        },
        onFinish: (response: XverseAddressResponse) => {

          const addresses = response.addresses;
          const ordinalsAddress = addresses.find(x => x.purpose === AddressPurpose.Ordinals);
          const paymentAddress = addresses.find(x => x.purpose === AddressPurpose.Payment);

          if (!ordinalsAddress || !paymentAddress) {
            observer.error(new Error('Required address not found?!'));
            return;
          }

          observer.next({
            type: KnownOrdinalWalletType.xverse,

            ordinalsAddress: ordinalsAddress.address,
            ordinalsPublicKey: ordinalsAddress.publicKey,

            paymentAddress: paymentAddress.address,
            paymentPublicKey: paymentAddress.publicKey
          });
          observer.complete();
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
  connectWalletLeather(): Observable<WalletInfo> {

    return from((window as any).btc.request('getAddresses')).pipe(
      map((response: LeatherAddressResponse) => {

        const addresses = response.result.addresses as LeatherBtcAddress[];

        const ordinalsAddress = addresses.find(x => x.type === leatherOrdinalsAddressType);
        const paymentAddress = addresses.find(x => x.type === leatherPaymentAddressType);

        if (!ordinalsAddress || !paymentAddress) {
          throw new Error('Required address not found?!');
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


  // as seen here: https://github.com/unisat-wallet/unisat-web3-demo/blob/1109c79b07517ef4abe069c0c80b2d2118915e19/src/App.tsx#L18
  private async getBasicUnisatInfo(): Promise<{ address: string, publicKey: string }> {

    const unisat = (window as any).unisat;
    await unisat.requestAccounts();

    const [address] = await unisat.getAccounts();
    const publicKey = await unisat.getPublicKey();
    // const balance = await unisat.getBalance();
    // const network = await unisat.getNetwork();

    return { address, publicKey };
  }


  /**
   * Get addresses
   * see https://docs.unisat.io/dev/unisat-developer-service/unisat-wallet#requestaccounts
   *
   * Unisat uses the same address for payments and ordinals! 😱
   *
   * TODO: handle accountsChanged / networkChanged
   */
  connectWalletUnisat(): Observable<WalletInfo> {
    return from(this.getBasicUnisatInfo()).pipe(
      map(({ address, publicKey }) => {

        return {
          type: KnownOrdinalWalletType.unisat,

          ordinalsAddress: address,
          ordinalsPublicKey: publicKey,

          paymentAddress: null,
          paymentPublicKey: null
        };
      })
    );
  }
}







