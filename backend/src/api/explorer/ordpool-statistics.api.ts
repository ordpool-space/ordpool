import logger from '../../logger';
import DB from '../../database';
import config from '../../config';
import { getFirstInscriptionHeight } from 'ordpool-parser';

export type Interval =   '1h' | '2h' | '24h' | '3d' | '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | '3y' | '4y';
export type Aggregation = 'block' | 'hour' | 'day';

class OrdpoolStatisticsApi {

  static getSqlInterval(interval: Interval | null): string | null {
    switch (interval) {
      case '1h': return '1 HOUR';
      case '2h': return '2 HOUR';
      case '24h': return '1 DAY';
      case '3d': return '3 DAY';
      case '1w': return '1 WEEK';
      case '1m': return '1 MONTH';
      case '3m': return '3 MONTH';
      case '6m': return '6 MONTH';
      case '1y': return '1 YEAR';
      case '2y': return '2 YEAR';
      case '3y': return '3 YEAR';
      case '4y': return '4 YEAR';
      default: return null;
    }
  }

  public async $getOrdpoolStatistics(interval: Interval | null = null, aggregation: Aggregation = 'block'): Promise<any[]> {

    const sqlInterval = OrdpoolStatisticsApi.getSqlInterval(interval);
    const firstInscriptionHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);

    let query = `
      SELECT
        CAST(SUM(amounts_cat21_mint) AS UNSIGNED)                 AS cat21Mints,
        CAST(SUM(amounts_inscription_mint) AS UNSIGNED)           AS inscriptionMints,
        CAST(SUM(amounts_rune_mint) AS UNSIGNED)                  AS runeMints,
        CAST(SUM(amounts_brc20_mint) AS UNSIGNED)                 AS brc20Mints,
        CAST(SUM(amounts_src20_mint) AS UNSIGNED)                 AS src20Mints,

        CAST(SUM(amounts_rune_etch) AS UNSIGNED)                  AS runeEtchings,
        CAST(SUM(amounts_brc20_deploy) AS UNSIGNED)               AS brc20Deploys,
        CAST(SUM(amounts_src20_deploy) AS UNSIGNED)               AS src20Deploys,

        CAST(SUM(fees_rune_mints) AS UNSIGNED)                    AS feesRuneMints,
        CAST(SUM(fees_non_uncommon_rune_mints) AS UNSIGNED)       AS feesNonUncommonRuneMints,
        CAST(SUM(fees_brc20_mints) AS UNSIGNED)                   AS feesBrc20Mints,
        CAST(SUM(fees_src20_mints) AS UNSIGNED)                   AS feesSrc20Mints,
        CAST(SUM(fees_cat21_mints) AS UNSIGNED)                   AS feesCat21Mints,
        CAST(SUM(fees_inscription_mints) AS UNSIGNED)             AS feesInscriptionMints,

        CAST(AVG(inscriptions_total_envelope_size) AS UNSIGNED)   AS avgInscriptionsTotalEnvelopeSize,
        CAST(AVG(inscriptions_total_content_size) AS UNSIGNED)    AS avgInscriptionsTotalContentSize,
        CAST(AVG(inscriptions_largest_envelope_size) AS UNSIGNED) AS avgInscriptionsLargestEnvelopeSize,
        CAST(AVG(inscriptions_largest_content_size) AS UNSIGNED)  AS avgInscriptionsLargestContentSize,

        CAST(MAX(inscriptions_total_envelope_size) AS UNSIGNED)   AS maxInscriptionsTotalEnvelopeSize,
        CAST(MAX(inscriptions_total_content_size) AS UNSIGNED)    AS maxInscriptionsTotalContentSize,
        CAST(MAX(inscriptions_largest_envelope_size) AS UNSIGNED) AS maxInscriptionsLargestEnvelopeSize,
        CAST(MAX(inscriptions_largest_content_size) AS UNSIGNED)  AS maxInscriptionsLargestContentSize,

        MIN(height) AS minHeight,
        MAX(height) AS maxHeight,
        MIN(blockTimestamp) AS minTime,
        MAX(blockTimestamp) AS maxTime

      FROM blocks
      WHERE height >= ${firstInscriptionHeight}
    `;

    // Apply interval filtering
    if (sqlInterval) {
      query += ` AND blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${sqlInterval})`;
    }

    // Apply aggregation logic
    if (aggregation === 'hour') {
      query += ` GROUP BY YEAR(blockTimestamp), MONTH(blockTimestamp), DAY(blockTimestamp), HOUR(blockTimestamp)`;
    } else if (aggregation === 'day') {
      query += ` GROUP BY YEAR(blockTimestamp), MONTH(blockTimestamp), DAY(blockTimestamp)`;
    } else {
      query += ` GROUP BY blockTimestamp`;
    }

    query += ` ORDER BY blockTimestamp DESC`;

    try {
      const [rows]: any[] = await DB.query(query);
      return rows;
    } catch (e) {
      logger.err('$getOrdpoolStatistics error: ' + (e instanceof Error ? e.message : e));
      throw e;
    }
  }
}

export default new OrdpoolStatisticsApi();
