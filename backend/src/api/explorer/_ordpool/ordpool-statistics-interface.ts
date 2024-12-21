export type Interval =
  | '1h' | '2h' | '6h' | '12h' | '24h' // Hours
  | '1d' | '3d' | '7d'                 // Days
  | '1w' | '2w' | '3w'                 // Weeks
  | '1m' | '3m' | '6m'                 // Months
  | '1y' | '2y' | '3y' | '4y';         // Years

export type Aggregation = 'block' | 'hour' | 'day' | 'week' | 'month' | 'year';
export type ChartType = 'mints' | 'new-tokens' | 'fees' | 'inscription-sizes';

export interface BaseStatistic {
  minHeight: number;
  maxHeight: number;
  minTime: string;
  maxTime: string;
}

export interface MintStatistic extends BaseStatistic {
  cat21Mints: number;
  inscriptionMints: number;
  runeMints: number;
  brc20Mints: number;
  src20Mints: number;
}

export interface NewTokenStatistic extends BaseStatistic {
  runeEtchings: number;
  brc20Deploys: number;
  src20Deploys: number;
}

export interface FeeStatistic extends BaseStatistic {
  feesInscriptionMints: number;
  feesRuneMints: number;
  feesBrc20Mints: number;
  feesSrc20Mints: number;
}

export interface InscriptionSizeStatistic extends BaseStatistic {
  totalEnvelopeSize: number;  // Sum of all envelope sizes
  totalContentSize: number;   // Sum of all content sizes
  largestEnvelopeSize: number; // Max envelope size
  largestContentSize: number;  // Max content size
}

export type OrdpoolStatisticResponse =
  MintStatistic |
  NewTokenStatistic |
  FeeStatistic |
  InscriptionSizeStatistic;

export function isMintStatistic(stat: OrdpoolStatisticResponse): stat is MintStatistic {
  return 'inscriptionMints' in stat;
}

export function isNewTokenStatistic(stat: OrdpoolStatisticResponse): stat is NewTokenStatistic {
  return 'runeEtchings' in stat;
}

export function isFeeStatistic(stat: OrdpoolStatisticResponse): stat is FeeStatistic {
  return 'feesRuneMints' in stat;
}

export function isInscriptionSizeStatistic(stat: OrdpoolStatisticResponse): stat is InscriptionSizeStatistic {
  return 'avgInscriptionsTotalEnvelopeSize' in stat;
}
