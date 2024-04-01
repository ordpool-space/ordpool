import { AddressPurpose } from 'sats-connect';

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
    // subLabel: '(not fully supported)',
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

export interface LeatherAddressResponse {
  jsonrpc: string;
  id: string;
  result: {
    addresses: LeatherAddress[];
  };
}

export type LeatherAddress = LeatherBtcAddress | LeatherStxAddress;

export interface LeatherBtcAddress {
  symbol: 'BTC';
  type: string;
  address: string;
  publicKey: string;
  derivationPath: string;
  tweakedPublicKey?: string;
}

export interface LeatherStxAddress {
  symbol: 'STX';
  address: string;
}
