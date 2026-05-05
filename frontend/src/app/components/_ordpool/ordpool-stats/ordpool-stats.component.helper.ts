import { LineSeriesOption } from 'echarts';

import {
  Aggregation,
  AtomicalOpsStatistic,
  Cat21StatStatistic,
  ChartType,
  CounterpartyMessagesStatistic,
  FeeStatistic,
  InscriptionCompressionStatistic,
  InscriptionSizeStatistic,
  InscriptionTypeFeeStatistic,
  InscriptionTypeSizeStatistic,
  InscriptionTypeStatistic,
  Interval,
  MintStatistic,
  NewTokenStatistic,
  ProtocolStatistic,
  RuneActivityStatistic,
} from '../../../../../../backend/src/api/explorer/_ordpool/ordpool-statistics-interface';

// Helper type to map ChartType to the corresponding statistic type
type ExtractStatistic<T extends ChartType> =
  T extends 'mints' ? MintStatistic :
  T extends 'new-tokens' ? NewTokenStatistic :
  T extends 'fees' ? FeeStatistic :
  T extends 'inscription-sizes' ? InscriptionSizeStatistic :
  T extends 'protocols' ? ProtocolStatistic :
  T extends 'inscription-types' ? InscriptionTypeStatistic :
  T extends 'inscription-type-sizes' ? InscriptionTypeSizeStatistic :
  T extends 'inscription-type-fees' ? InscriptionTypeFeeStatistic :
  T extends 'inscription-compression' ? InscriptionCompressionStatistic :
  T extends 'cat21-stats' ? Cat21StatStatistic :
  T extends 'rune-activity' ? RuneActivityStatistic :
  T extends 'atomical-ops' ? AtomicalOpsStatistic :
  T extends 'counterparty-messages' ? CounterpartyMessagesStatistic :
  never;

/**
 * A utility function to map the chart type to its corresponding data handler.
 * Ensures type safety and clear mappings for each chart type.
 * 
 * @param type - The chart type (e.g., 'mints', 'new-tokens', 'fees', 'inscription-sizes').
 * @param cases - A map of chart types to their respective handlers.
 * @returns A callback function for the specified chart type.
 */
export function matchType<T extends ChartType>(
  type: T,
  cases: { [K in ChartType]: (stats: ExtractStatistic<K>[]) => LineSeriesOption[] }
): (stats: ExtractStatistic<T>[]) => LineSeriesOption[] {
  const handler = cases[type];
  if (!handler) {
    throw new Error(`Unsupported chart type: ${type}`);
  }
  return handler;
}

/**
 * Generates chart series data based on the chart type.
 * Each data point in the series is a tuple containing a timestamp (in milliseconds) 
 * and its corresponding value.
 * 
 * Example for "CAT-21" mints:
 * [
 *   [1735216562000, 10], // Jan 26, 2024 12:36:02 AM, Value: 10
 *   [1735217162000, 12]  // Jan 26, 2024 12:46:02 AM, Value: 12
 * ]
 * 
 * @param chartType - The type of chart (e.g., 'mints', 'fees', etc.).
 * @param statistics - The statistics data for the chart.
 * @returns The ECharts-compatible series options.
 */
