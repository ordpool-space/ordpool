import { LineSeriesOption } from 'echarts';

import {
  Aggregation,
  ChartType,
  FeeStatistic,
  InscriptionSizeStatistic,
  Interval,
  MintStatistic,
  NewTokenStatistic,
} from '../../../../../../backend/src/api/explorer/_ordpool/ordpool-statistics-interface';

type LineType = LineSeriesOption['type'] ;
const line: LineType = 'line';

/**
 * Represents a series configuration for a chart.
 */
export interface ChartSeries {
  /**
   * The name of the series, which is displayed in the legend and tooltips.
   */
  name: string;

  /**
   * The type of chart to render for this series (e.g., 'line').
   */
  type: LineType;

  /**
   * The numerical data points for the series.
   */
  data: number[];
}

// Helper type to map ChartType to the corresponding statistic type
type ExtractStatistic<T extends ChartType> =
  T extends 'mints' ? MintStatistic :
  T extends 'new-tokens' ? NewTokenStatistic :
  T extends 'fees' ? FeeStatistic :
  T extends 'inscription-sizes' ? InscriptionSizeStatistic :
  never;

/**
* A utility function that selects the correct callback function based on the ChartType.
* @param chartType - The chart type (e.g., 'mints', 'new-tokens', 'fees', 'inscription-sizes').
* @param cases - An object mapping ChartType to their corresponding callback functions.
* @returns A callback function for the selected type.
*/
export function matchType<T extends ChartType>(
  chartType: T,
  cases: Record<T, (stats: ExtractStatistic<T>[]) => ChartSeries[]>
): (stats: ExtractStatistic<T>[]) => ChartSeries[] {
  const handler = cases[chartType];
  if (!handler) {
    throw new Error(`Unsupported chart type: ${chartType}`);
  }
  return handler;
}

type LineTypeSeriesDataResult = { 
  name: string;    // The name of the series (e.g., "CAT-21", "Runes"), displayed in the legend and tooltips.
  type: LineType;  // The type of the series, constrained to valid types for line charts (e.g., "line").
  data: number[];  // An array of numerical values representing the data points for this series.
};

/**
* Generates chart series data based on the chart type.
* @param chartType - The chart type.
* @param statistics - The statistics to use for generating the chart.
* @returns The chart series options.
*/
export function getSeriesData<T extends ChartType>(
  chartType: T,
  statistics: ExtractStatistic<T>[]
): LineTypeSeriesDataResult[] {

  return matchType(chartType, {
    mints: (stats: MintStatistic[]) => [
      { name: 'CAT-21', type: line, data: stats.map((stat) => stat.cat21Mints) },
      { name: 'Inscriptions', type: line, data: stats.map((stat) => stat.inscriptionMints) },
      { name: 'Runes', type: line, data: stats.map((stat) => stat.runeMints) },
      { name: 'BRC-20', type: line, data: stats.map((stat) => stat.brc20Mints) },
      { name: 'SRC-20', type: line, data: stats.map((stat) => stat.src20Mints) },
    ],
    'new-tokens': (stats: NewTokenStatistic[]) => [
      { name: 'Rune Etchings', type: line, data: stats.map((stat) => stat.runeEtchings) },
      { name: 'BRC-20 Deploys', type: line, data: stats.map((stat) => stat.brc20Deploys) },
      { name: 'SRC-20 Deploys', type: line, data: stats.map((stat) => stat.src20Deploys) },
    ],
    fees: (stats: FeeStatistic[]) => [
      { name: 'CAT-21', type: line, data: stats.map((stat) => stat.feesCat21Mints) },
      { name: 'Inscriptions', type: line, data: stats.map((stat) => stat.feesInscriptionMints) },
      { name: 'Runes', type: line, data: stats.map((stat) => stat.feesRuneMints) },
      { name: 'Runes (excluding ⧉ UNCOMMON•GOODS)', type: line, data: stats.map((stat) => stat.feesNonUncommonRuneMints) },
      { name: 'BRC-20', type: line, data: stats.map((stat) => stat.feesBrc20Mints) },
      { name: 'SRC-20', type: line, data: stats.map((stat) => stat.feesSrc20Mints) },
    ],
    'inscription-sizes': (stats: InscriptionSizeStatistic[]) => [
      { name: 'Total Envelope Size', type: line, data: stats.map((stat) => stat.totalEnvelopeSize) },
      { name: 'Total Content Size', type: line, data: stats.map((stat) => stat.totalContentSize) },
      { name: 'Largest Envelope Size', type: line, data: stats.map((stat) => stat.largestEnvelopeSize) },
      { name: 'Largest Content Size', type: line, data: stats.map((stat) => stat.largestContentSize) },
      { name: 'Average Envelope Size', type: line, data: stats.map((stat) => stat.avgEnvelopeSize) },
      { name: 'Average Content Size', type: line, data: stats.map((stat) => stat.avgContentSize) },
    ],
  } as Record<T, (stats: ExtractStatistic<T>[]) => LineTypeSeriesDataResult[]>)(statistics);
}

/**
 * Generates tooltip content based on the chart type.
 * @param type - The chart type.
 * @param stat - The statistics object to generate the tooltip content from.
 * @returns Tooltip HTML content as a string.
 */
export function getTooltipContent(
  type: ChartType,
  stat: MintStatistic | NewTokenStatistic | FeeStatistic | InscriptionSizeStatistic
): string {

  const baseContent = `
    Block Range: ${stat.minHeight} - ${stat.maxHeight}<br/>
    Time Range: ${formatUnixTimestamp(stat.minTime)} - ${formatUnixTimestamp(stat.maxTime)}<br/><br/>
  `;

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
        Runes (excluding ⧉ UNCOMMON•GOODS): ${s.feesNonUncommonRuneMints }<br/>
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
    default:
      throw new Error(`Unsupported chart type: ${type}`);
  }
}

/**
 * Formats a given timestamp into a human-readable format.
 * Converts the timestamp to ISO 8601 format, replaces 'T' with a space, and trims seconds.
 *
 * @param timestamp - The timestamp string to format (e.g., '2024-12-22T15:03:22.454Z').
 * @returns A formatted timestamp string in the format 'YYYY-MM-DD HH:mm:ss'.
 *
 * @example
 * formatTimestamp('2024-12-22T15:03:22.454Z');
 * // Returns: '2024-12-22 15:03:22'
 */
export function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Formats a Unix timestamp into a readable string in the format 'YYYY-MM-DD HH:mm:ss'.
 *
 * @param {number} timestamp - The Unix timestamp in seconds to format.
 * @returns {string} The formatted timestamp as a string.
 *
 * @example
 * formatUnixTimestamp(1672531199);
 * // Output: "2023-01-01 00:59:59"
 */
export function formatUnixTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().replace('T', ' ').substring(0, 19);
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