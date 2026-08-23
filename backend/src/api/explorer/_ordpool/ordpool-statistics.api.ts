import { getFirstInscriptionHeight } from 'ordpool-parser';

import config from '../../../config';
import DB from '../../../database';
import logger from '../../../logger';
import { getSqlInterval } from './get-sql-interval';
import ordpoolStatsDaily, { getLiveSelectClause, getRollupSelectClause, getSatelliteRollupRead, rollupGroupBy, SATELLITE_ROLLUPS } from './ordpool-stats-daily';
import { Aggregation, ChartType, Interval, OrdpoolStatisticResponse } from './ordpool-statistics-interface';


class OrdpoolStatisticsApi {

  public async getOrdpoolStatistics(
    type: ChartType,
    interval: Interval,
    aggregation: Aggregation
  ): Promise<OrdpoolStatisticResponse[]> {

    const firstInscriptionHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);
    const sqlInterval = getSqlInterval(interval);

    // Historical day/week/month/year charts read the pre-aggregated daily rollup
    // (milliseconds) instead of re-scanning every block in the window (~27s).
    // block/hour over a long interval is coarsened to day -- block-level over a
    // year is tens of thousands of unreadable points anyway.
    const effectiveAggregation = this.coarsenAggregation(interval, aggregation);
    const useRollup = effectiveAggregation !== 'block' && effectiveAggregation !== 'hour';

    // Satellite-table charts (atomical-ops, counterparty-messages, ots) get the
    // same rollup treatment for day+ aggregation; short block/hour intervals stay
    // on the live per-block breakdown/total query.
    const satellite = SATELLITE_ROLLUPS.find((c) => c.chartType === type);
    if (satellite) {
      const rollupSql = useRollup && await ordpoolStatsDaily.isReady(satellite.rollupTable)
        ? getSatelliteRollupRead(type, sqlInterval, effectiveAggregation)
        : null;
      if (rollupSql) {
        try {
          const [rows]: any[] = await DB.query(rollupSql);
          return rows;
        } catch (error) {
          logger.err(`Error executing satellite rollup query: ${error}`, 'Ordpool');
          throw error;
        }
      }
      if (type === 'atomical-ops') {
        return this.getSatelliteBreakdown(firstInscriptionHeight, sqlInterval, aggregation,
          'ordpool_stats_atomical_op', 'sat.operation', 'operation');
      }
      if (type === 'counterparty-messages') {
        return this.getSatelliteBreakdown(firstInscriptionHeight, sqlInterval, aggregation,
          'ordpool_stats_counterparty', 'sat.message_type', 'messageType');
      }
      // ordpool_stats_ots only carries confirmed-by-block rows once the poller's
      // confirm step fills in blockhash/blockheight; pending rows (NULL blockhash)
      // are filtered by the INNER JOIN.
      return this.getSatelliteTotal(firstInscriptionHeight, sqlInterval, aggregation, 'ordpool_stats_ots');
    }

    if (useRollup && await ordpoolStatsDaily.isReady()) {
      return this.getFromRollup(type, sqlInterval, effectiveAggregation);
    }

    const query = `
      SELECT ${getLiveSelectClause(type)}
      FROM blocks b
      LEFT JOIN ordpool_stats bos ON b.hash = bos.hash
      WHERE b.height >= ${firstInscriptionHeight}
        AND b.blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${sqlInterval})
      ${this.getGroupByClause(aggregation)}
      ORDER BY b.blockTimestamp DESC
    `;