export function getSeriesData<T extends ChartType>(
  chartType: T,
  statistics: ExtractStatistic<T>[]
): LineSeriesOption[] {
  return matchType(chartType, {
    mints: (stats: MintStatistic[]) => [
      { name: 'CAT-21', type: 'line', data: stats.map((stat) => [stat.minTime, stat.cat21Mints]) },
      { name: 'Inscriptions', type: 'line', data: stats.map((stat) => [stat.minTime, stat.inscriptionMints]) },
      { name: 'Runes', type: 'line', data: stats.map((stat) => [stat.minTime, stat.runeMints]) },
      { name: 'BRC-20', type: 'line', data: stats.map((stat) => [stat.minTime, stat.brc20Mints]) },
      { name: 'SRC-20', type: 'line', data: stats.map((stat) => [stat.minTime, stat.src20Mints]) },
    ],
    'new-tokens': (stats: NewTokenStatistic[]) => [
      { name: 'Rune Etchings', type: 'line', data: stats.map((stat) => [stat.minTime, stat.runeEtchings]) },
      { name: 'BRC-20 Deploys', type: 'line', data: stats.map((stat) => [stat.minTime, stat.brc20Deploys]) },
      { name: 'SRC-20 Deploys', type: 'line', data: stats.map((stat) => [stat.minTime, stat.src20Deploys]) },
    ],
    fees: (stats: FeeStatistic[]) => [
      { name: 'CAT-21', type: 'line', data: stats.map((stat) => [stat.minTime, stat.feesCat21Mints]) },
      { name: 'Inscriptions', type: 'line', data: stats.map((stat) => [stat.minTime, stat.feesInscriptionMints]) },
      { name: 'Runes', type: 'line', data: stats.map((stat) => [stat.minTime, stat.feesRuneMints]) },
      { name: 'Runes (excluding ⧉ UNCOMMON•GOODS)', type: 'line', data: stats.map((stat) => [stat.minTime, stat.feesNonUncommonRuneMints]) },
      { name: 'BRC-20', type: 'line', data: stats.map((stat) => [stat.minTime, stat.feesBrc20Mints]) },
      { name: 'SRC-20', type: 'line', data: stats.map((stat) => [stat.minTime, stat.feesSrc20Mints]) },
    ],
    'inscription-sizes': (stats: InscriptionSizeStatistic[]) => [
      { name: 'Total Envelope Size', type: 'line', data: stats.map((stat) => [stat.minTime, stat.totalEnvelopeSize]) },
      { name: 'Total Content Size', type: 'line', data: stats.map((stat) => [stat.minTime, stat.totalContentSize]) },
      { name: 'Largest Envelope Size', type: 'line', data: stats.map((stat) => [stat.minTime, stat.largestEnvelopeSize]) },
      { name: 'Largest Content Size', type: 'line', data: stats.map((stat) => [stat.minTime, stat.largestContentSize]) },
      { name: 'Average Envelope Size', type: 'line', data: stats.map((stat) => [stat.minTime, stat.avgEnvelopeSize]) },
      { name: 'Average Content Size', type: 'line', data: stats.map((stat) => [stat.minTime, stat.avgContentSize]) },
    ],
    protocols: (stats: ProtocolStatistic[]) => [
      { name: 'Counterparty', type: 'line', data: stats.map((stat) => [stat.minTime, stat.counterparty]) },
      { name: 'Stamp', type: 'line', data: stats.map((stat) => [stat.minTime, stat.stamp]) },
      { name: 'SRC-721', type: 'line', data: stats.map((stat) => [stat.minTime, stat.src721]) },
      { name: 'SRC-101', type: 'line', data: stats.map((stat) => [stat.minTime, stat.src101]) },
    ],
    'inscription-types': (stats: InscriptionTypeStatistic[]) => [
      { name: 'Images', type: 'line', data: stats.map((stat) => [stat.minTime, stat.inscriptionImages]) },
      { name: 'Text', type: 'line', data: stats.map((stat) => [stat.minTime, stat.inscriptionTexts]) },
      { name: 'JSON', type: 'line', data: stats.map((stat) => [stat.minTime, stat.inscriptionJsons]) },
    ],
    'inscription-type-sizes': (stats: InscriptionTypeSizeStatistic[]) => [
      { name: 'Images — total envelope', type: 'line', data: stats.map((stat) => [stat.minTime, stat.imageTotalEnvelopeSize]) },
      { name: 'Images — total content',  type: 'line', data: stats.map((stat) => [stat.minTime, stat.imageTotalContentSize]) },
      { name: 'Text — total envelope',   type: 'line', data: stats.map((stat) => [stat.minTime, stat.textTotalEnvelopeSize]) },
      { name: 'Text — total content',    type: 'line', data: stats.map((stat) => [stat.minTime, stat.textTotalContentSize]) },
      { name: 'JSON — total envelope',   type: 'line', data: stats.map((stat) => [stat.minTime, stat.jsonTotalEnvelopeSize]) },
      { name: 'JSON — total content',    type: 'line', data: stats.map((stat) => [stat.minTime, stat.jsonTotalContentSize]) },
    ],
    'inscription-type-fees': (stats: InscriptionTypeFeeStatistic[]) => [
      { name: 'Image mint fees', type: 'line', data: stats.map((stat) => [stat.minTime, stat.feesInscriptionImageMints]) },
      { name: 'Text mint fees',  type: 'line', data: stats.map((stat) => [stat.minTime, stat.feesInscriptionTextMints]) },
      { name: 'JSON mint fees',  type: 'line', data: stats.map((stat) => [stat.minTime, stat.feesInscriptionJsonMints]) },
    ],
    'inscription-compression': (stats: InscriptionCompressionStatistic[]) => [
      { name: 'Brotli count',          type: 'line', data: stats.map((stat) => [stat.minTime, stat.brotliCount]) },
      { name: 'Gzip count',            type: 'line', data: stats.map((stat) => [stat.minTime, stat.gzipCount]) },
      { name: 'Compressed bytes',      type: 'line', data: stats.map((stat) => [stat.minTime, stat.compressedEnvelopeBytes]) },
    ],
    'cat21-stats': (stats: Cat21StatStatistic[]) => [
      { name: 'CAT-21 mints',           type: 'line', data: stats.map((stat) => [stat.minTime, stat.cat21Mints]) },
      { name: 'Genesis cats',           type: 'line', data: stats.map((stat) => [stat.minTime, stat.cat21GenesisCount]) },
      { name: 'Avg fee rate (sat/vB)',  type: 'line', data: stats.map((stat) => [stat.minTime, stat.cat21AvgFeeRate ?? 0]) },
    ],
    'rune-activity': (stats: RuneActivityStatistic[]) => [
      { name: 'Unique runes minted',                            type: 'line', data: stats.map((stat) => [stat.minTime, stat.uniqueMints]) },
      { name: 'Unique runes minted (excluding ⧉ UNCOMMON•GOODS)', type: 'line', data: stats.map((stat) => [stat.minTime, stat.uniqueMintsNonUncommon]) },
      { name: 'Top mint count',                                  type: 'line', data: stats.map((stat) => [stat.minTime, stat.topMintCount]) },
      { name: 'Top mint count (excluding ⧉ UNCOMMON•GOODS)',     type: 'line', data: stats.map((stat) => [stat.minTime, stat.topMintCountNonUncommon]) },
    ],
    // atomical-ops + counterparty-messages return one row per (period, op).
    // Single aggregate line for now; per-op breakdown is a follow-up
    // (needs grouping the rows by `operation` / `messageType` and emitting
    // one series per distinct value — depends on the time-series UI design).
    'atomical-ops': (stats: AtomicalOpsStatistic[]) => [
      { name: 'Atomical operations', type: 'line', data: stats.map((stat) => [stat.minTime, stat.count]) },
    ],
    'counterparty-messages': (stats: CounterpartyMessagesStatistic[]) => [
      { name: 'Counterparty messages', type: 'line', data: stats.map((stat) => [stat.minTime, stat.count]) },
    ],
  })(statistics);
}

