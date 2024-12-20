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
    aggregation: Aggregation,
  ): Promise<OrdpoolStatisticResponse[]> {

    const sqlInterval = getSqlInterval(interval);
    const firstInscriptionHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);

    let baseQuery = `FROM blocks b
      LEFT JOIN blocks_ordpool_stats bos ON b.hash = bos.hash
      WHERE b.height >= ${firstInscriptionHeight} `;

    if (sqlInterval) {
      baseQuery += ` AND b.blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${sqlInterval}) `;
    }

    const groupByClause = this.getGroupByClause(aggregation);
    const orderByClause = `ORDER BY b.blockTimestamp DESC`;

    let selectClause = '';
    switch (type) {
      case 'mints':
        selectClause = this.getMintsQuery();
        break;
      case 'new-tokens':
        selectClause = this.getNewTokensQuery();
        break;
      case 'fees':
        selectClause = this.getFeesQuery();
        break;
      case 'inscription-sizes':
        selectClause = this.getInscriptionSizesQuery();
        break;
    }

    const fullQuery = `${selectClause} ${baseQuery} ${groupByClause} ${orderByClause}`;

    try {
      const [rows]: any[] = await DB.query(fullQuery);
      return rows;
    } catch (e) {
      logger.err(`getOrdpoolStatistics error: ${e instanceof Error ? e.message : e}`);
      throw e;
    }
  }

  private getMintsQuery(): string {
    return `
      SELECT
        CAST(SUM(bos.amounts_cat21_mint) AS UNSIGNED) AS cat21Mints,
        CAST(SUM(bos.amounts_inscription_mint) AS UNSIGNED) AS inscriptionMints,
        CAST(SUM(bos.amounts_rune_mint) AS UNSIGNED) AS runeMints,
        CAST(SUM(bos.amounts_brc20_mint) AS UNSIGNED) AS brc20Mints,
        CAST(SUM(bos.amounts_src20_mint) AS UNSIGNED) AS src20Mints
    `;
  }

  private getNewTokensQuery(): string {
    return `
      SELECT
        CAST(SUM(bos.amounts_rune_etch) AS UNSIGNED) AS runeEtchings,
        CAST(SUM(bos.amounts_brc20_deploy) AS UNSIGNED) AS brc20Deploys,
        CAST(SUM(bos.amounts_src20_deploy) AS UNSIGNED) AS src20Deploys
    `;
  }

  private getFeesQuery(): string {
    return `
      SELECT
        CAST(SUM(bos.fees_rune_mints) AS UNSIGNED) AS feesRuneMints,
        CAST(SUM(bos.fees_brc20_mints) AS UNSIGNED) AS feesBrc20Mints,
        CAST(SUM(bos.fees_cat21_mints) AS UNSIGNED) AS feesCat21Mints,
        CAST(SUM(bos.fees_inscription_mints) AS UNSIGNED) AS feesInscriptionMints
    `;
  }

  private getInscriptionSizesQuery(): string {
    return `
      SELECT
        CAST(AVG(bos.inscriptions_total_envelope_size) AS UNSIGNED) AS avgInscriptionsTotalEnvelopeSize,
        CAST(AVG(bos.inscriptions_total_content_size) AS UNSIGNED) AS avgInscriptionsTotalContentSize,
        CAST(MAX(bos.inscriptions_largest_envelope_size) AS UNSIGNED) AS maxInscriptionsLargestEnvelopeSize,
        CAST(MAX(bos.inscriptions_largest_content_size) AS UNSIGNED) AS maxInscriptionsLargestContentSize
    `;
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
