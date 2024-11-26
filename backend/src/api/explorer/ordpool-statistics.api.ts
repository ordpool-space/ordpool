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

  public async $getOrdpoolStatistics(interval: Interval | null = null, aggregation: Aggregation = 'block'): Promise<any> {

    const sqlInterval = OrdpoolStatisticsApi.getSqlInterval(interval);
    const firstInscriptionHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);

    let query = `
      SELECT

        /* SUM(amounts_atomical_mint)           AS atomicalMints, */
        SUM(amounts_cat21_mint)                 AS cat21Mints,
        SUM(amounts_inscription_mint)           AS inscriptionMints,
        SUM(amounts_rune_mint)                  AS runeMints,
        SUM(amounts_brc20_mint)                 AS brc20Mints,
        SUM(amounts_src20_mint)                 AS src20Mints,

        SUM(amounts_rune_etch)                  AS runeEtchings,
        SUM(amounts_brc20_deploy)               AS brc20Deploys,
        SUM(amounts_src20_deploy)               AS src20Deploys,

        SUM(fees_rune_mints)                    AS feesRuneMints,
        SUM(fees_non_uncommon_rune_mints)       AS feesNonUncommonRuneMints,
        SUM(fees_brc20_mints)                   AS feesBrc20Mints,
        SUM(fees_src20_mints)                   AS feesSrc20Mints,
        SUM(fees_cat21_mints)                   AS feesCat21Mints,
        /* SUM(fees_atomicals)                  AS feesAtomicals, */
        SUM(fees_inscription_mints)             AS feesInscriptionMints,

        AVG(inscriptions_total_envelope_size)   AS avgInscriptionsTotalEnvelopeSize,
        AVG(inscriptions_total_content_size)    AS avgInscriptionsTotalContentSize,
        AVG(inscriptions_largest_envelope_size) AS avgInscriptionsLargestEnvelopeSize,
        AVG(inscriptions_largest_content_size)  AS avgInscriptionsLargestContentSize,

        MAX(inscriptions_total_envelope_size)   AS maxInscriptionsTotalEnvelopeSize,
        MAX(inscriptions_total_content_size)    AS maxInscriptionsTotalContentSize,
        MAX(inscriptions_largest_envelope_size) AS maxInscriptionsLargestEnvelopeSize,
        MAX(inscriptions_largest_content_size)  AS maxInscriptionsLargestContentSize,

        MIN(height) AS minHeight,          -- Identify entry by the minimum block height
        MAX(height) AS maxHeight,          -- Identify entry by the maximum block height
        MIN(blockTimestamp) AS minTime,    -- Identify entry by the earliest block timestamp
        MAX(blockTimestamp) AS maxTime     -- Identify entry by the latest block timestamp

      FROM blocks

        WHERE height >= ${firstInscriptionHeight}
    `;

    // Apply the interval filter
    if (sqlInterval) {
      query += ` AND blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${sqlInterval})`;
    }

    // Apply the aggregation level
    if (aggregation === 'hour') {
      query += ` GROUP BY YEAR(blockTimestamp), MONTH(blockTimestamp), DAY(blockTimestamp), HOUR(blockTimestamp)`;
    } else if (aggregation === 'day') {
      query += ` GROUP BY YEAR(blockTimestamp), MONTH(blockTimestamp), DAY(blockTimestamp)`;
    } else {
      // For block-level view, we group by block
      query += ` GROUP BY blockTimestamp`;
    }

    query += ` ORDER BY blockTimestamp DESC`;

    try {
      const [rows] = await DB.query(query);
      return rows;
    } catch (e) {
      logger.err('$getOrdpoolStatistics error: ' + (e instanceof Error ? e.message : e));
      throw e;
    }
  }
}

export default new OrdpoolStatisticsApi();