/**
 * Generates tooltip content based on the chart type.
 * @param type - The chart type.
 * @param stat - The statistics object to generate the tooltip content from.
 * @returns Tooltip HTML content as a string.
 */
export function getTooltipContent(
  type: ChartType,
  stat: MintStatistic | NewTokenStatistic | FeeStatistic | InscriptionSizeStatistic | ProtocolStatistic | InscriptionTypeStatistic
       | InscriptionTypeSizeStatistic | InscriptionTypeFeeStatistic | InscriptionCompressionStatistic
       | Cat21StatStatistic | RuneActivityStatistic | AtomicalOpsStatistic | CounterpartyMessagesStatistic
): string {

  const baseContent = `
    Block Range: ${stat.minHeight} – ${stat.maxHeight}<br/>
    Time Range: ${formatTimestamp(stat.minTime)} – ${formatTimestamp(stat.maxTime)}<br/><br/>
  `;

  // Check if all properties (except minHeight, maxHeight, minTime, maxTime) are `null`
  const propertiesToCheck = { ...stat };
  delete propertiesToCheck.minHeight;
  delete propertiesToCheck.maxHeight;
  delete propertiesToCheck.minTime;
  delete propertiesToCheck.maxTime;

  const allPropertiesAreNull = Object.values(propertiesToCheck).every(
    (value) => value === null
  );

  if (allPropertiesAreNull) {
    return baseContent + 'This block has not been fully indexed yet.<br><strong>Please try again later.</strong>';
  }

  switch (type) {
    case 'mints': {
      const s = stat as MintStatistic;
      return (
        baseContent +
        `
        CAT-21: ${s.cat21Mints }<br/>
        Inscriptions: ${s.inscriptionMints }<br/>
        Runes: ${s.runeMints }<br/>
        BRC-20: ${s.brc20Mints }<br/>
        SRC-20: ${s.src20Mints }
      `
      );
    }
    case 'new-tokens': {
      const s = stat as NewTokenStatistic;
      return (
        baseContent +
        `
        Rune Etchings: ${s.runeEtchings }<br/>
        BRC-20 Deploys: ${s.brc20Deploys }<br/>
        SRC-20 Deploys: ${s.src20Deploys }
      `
      );
    }
    case 'fees': {
      const s = stat as FeeStatistic;
      return (
        baseContent +
        `
        CAT-21: ${s.feesCat21Mints }<br/>
        Inscriptions: ${s.feesInscriptionMints }<br/>
        Runes: ${s.feesRuneMints }<br/>
        Runes: ${s.feesNonUncommonRuneMints } <small>(excluding ⧉ UNCOMMON•GOODS)</small><br/>
        BRC-20: ${s.feesBrc20Mints }<br/>
        SRC-20: ${s.feesSrc20Mints }
      `
      );
    }
    case 'inscription-sizes': {
      const s = stat as InscriptionSizeStatistic;
      return (
        baseContent +
        `
        Total Envelope Size: ${s.totalEnvelopeSize }<br/>
        Total Content Size: ${s.totalContentSize }<br/>
        Largest Envelope Size: ${s.largestEnvelopeSize }<br/>
        Largest Content Size: ${s.largestContentSize }<br/>
        Average Envelope Size: ${s.avgEnvelopeSize }<br/>
        Average Content Size: ${s.avgContentSize }
      `
      );
    }
    case 'protocols': {
      const s = stat as ProtocolStatistic;
      return (
        baseContent +
        `
        Counterparty: ${s.counterparty }<br/>
        Stamp: ${s.stamp }<br/>
        SRC-721: ${s.src721 }<br/>
        SRC-101: ${s.src101 }
      `
      );
    }
    case 'inscription-types': {
      const s = stat as InscriptionTypeStatistic;
      return (
        baseContent +
        `
        Images: ${s.inscriptionImages }<br/>
        Text: ${s.inscriptionTexts }<br/>
        JSON: ${s.inscriptionJsons }
      `
      );
    }
    default:
      throw new Error(`Unsupported chart type: ${type}`);
  }
}