    try {
      const [rows] : any[] = await DB.query(query);
      return rows;
    } catch (error) {
      logger.err(`Error executing query: ${error}`, 'Ordpool');
      throw error;
    }
  }

  /** Read a main (non-satellite) chart from the daily rollup: a GROUP BY over
   *  ~700 immutable daily rows, indexed, no temp-table scan over 100k+ blocks. */
  private async getFromRollup(
    type: ChartType,
    sqlInterval: string,
    aggregation: Aggregation,
  ): Promise<OrdpoolStatisticResponse[]> {
    const query = `
      SELECT ${getRollupSelectClause(type)}
      FROM ordpool_stats_daily d
      WHERE d.day >= DATE_SUB(CURDATE(), INTERVAL ${sqlInterval})
      ${rollupGroupBy(aggregation)}
      ORDER BY minTime DESC
    `;
    try {
      const [rows]: any[] = await DB.query(query);
      return rows;
    } catch (error) {
      logger.err(`Error executing rollup query: ${error}`, 'Ordpool');
      throw error;
    }
  }

  /** block/hour aggregation over a long interval produces thousands of
   *  unreadable points and a slow scan; coarsen to day past a small budget so
   *  those requests serve fast from the rollup instead. */
  private coarsenAggregation(interval: Interval, aggregation: Aggregation): Aggregation {
    if (aggregation !== 'block' && aggregation !== 'hour') {
      return aggregation;
    }
    const days = this.intervalToDays(interval);
    if (aggregation === 'block' && days > 2) {
      return 'day';
    }
    if (aggregation === 'hour' && days > 14) {
      return 'day';
    }
    return aggregation;
  }

  private intervalToDays(interval: Interval): number {
    const m = /^(\d+)([hwdmy])$/.exec(interval);
    if (!m) {
      return 0;
    }
    const n = parseInt(m[1], 10);
    switch (m[2]) {
      case 'h': return n / 24;
      case 'd': return n;
      case 'w': return n * 7;
      case 'm': return n * 30;
      case 'y': return n * 365;
      default: return 0;
    }
  }

  /** Per-discriminator breakdown for charts whose data lives in a satellite
   *  table (atomical-ops, counterparty-messages). Each chart has one row per
   *  (period, discriminator) combination — one ECharts series per distinct
   *  discriminator value. Examples:
   *    atomical-ops          → discriminator = sat.operation
   *    counterparty-messages → discriminator = sat.message_type   */
  /** Single-series total per period from a satellite table (no discriminator
   *  column). Used by the `ots` chart -- one COUNT(*) per period. The
   *  satellite is joined on `sat.blockhash = b.hash`; rows whose blockhash
   *  is NULL (i.e. still pending, not yet confirmed) are filtered by the
   *  INNER JOIN. */
  private async getSatelliteTotal(
    firstInscriptionHeight: number,
    sqlInterval: string,
    aggregation: Aggregation,
    satelliteTable: string,
  ): Promise<OrdpoolStatisticResponse[]> {
    const groupByTime = this.getGroupByClause(aggregation).replace(/^GROUP BY/, '');
    const query = `
      SELECT
        MIN(b.height) AS minHeight,
        MAX(b.height) AS maxHeight,
        MIN(UNIX_TIMESTAMP(b.blockTimestamp)) AS minTime,
        MAX(UNIX_TIMESTAMP(b.blockTimestamp)) AS maxTime,
        COUNT(*) AS count
      FROM blocks b
      JOIN ${satelliteTable} sat ON sat.blockhash = b.hash
      WHERE b.height >= ${firstInscriptionHeight}
        AND b.blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${sqlInterval})
      GROUP BY ${groupByTime}
      ORDER BY b.blockTimestamp DESC
    `;
    try {
      const [rows]: any[] = await DB.query(query);
      return rows;
    } catch (error) {
      logger.err(`Error executing ${satelliteTable} total query: ${error}`, 'Ordpool');
      throw error;
    }
  }

  private async getSatelliteBreakdown(
    firstInscriptionHeight: number,
    sqlInterval: string,
    aggregation: Aggregation,
    satelliteTable: string,
    discriminatorCol: string,
    discriminatorAlias: string,
  ): Promise<OrdpoolStatisticResponse[]> {
    // Strip the leading 'GROUP BY' so we can append our discriminator column.
    const groupByTime = this.getGroupByClause(aggregation).replace(/^GROUP BY/, '');
    const query = `
      SELECT
        MIN(b.height) AS minHeight,
        MAX(b.height) AS maxHeight,
        MIN(UNIX_TIMESTAMP(b.blockTimestamp)) AS minTime,
        MAX(UNIX_TIMESTAMP(b.blockTimestamp)) AS maxTime,
        ${discriminatorCol} AS ${discriminatorAlias},
        COUNT(*) AS count
      FROM blocks b
      JOIN ${satelliteTable} sat ON sat.hash = b.hash
      WHERE b.height >= ${firstInscriptionHeight}
        AND b.blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${sqlInterval})
      GROUP BY ${groupByTime}, ${discriminatorCol}
      ORDER BY b.blockTimestamp DESC
    `;
    try {
      const [rows] : any[] = await DB.query(query);
      return rows;
    } catch (error) {
      logger.err(`Error executing ${satelliteTable} breakdown query: ${error}`, 'Ordpool');
      throw error;
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
