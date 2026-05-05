export type Interval =
  | '1h' | '2h' | '6h' | '12h' | '24h' // Hours
  | '1d' | '3d' | '7d'                 // Days
  | '1w' | '2w' | '3w'                 // Weeks
  | '1m' | '3m' | '6m'                 // Months
  | '1y' | '2y' | '3y' | '4y';         // Years

export type Aggregation = 'block' | 'hour' | 'day' | 'week' | 'month' | 'year';
export type ChartType =
  | 'mints'
  | 'new-tokens'
  | 'fees'
  | 'inscription-sizes'
  | 'protocols'              // counterparty / stamp / src721 / src101 amounts per period
  | 'inscription-types'      // inscription content-type buckets (image / text / json)
  | 'inscription-type-sizes' // image/text/json envelope+content size series
  | 'inscription-type-fees'  // per-bucket inscription mint fees
  | 'inscription-compression'// brotli / gzip counts + compressed-bytes share
  | 'cat21-stats'            // CAT-21 block aggregates: genesis count, fee-rate spread
  | 'rune-activity'          // unique runes minted + top mint count, in pairs
  | 'atomical-ops'           // per-operation counts from satellite (dft/nft/mod/...)
  | 'counterparty-messages'; // per-message-type counts from satellite

export interface BaseStatistic {
  minHeight: number;
  maxHeight: number;
  minTime: number;
  maxTime: number;
}

export interface MintStatistic extends BaseStatistic {
  cat21Mints?: number;
  inscriptionMints?: number;
  runeMints?: number;
  brc20Mints?: number;
  src20Mints?: number;
}

export interface NewTokenStatistic extends BaseStatistic {
  runeEtchings?: number;
  brc20Deploys?: number;
  src20Deploys?: number;
}

export interface FeeStatistic extends BaseStatistic {
  feesRuneMints?: number;
  feesNonUncommonRuneMints?: number;
  feesBrc20Mints?: number;
  feesSrc20Mints?: number;
  feesCat21Mints?: number;
  feesAtomicals?: number;
  feesInscriptionMints?: number;
}

export interface InscriptionSizeStatistic extends BaseStatistic {
  totalEnvelopeSize?: number;  // SUM of all envelope sizes
  totalContentSize?: number;   // SUM of all content sizes
  largestEnvelopeSize?: number; // MAX envelope size
  largestContentSize?: number;  // MAX content size
  avgEnvelopeSize?: number; // AVG envelope size
  avgContentSize?: number;  // AVG content size
}

// Counts per protocol family that aren't mint-shaped: counterparty txs of
// any kind, stamp / src721 / src101 transactions. One row per period.
export interface ProtocolStatistic extends BaseStatistic {
  counterparty?: number;
  stamp?: number;
  src721?: number;
  src101?: number;
}

// Inscription content-type buckets per period. The same inscription mint can
// contribute to multiple buckets: a JSON file at text/plain hits both
// inscriptionTexts and inscriptionJsons.
export interface InscriptionTypeStatistic extends BaseStatistic {
  inscriptionImages?: number;
  inscriptionTexts?: number;
  inscriptionJsons?: number;
}

// Image/text/json sub-aggregate sizes per period.
export interface InscriptionTypeSizeStatistic extends BaseStatistic {
  imageTotalEnvelopeSize?: number;
  imageTotalContentSize?: number;
  imageAvgEnvelopeSize?: number;
  imageAvgContentSize?: number;
  textTotalEnvelopeSize?: number;
  textTotalContentSize?: number;
  textAvgEnvelopeSize?: number;
  textAvgContentSize?: number;
  jsonTotalEnvelopeSize?: number;
  jsonTotalContentSize?: number;
  jsonAvgEnvelopeSize?: number;
  jsonAvgContentSize?: number;
}

// Per-bucket inscription mint fees per period.
export interface InscriptionTypeFeeStatistic extends BaseStatistic {
  feesInscriptionImageMints?: number;
  feesInscriptionTextMints?: number;
  feesInscriptionJsonMints?: number;
}

// Compression telemetry per period.
export interface InscriptionCompressionStatistic extends BaseStatistic {
  brotliCount?: number;
  gzipCount?: number;
  compressedEnvelopeBytes?: number;
}

// CAT-21 block aggregates per period.
export interface Cat21StatStatistic extends BaseStatistic {
  cat21Mints?: number;
  cat21GenesisCount?: number;
  cat21AvgFeeRate?: number | null;
  cat21MinFeeRate?: number | null;
  cat21MaxFeeRate?: number | null;
}

// Rune block aggregates per period — both overall + non-uncommon variants
// in the same response so consumers can render both series.
export interface RuneActivityStatistic extends BaseStatistic {
  uniqueMints?: number;
  uniqueMintsNonUncommon?: number;
  topMintCount?: number;
  topMintCountNonUncommon?: number;
}

// Per-operation atomical counts from the satellite table.
export interface AtomicalOpsStatistic extends BaseStatistic {
  operation?: string;
  count?: number;
}

// Per-message-type counterparty counts from the satellite table.
export interface CounterpartyMessagesStatistic extends BaseStatistic {
  messageType?: string;
  count?: number;
}

export type OrdpoolStatisticResponse =
  MintStatistic |
  NewTokenStatistic |
  FeeStatistic |
  InscriptionSizeStatistic |
  ProtocolStatistic |
  InscriptionTypeStatistic |
  InscriptionTypeSizeStatistic |
  InscriptionTypeFeeStatistic |
  InscriptionCompressionStatistic |
  Cat21StatStatistic |
  RuneActivityStatistic |
  AtomicalOpsStatistic |
  CounterpartyMessagesStatistic;

export function isMintStatistic(stat: OrdpoolStatisticResponse): stat is MintStatistic {
  return 'cat21Mints' in stat;
}

export function isNewTokenStatistic(stat: OrdpoolStatisticResponse): stat is NewTokenStatistic {
  return 'runeEtchings' in stat;
}

export function isFeeStatistic(stat: OrdpoolStatisticResponse): stat is FeeStatistic {
  return 'feesRuneMints' in stat;
}

export function isInscriptionSizeStatistic(stat: OrdpoolStatisticResponse): stat is InscriptionSizeStatistic {
  return 'totalEnvelopeSize' in stat;
}

export function isProtocolStatistic(stat: OrdpoolStatisticResponse): stat is ProtocolStatistic {
  return 'stamp' in stat || 'counterparty' in stat || 'src721' in stat || 'src101' in stat;
}

export function isInscriptionTypeStatistic(stat: OrdpoolStatisticResponse): stat is InscriptionTypeStatistic {
  return 'inscriptionImages' in stat || 'inscriptionTexts' in stat || 'inscriptionJsons' in stat;
}