/**
 * Formats a timestamp in ms into a readable format.
 *
 * @param {number} timestamp - The timestamp in milliseconds to format.
 * @returns {string} The formatted timestamp as a string.
 *
 * @example
 * formatTimestamp(1672531199 * 1000);
 * // Output: "2023-01-01 00:59:59"
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Transforms a ChartType into a formatted heading.
 * @param chartType - The chart type to format.
 * @returns A formatted string representing the heading.
 */
export function formatChartHeading(chartType: ChartType): string {
  const chartTypeHeadings: Record<ChartType, string> = {
    mints: 'Mints',
    'new-tokens': 'New Tokens',
    fees: 'Fees',
    'inscription-sizes': 'Inscription Sizes',
    protocols: 'Other Protocols',
    'inscription-types': 'Inscription Types',
    'inscription-type-sizes': 'Inscription Type Sizes',
    'inscription-type-fees': 'Inscription Type Fees',
    'inscription-compression': 'Inscription Compression',
    'cat21-stats': 'CAT-21 Stats',
    'rune-activity': 'Rune Activity',
    'atomical-ops': 'Atomical Operations',
    'counterparty-messages': 'Counterparty Messages',
  };

  return chartTypeHeadings[chartType];
}

/**
 * Generates a detailed description of the chart based on its type, interval, and aggregation.
 * @param chartType - The type of data being visualized.
 * @param interval - The time interval being analyzed.
 * @param aggregation - The aggregation level applied to the data.
 * @returns A human-readable description of the chart.
 */
