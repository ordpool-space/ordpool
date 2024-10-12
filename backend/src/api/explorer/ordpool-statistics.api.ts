import logger from '../../logger';
import DB from '../../database';
import { Common } from '../common';

class OrdpoolStatisticsApi {

  public async $getOrdpoolStatistics(interval: string | null = null): Promise<any> {
    interval = Common.getSqlInterval(interval);

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
        MAX(inscriptions_largest_content_size)  AS maxInscriptionsLargestContentSize

      FROM blocks
    `;

    if (interval) {
      query += ` WHERE blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${interval})`;
    }

    query += ` GROUP BY blockTimestamp ORDER BY blockTimestamp DESC`;

    try {
      const [rows]: any = await DB.query(query);
      return rows;
    } catch (e) {
      logger.err('$getOrdpoolStatistics error: ' + (e instanceof Error ? e.message : e));
      throw e;
    }
  }

  public async $getOrdpoolStatisticsCount(): Promise<number> {
    try {
      const [rows]: any = await DB.query(`SELECT COUNT(*) as count FROM blocks`);
      return rows[0].count;
    } catch (e) {
      logger.err('$getOrdpoolStatisticsCount error: ' + (e instanceof Error ? e.message : e));
      throw e;
    }
  }
}

export default new OrdpoolStatisticsApi();
