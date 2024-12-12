export type chartType = 'mints' | 'new-tokens' | 'fees' | 'inscription-sizes';

export interface OrdpoolStatistics {
  cat21Mints: number;
  inscriptionMints: number;
  runeMints: number;
  brc20Mints: number;
  src20Mints: number;
  runeEtchings: number;
  brc20Deploys: number;
  src20Deploys: number;
  feesRuneMints: number;
  feesNonUncommonRuneMints: number;
  feesBrc20Mints: number;
  feesSrc20Mints: number;
  feesCat21Mints: number;
  feesInscriptionMints: number;
  avgInscriptionsTotalEnvelopeSize: number;
  avgInscriptionsTotalContentSize: number;
  avgInscriptionsLargestEnvelopeSize: number;
  avgInscriptionsLargestContentSize: number;
  maxInscriptionsTotalEnvelopeSize: number;
  maxInscriptionsTotalContentSize: number;
  maxInscriptionsLargestEnvelopeSize: number;
  maxInscriptionsLargestContentSize: number;
  minHeight: number;
  maxHeight: number;
  minTime: string;
  maxTime: string;
}