export function formatChartDescription(chartType: ChartType, interval: Interval, aggregation: Aggregation): string {
  const chartTypeDescriptions: Record<ChartType, string> = {
    mints: 'This chart visualizes the total number of mints, including CAT-21 assets, inscriptions, Runes, BRC-20 tokens, and SRC-20 tokens.',
    'new-tokens': 'This chart showcases the deployment of new tokens, including Rune etchings, BRC-20 deployments, and SRC-20 deployments.',
    fees: 'This chart illustrates the total fees incurred during minting activities for CAT-21 assets, inscriptions, Runes, BRC-20 tokens, and SRC-20 tokens.',
    'inscription-sizes': 'This chart analyzes the sizes of inscriptions during minting activities, showing total sizes, largest sizes, and average sizes for both envelope and content data.',
    protocols: 'This chart tracks activity from older Bitcoin meta-protocols: Counterparty, Stamp, SRC-721 and SRC-101.',
    'inscription-types': 'This chart breaks down inscriptions by content type: images (any image/* MIME), text (text/plain, text/html, etc.), and JSON (application/json or text/plain bodies that parse as JSON objects). The same mint can contribute to multiple buckets — a JSON inscribed as text/plain hits both Text and JSON.',
    'inscription-type-sizes': 'Per-content-type envelope and content sizes for inscriptions, broken into image, text, and JSON buckets. Shows whether one bucket dominates the bytes, even when the counts look balanced.',
    'inscription-type-fees': 'Per-content-type fees for inscription mints (image, text, JSON). The three sub-totals sum to ≤ the total inscription mint fees — each tx attributes to at most one bucket.',
    'inscription-compression': 'Compression telemetry for inscriptions: brotli vs gzip counts and total compressed envelope bytes. Useful for tracking how much of the inscription weight is compressed.',
    'cat21-stats': 'CAT-21 block aggregates: total mints, genesis cats minted (the rare hash-derived trait, ~1 per 256), and average fee rate per cat.',
    'rune-activity': 'Rune mint activity: distinct runes seeing mints + the top single-rune mint count. Each metric is shown twice — overall and excluding UNCOMMON•GOODS (rune 1:0, which dominates every rune mint stat).',
    'atomical-ops': 'Atomical operations breakdown by op type (nft/ft/dft/dmt/mod/evt/sl/dat).',
    'counterparty-messages': 'Counterparty message activity per period — sends, dispensers, fairmints, bets, sweeps, and the rest of the 22+ message types.',
  };

  const intervalDescriptions: Record<Interval, string> = {
    '1h': 'the last hour',
    '2h': 'the last two hours',
    '6h': 'the last six hours',
    '12h': 'the last twelve hours',
    '24h': 'the last day (24 hours)',
    '1d': 'the last day (24 hours)',
    '3d': 'the last three days',
    '7d': 'the last seven days (one week)',
    '1w': 'the last week (7 days)',
    '2w': 'the last two weeks (14 days)',
    '3w': 'the last three weeks (21 days)',
    '1m': 'the last month (30 days)',
    '3m': 'the last three months (90 days)',
    '6m': 'the last six months',
    '1y': 'the last year (365 days)',
    '2y': 'the last two years',
    '3y': 'the last three years',
    '4y': 'the last four years',
  };

  const aggregationDescriptions: Record<Aggregation, string> = {
    block: 'presents it at the individual block level, showing data for each Bitcoin block.',
    hour: 'is aggregated at an hourly level, summarizing data for each hour.',
    day: 'is aggregated at a daily level, summarizing data for each day.',
    week: 'is aggregated at a weekly level, summarizing data for each week.',
    month: 'is aggregated at a monthly level, summarizing data for each month.',
    year: 'is aggregated at a yearly level, summarizing data for each year.',
  };

  const typeDescription = chartTypeDescriptions[chartType];
  const intervalDescription = intervalDescriptions[interval];
  const aggregationDescription = aggregationDescriptions[aggregation];

  return `${typeDescription} It focuses on data collected over ${intervalDescription} and ${aggregationDescription}`;
}