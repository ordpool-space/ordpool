import { getFirstInscriptionHeight } from 'ordpool-parser';

import config from '../../../config';
import DB from '../../../database';
import logger from '../../../logger';
import { getSqlInterval } from './get-sql-interval';
import { Aggregation, ChartType, Interval, OrdpoolStatisticResponse } from './ordpool-statistics-interface';


class OrdpoolStatisticsApi {

  public async getOrdpoolStatistics(
    type: ChartType,
    interval: Interval,
    aggregation: Aggregation
  ): Promise<OrdpoolStatisticResponse[]> {

    const firstInscriptionHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);
    const sqlInterval = getSqlInterval(interval);
    const selectClause = this.getSelectClause(type);
    const groupByClause = this.getGroupByClause(aggregation);

    const query = `
      SELECT ${selectClause}
      FROM blocks b
      LEFT JOIN blocks_ordpool_stats bos ON b.hash = bos.hash
      WHERE b.height >= ${firstInscriptionHeight}
        AND b.blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${sqlInterval})
      ${groupByClause}
      ORDER BY b.blockTimestamp DESC
    `;

    try {
      const [rows] : any[] = await DB.query(query);
      return rows;
    } catch (error) {
      logger.err(`Error executing query: ${error}`);
      throw error;
    }
  }

  private getSelectClause(type: ChartType): string {
    const baseClause = `
      MIN(b.height) AS minHeight,
      MAX(b.height) AS maxHeight,
      MIN(b.blockTimestamp) AS minTime,
      MAX(b.blockTimestamp) AS maxTime
    `;

    switch (type) {
      case 'mints':
        return `
          ${baseClause},
          SUM(bos.amounts_cat21_mint) AS cat21Mints,
          SUM(bos.amounts_inscription_mint) AS inscriptionMints,
          SUM(bos.amounts_rune_mint) AS runeMints,
          SUM(bos.amounts_brc20_mint) AS brc20Mints,
          SUM(bos.amounts_src20_mint) AS src20Mints
        `;
      case 'new-tokens':
        return `
          ${baseClause},
          SUM(bos.amounts_rune_etch) AS runeEtchings,
          SUM(bos.amounts_brc20_deploy) AS brc20Deploys,
          SUM(bos.amounts_src20_deploy) AS src20Deploys
        `;
      case 'fees':
        return `
          ${baseClause},
          SUM(bos.fees_rune_mints) AS feesRuneMints,
          SUM(bos.fees_non_uncommon_rune_mints) AS feesNonUncommonRuneMints,
          SUM(bos.fees_brc20_mints) AS feesBrc20Mints,
          SUM(bos.fees_src20_mints) AS feesSrc20Mints,
          SUM(bos.fees_cat21_mints) AS feesCat21Mints,
          SUM(bos.fees_inscription_mints) AS feesInscriptionMints
        `;
      case 'inscription-sizes':
        return `
          ${baseClause},
          SUM(bos.inscriptions_total_envelope_size) AS totalEnvelopeSize,
          SUM(bos.inscriptions_total_content_size) AS totalContentSize,
          MAX(bos.inscriptions_largest_envelope_size) AS largestEnvelopeSize,
          MAX(bos.inscriptions_largest_content_size) AS largestContentSize,
          AVG(bos.inscriptions_average_envelope_size) AS avgEnvelopeSize,
          AVG(bos.inscriptions_average_content_size) AS avgContentSize
        `;
      default:
        throw new Error('Invalid chart type: ' + type);
    }
  }

  private getGroupByClause(aggregation: Aggregation): string {
    switch (aggregation) {
      case 'hour':
        return `GROUP BY YEAR(b.blockTimestamp), MONTH(b.blockTimestamp), DAY(b.blockTimestamp), HOUR(b.blockTimestamp)`;

      case 'day':
        return `GROUP BY YEAR(b.blockTimestamp), MONTH(b.blockTimestamp), DAY(b.blockTimestamp)`;

      case 'week':
        return `GROUP BY YEAR(b.blockTimestamp), WEEK(b.blockTimestamp)`;

      case 'month':
        return `GROUP BY YEAR(b.blockTimestamp), MONTH(b.blockTimestamp)`;

      case 'year':
        return `GROUP BY YEAR(b.blockTimestamp)`;

      default:
        return `GROUP BY b.blockTimestamp`; // Default to block-level aggregation
    }
  }
}

export default new OrdpoolStatisticsApi();
