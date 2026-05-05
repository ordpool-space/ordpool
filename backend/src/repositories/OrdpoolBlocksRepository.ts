import {
  Cat21Mint,
  compactToBrc20DeployAttempts,
  compactToMinimalCat21Mints,
  compactToMintActivity,
  compactToRuneEtchAttempts,
  compactToSrc20DeployAttempts,
  getFirstInscriptionHeight,
  OrdpoolStats,
  sanitizeU128,
  sanitizeU64,
  sanitizeU8,
  traitsToCompactColors,
} from 'ordpool-parser';

import DB from '../database';
import logger from '../logger';
import config from '../config';


export interface OrdpoolDatabaseBlock {
  id: string;
  height: number;

  amountsAtomical: number;
  amountsAtomicalMint: number;
  amountsAtomicalUpdate: number;

  amountsCounterparty: number;
  amountsStamp: number;
  amountsSrc721: number;
  amountsSrc101: number;

  amountsCat21: number;
  amountsCat21Mint: number;

  amountsInscription: number;
  amountsInscriptionMint: number;
  amountsInscriptionImage: number;
  amountsInscriptionText: number;
  amountsInscriptionJson: number;

  amountsRune: number;
  amountsRuneEtch: number;
  amountsRuneMint: number;
  amountsRuneCenotaph: number;

  amountsBrc20: number;
  amountsBrc20Deploy: number;
  amountsBrc20Mint: number;
  amountsBrc20Transfer: number;

  amountsSrc20: number;
  amountsSrc20Deploy: number;
  amountsSrc20Mint: number;
  amountsSrc20Transfer: number;

  feesRuneMints: number;
  feesNonUncommonRuneMints: number;
  feesBrc20Mints: number;
  feesSrc20Mints: number;
  feesCat21Mints: number;
  feesAtomicals: number;
  feesInscriptionMints: number;
  feesInscriptionImageMints: number;
  feesInscriptionTextMints: number;
  feesInscriptionJsonMints: number;

  inscriptionsTotalEnvelopeSize: number;
  inscriptionsTotalContentSize: number;
  inscriptionsLargestEnvelopeSize: number;
  inscriptionsLargestContentSize: number;
  inscriptionsLargestEnvelopeInscriptionId: string | null;
  inscriptionsLargestContentInscriptionId: string | null;
  inscriptionsAverageEnvelopeSize: number;
  inscriptionsAverageContentSize: number;

  // Per-content-type inscription size aggregates (image bucket)
  inscriptionsImageTotalEnvelopeSize: number;
  inscriptionsImageTotalContentSize: number;
  inscriptionsImageLargestEnvelopeSize: number;
  inscriptionsImageLargestContentSize: number;
  inscriptionsImageLargestEnvelopeInscriptionId: string | null;
  inscriptionsImageLargestContentInscriptionId: string | null;
  inscriptionsImageAverageEnvelopeSize: number;
  inscriptionsImageAverageContentSize: number;

  // Text bucket
  inscriptionsTextTotalEnvelopeSize: number;
  inscriptionsTextTotalContentSize: number;
  inscriptionsTextLargestEnvelopeSize: number;
  inscriptionsTextLargestContentSize: number;
  inscriptionsTextLargestEnvelopeInscriptionId: string | null;
  inscriptionsTextLargestContentInscriptionId: string | null;
  inscriptionsTextAverageEnvelopeSize: number;
  inscriptionsTextAverageContentSize: number;

  // JSON bucket
  inscriptionsJsonTotalEnvelopeSize: number;
  inscriptionsJsonTotalContentSize: number;
  inscriptionsJsonLargestEnvelopeSize: number;
  inscriptionsJsonLargestContentSize: number;
  inscriptionsJsonLargestEnvelopeInscriptionId: string | null;
  inscriptionsJsonLargestContentInscriptionId: string | null;
  inscriptionsJsonAverageEnvelopeSize: number;
  inscriptionsJsonAverageContentSize: number;

  // Compression telemetry
  inscriptionsBrotliCount: number;
  inscriptionsGzipCount: number;
  inscriptionsCompressedEnvelopeBytes: number;

  // CAT-21 block-level aggregates
  cat21GenesisCount: number;
  cat21AvgFeeRate: number | null;
  cat21MinFeeRate: number | null;
  cat21MaxFeeRate: number | null;

  // Rune block-level aggregates (with UNCOMMON•GOODS split)
  runesUniqueMintsCount: number;
  runesUniqueMintsCountNonUncommon: number;
  runesTopMintCount: number;
  runesTopMintCountNonUncommon: number;

  runesMostActiveMint: string | null;
  runesMostActiveNonUncommonMint: string | null;
  brc20MostActiveMint: string | null;
  src20MostActiveMint: string | null;

  analyserVersion: number;

  runeMintActivity: string;
  brc20MintActivity: string;
  src20MintActivity: string;
  cat21MintActivity: string;

  runeEtchAttempts: string;
  brc20DeployAttempts: string;
  src20DeployAttempts: string;
  atomicalOps: string;
  counterpartyMessages: string;
}

export const ORDPOOL_BLOCK_DB_FIELDS = `

  /* HACK -- Ordpool stats */
  ordpool_stats.amounts_atomical                             AS amountsAtomical,
  ordpool_stats.amounts_atomical_mint                        AS amountsAtomicalMint,
  ordpool_stats.amounts_atomical_update                      AS amountsAtomicalUpdate,

  ordpool_stats.amounts_counterparty                         AS amountsCounterparty,
  ordpool_stats.amounts_stamp                                AS amountsStamp,
  ordpool_stats.amounts_src721                               AS amountsSrc721,
  ordpool_stats.amounts_src101                               AS amountsSrc101,

  ordpool_stats.amounts_cat21                                AS amountsCat21,
  ordpool_stats.amounts_cat21_mint                           AS amountsCat21Mint,

  ordpool_stats.amounts_inscription                          AS amountsInscription,
  ordpool_stats.amounts_inscription_mint                     AS amountsInscriptionMint,
  ordpool_stats.amounts_inscription_image                    AS amountsInscriptionImage,
  ordpool_stats.amounts_inscription_text                     AS amountsInscriptionText,
  ordpool_stats.amounts_inscription_json                     AS amountsInscriptionJson,

  ordpool_stats.amounts_rune                                 AS amountsRune,
  ordpool_stats.amounts_rune_etch                            AS amountsRuneEtch,
  ordpool_stats.amounts_rune_mint                            AS amountsRuneMint,
  ordpool_stats.amounts_rune_cenotaph                        AS amountsRuneCenotaph,

  ordpool_stats.amounts_brc20                                AS amountsBrc20,
  ordpool_stats.amounts_brc20_deploy                         AS amountsBrc20Deploy,
  ordpool_stats.amounts_brc20_mint                           AS amountsBrc20Mint,
  ordpool_stats.amounts_brc20_transfer                       AS amountsBrc20Transfer,

  ordpool_stats.amounts_src20                                AS amountsSrc20,
  ordpool_stats.amounts_src20_deploy                         AS amountsSrc20Deploy,
  ordpool_stats.amounts_src20_mint                           AS amountsSrc20Mint,
  ordpool_stats.amounts_src20_transfer                       AS amountsSrc20Transfer,

  ordpool_stats.fees_rune_mints                              AS feesRuneMints,
  ordpool_stats.fees_non_uncommon_rune_mints                 AS feesNonUncommonRuneMints,
  ordpool_stats.fees_brc20_mints                             AS feesBrc20Mints,
  ordpool_stats.fees_src20_mints                             AS feesSrc20Mints,
  ordpool_stats.fees_cat21_mints                             AS feesCat21Mints,
  ordpool_stats.fees_atomicals                               AS feesAtomicals,
  ordpool_stats.fees_inscription_mints                       AS feesInscriptionMints,
  ordpool_stats.fees_inscription_image_mints                 AS feesInscriptionImageMints,
  ordpool_stats.fees_inscription_text_mints                  AS feesInscriptionTextMints,
  ordpool_stats.fees_inscription_json_mints                  AS feesInscriptionJsonMints,

  ordpool_stats.inscriptions_total_envelope_size             AS inscriptionsTotalEnvelopeSize,
  ordpool_stats.inscriptions_total_content_size              AS inscriptionsTotalContentSize,
  ordpool_stats.inscriptions_largest_envelope_size           AS inscriptionsLargestEnvelopeSize,
  ordpool_stats.inscriptions_largest_content_size            AS inscriptionsLargestContentSize,
  ordpool_stats.inscriptions_largest_envelope_inscription_id AS inscriptionsLargestEnvelopeInscriptionId,
  ordpool_stats.inscriptions_largest_content_inscription_id  AS inscriptionsLargestContentInscriptionId,
  ordpool_stats.inscriptions_average_envelope_size           AS inscriptionsAverageEnvelopeSize,
  ordpool_stats.inscriptions_average_content_size            AS inscriptionsAverageContentSize,

  /* per-content-type inscription size aggregates */
  ordpool_stats.inscriptions_image_total_envelope_size              AS inscriptionsImageTotalEnvelopeSize,
  ordpool_stats.inscriptions_image_total_content_size               AS inscriptionsImageTotalContentSize,
  ordpool_stats.inscriptions_image_largest_envelope_size            AS inscriptionsImageLargestEnvelopeSize,
  ordpool_stats.inscriptions_image_largest_content_size             AS inscriptionsImageLargestContentSize,
  ordpool_stats.inscriptions_image_largest_envelope_inscription_id  AS inscriptionsImageLargestEnvelopeInscriptionId,
  ordpool_stats.inscriptions_image_largest_content_inscription_id   AS inscriptionsImageLargestContentInscriptionId,
  ordpool_stats.inscriptions_image_average_envelope_size            AS inscriptionsImageAverageEnvelopeSize,
  ordpool_stats.inscriptions_image_average_content_size             AS inscriptionsImageAverageContentSize,

  ordpool_stats.inscriptions_text_total_envelope_size               AS inscriptionsTextTotalEnvelopeSize,
  ordpool_stats.inscriptions_text_total_content_size                AS inscriptionsTextTotalContentSize,
  ordpool_stats.inscriptions_text_largest_envelope_size             AS inscriptionsTextLargestEnvelopeSize,
  ordpool_stats.inscriptions_text_largest_content_size              AS inscriptionsTextLargestContentSize,
  ordpool_stats.inscriptions_text_largest_envelope_inscription_id   AS inscriptionsTextLargestEnvelopeInscriptionId,
  ordpool_stats.inscriptions_text_largest_content_inscription_id    AS inscriptionsTextLargestContentInscriptionId,
  ordpool_stats.inscriptions_text_average_envelope_size             AS inscriptionsTextAverageEnvelopeSize,
  ordpool_stats.inscriptions_text_average_content_size              AS inscriptionsTextAverageContentSize,

  ordpool_stats.inscriptions_json_total_envelope_size               AS inscriptionsJsonTotalEnvelopeSize,
  ordpool_stats.inscriptions_json_total_content_size                AS inscriptionsJsonTotalContentSize,
  ordpool_stats.inscriptions_json_largest_envelope_size             AS inscriptionsJsonLargestEnvelopeSize,
  ordpool_stats.inscriptions_json_largest_content_size              AS inscriptionsJsonLargestContentSize,
  ordpool_stats.inscriptions_json_largest_envelope_inscription_id   AS inscriptionsJsonLargestEnvelopeInscriptionId,
  ordpool_stats.inscriptions_json_largest_content_inscription_id    AS inscriptionsJsonLargestContentInscriptionId,
  ordpool_stats.inscriptions_json_average_envelope_size             AS inscriptionsJsonAverageEnvelopeSize,
  ordpool_stats.inscriptions_json_average_content_size              AS inscriptionsJsonAverageContentSize,

  /* compression telemetry */
  ordpool_stats.inscriptions_brotli_count                  AS inscriptionsBrotliCount,
  ordpool_stats.inscriptions_gzip_count                    AS inscriptionsGzipCount,
  ordpool_stats.inscriptions_compressed_envelope_bytes     AS inscriptionsCompressedEnvelopeBytes,

  /* CAT-21 block-level aggregates */
  ordpool_stats.cat21_genesis_count                        AS cat21GenesisCount,
  ordpool_stats.cat21_avg_fee_rate                         AS cat21AvgFeeRate,
  ordpool_stats.cat21_min_fee_rate                         AS cat21MinFeeRate,
  ordpool_stats.cat21_max_fee_rate                         AS cat21MaxFeeRate,

  /* Rune block-level aggregates (with UNCOMMON•GOODS split) */
  ordpool_stats.runes_unique_mints_count                   AS runesUniqueMintsCount,
  ordpool_stats.runes_unique_mints_count_non_uncommon      AS runesUniqueMintsCountNonUncommon,
  ordpool_stats.runes_top_mint_count                       AS runesTopMintCount,
  ordpool_stats.runes_top_mint_count_non_uncommon          AS runesTopMintCountNonUncommon,

  ordpool_stats.runes_most_active_mint                       AS runesMostActiveMint,
  ordpool_stats.runes_most_active_non_uncommon_mint          AS runesMostActiveNonUncommonMint,
  ordpool_stats.brc20_most_active_mint                       AS brc20MostActiveMint,
  ordpool_stats.src20_most_active_mint                       AS src20MostActiveMint,

  ordpool_stats.analyser_version                             AS analyserVersion,

  -- Mint Activities
  GROUP_CONCAT(DISTINCT CONCAT(rune_mint.identifier, ',',  rune_mint.count)  ORDER BY rune_mint.count DESC) AS runeMintActivity,
  GROUP_CONCAT(DISTINCT CONCAT(brc20_mint.identifier, ',', brc20_mint.count) ORDER BY brc20_mint.count DESC) AS brc20MintActivity,
  GROUP_CONCAT(DISTINCT CONCAT(src20_mint.identifier, ',', src20_mint.count) ORDER BY src20_mint.count DESC) AS src20MintActivity,

  GROUP_CONCAT(
    DISTINCT CONCAT(
      cat21_mint.txid, '|',
      cat21_mint.fee, '|',
      cat21_mint.weight
    ) SEPARATOR ','
  ) AS cat21MintActivity,

  -- Etch/Deploy Attempts
  GROUP_CONCAT(
    DISTINCT CONCAT(
      rune_etch.txid,                       '|', --  1
      rune_etch.rune_id,                    '|', --  2
      COALESCE(rune_etch.rune_name, ''),    '|', --  3
      COALESCE(rune_etch.divisibility, ''), '|', --  4
      COALESCE(rune_etch.premine, ''),      '|', --  5
      COALESCE(rune_etch.symbol, ''),       '|', --  6
      COALESCE(rune_etch.cap, ''),          '|', --  7
      COALESCE(rune_etch.amount, ''),       '|', --  8
      COALESCE(rune_etch.offset_start, ''), '|', --  9
      COALESCE(rune_etch.offset_end, ''),   '|', -- 10
      COALESCE(rune_etch.height_start, ''), '|', -- 11
      COALESCE(rune_etch.height_end, ''),   '|', -- 12
      IF(rune_etch.turbo, '1', '')               -- 13
    )
  ) AS runeEtchAttempts,

  GROUP_CONCAT(
    DISTINCT CONCAT(
      COALESCE(brc20_deploy.txid, ''),       '|',
      COALESCE(brc20_deploy.ticker, ''),     '|',
      COALESCE(brc20_deploy.max_supply, ''), '|',
      COALESCE(brc20_deploy.mint_limit, ''), '|',
      COALESCE(brc20_deploy.decimals, '')
    )
  ) AS brc20DeployAttempts,

  GROUP_CONCAT(
    DISTINCT CONCAT(
      COALESCE(src20_deploy.txid, ''),       '|',
      COALESCE(src20_deploy.ticker, ''),     '|',
      COALESCE(src20_deploy.max_supply, ''), '|',
      COALESCE(src20_deploy.mint_limit, ''), '|',
      COALESCE(src20_deploy.decimals, '')
    )
  ) AS src20DeployAttempts
`;


class OrdpoolBlocksRepository {
  /**
   * Save indexed block data in the database
   */
  public async saveBlockOrdpoolStatsInDatabase(block: {
    id: string,
    height: number,
    extras: {
      ordpoolStats: OrdpoolStats
    }
  }): Promise<void> {

    if (!block.extras.ordpoolStats) {
      return;
    }

    try {

      await this.saveTokenActivity(block.id, block.height, block.extras.ordpoolStats);

      const query = `INSERT INTO ordpool_stats(
        hash,
        height,

        amounts_atomical,
        amounts_atomical_mint,
        amounts_atomical_update,

        amounts_counterparty,
        amounts_stamp,
        amounts_src721,
        amounts_src101,

        amounts_cat21,
        amounts_cat21_mint,

        amounts_inscription,
        amounts_inscription_mint,
        amounts_inscription_image,
        amounts_inscription_text,
        amounts_inscription_json,

        amounts_rune,
        amounts_rune_etch,
        amounts_rune_mint,
        amounts_rune_cenotaph,

        amounts_brc20,
        amounts_brc20_deploy,
        amounts_brc20_mint,
        amounts_brc20_transfer,

        amounts_src20,
        amounts_src20_deploy,
        amounts_src20_mint,
        amounts_src20_transfer,

        fees_rune_mints,
        fees_non_uncommon_rune_mints,
        fees_brc20_mints,
        fees_src20_mints,
        fees_cat21_mints,
        fees_atomicals,
        fees_inscription_mints,
        fees_inscription_image_mints,
        fees_inscription_text_mints,
        fees_inscription_json_mints,

        inscriptions_total_envelope_size,
        inscriptions_total_content_size,
        inscriptions_largest_envelope_size,
        inscriptions_largest_content_size,
        inscriptions_largest_envelope_inscription_id,
        inscriptions_largest_content_inscription_id,
        inscriptions_average_envelope_size,
        inscriptions_average_content_size,

        inscriptions_image_total_envelope_size,
        inscriptions_image_total_content_size,
        inscriptions_image_largest_envelope_size,
        inscriptions_image_largest_content_size,
        inscriptions_image_largest_envelope_inscription_id,
        inscriptions_image_largest_content_inscription_id,
        inscriptions_image_average_envelope_size,
        inscriptions_image_average_content_size,

        inscriptions_text_total_envelope_size,
        inscriptions_text_total_content_size,
        inscriptions_text_largest_envelope_size,
        inscriptions_text_largest_content_size,
        inscriptions_text_largest_envelope_inscription_id,
        inscriptions_text_largest_content_inscription_id,
        inscriptions_text_average_envelope_size,
        inscriptions_text_average_content_size,

        inscriptions_json_total_envelope_size,
        inscriptions_json_total_content_size,
        inscriptions_json_largest_envelope_size,
        inscriptions_json_largest_content_size,
        inscriptions_json_largest_envelope_inscription_id,
        inscriptions_json_largest_content_inscription_id,
        inscriptions_json_average_envelope_size,
        inscriptions_json_average_content_size,

        inscriptions_brotli_count,
        inscriptions_gzip_count,
        inscriptions_compressed_envelope_bytes,

        cat21_genesis_count,
        cat21_avg_fee_rate,
        cat21_min_fee_rate,
        cat21_max_fee_rate,

        runes_unique_mints_count,
        runes_unique_mints_count_non_uncommon,
        runes_top_mint_count,
        runes_top_mint_count_non_uncommon,

        runes_most_active_mint,
        runes_most_active_non_uncommon_mint,
        brc20_most_active_mint,
        src20_most_active_mint,

        analyser_version

      ) VALUE (
        ?,  /* hash */
        ?,  /* height */

        ?,  /* amounts_atomical */
        ?,  /* amounts_atomical_mint */
        ?,  /* amounts_atomical_update */

        ?,  /* amounts_counterparty */
        ?,  /* amounts_stamp */
        ?,  /* amounts_src721 */
        ?,  /* amounts_src101 */

        ?,  /* amounts_cat21 */
        ?,  /* amounts_cat21_mint */

        ?,  /* amounts_inscription */
        ?,  /* amounts_inscription_mint */
        ?,  /* amounts_inscription_image */
        ?,  /* amounts_inscription_text */
        ?,  /* amounts_inscription_json */

        ?,  /* amounts_rune */
        ?,  /* amounts_rune_etch */
        ?,  /* amounts_rune_mint */
        ?,  /* amounts_rune_cenotaph */

        ?,  /* amounts_brc20 */
        ?,  /* amounts_brc20_deploy */
        ?,  /* amounts_brc20_mint */
        ?,  /* amounts_brc20_transfer */

        ?,  /* amounts_src20 */
        ?,  /* amounts_src20_deploy */
        ?,  /* amounts_src20_mint */
        ?,  /* amounts_src20_transfer */

        ?,  /* fees_rune_mints */
        ?,  /* fees_non_uncommon_rune_mints */
        ?,  /* fees_brc20_mints */
        ?,  /* fees_src20_mints */
        ?,  /* fees_cat21_mints */
        ?,  /* fees_atomicals */
        ?,  /* fees_inscription_mints */
        ?,  /* fees_inscription_image_mints */
        ?,  /* fees_inscription_text_mints */
        ?,  /* fees_inscription_json_mints */

        ?,  /* inscriptions_total_envelope_size */
        ?,  /* inscriptions_total_content_size */
        ?,  /* inscriptions_largest_envelope_size */
        ?,  /* inscriptions_largest_content_size */
        ?,  /* inscriptions_largest_envelope_inscription_id */
        ?,  /* inscriptions_largest_content_inscription_id */
        ?,  /* inscriptions_average_envelope_size */
        ?,  /* inscriptions_average_content_size */

        ?,  /* inscriptions_image_total_envelope_size */
        ?,  /* inscriptions_image_total_content_size */
        ?,  /* inscriptions_image_largest_envelope_size */
        ?,  /* inscriptions_image_largest_content_size */
        ?,  /* inscriptions_image_largest_envelope_inscription_id */
        ?,  /* inscriptions_image_largest_content_inscription_id */
        ?,  /* inscriptions_image_average_envelope_size */
        ?,  /* inscriptions_image_average_content_size */

        ?,  /* inscriptions_text_total_envelope_size */
        ?,  /* inscriptions_text_total_content_size */
        ?,  /* inscriptions_text_largest_envelope_size */
        ?,  /* inscriptions_text_largest_content_size */
        ?,  /* inscriptions_text_largest_envelope_inscription_id */
        ?,  /* inscriptions_text_largest_content_inscription_id */
        ?,  /* inscriptions_text_average_envelope_size */
        ?,  /* inscriptions_text_average_content_size */

        ?,  /* inscriptions_json_total_envelope_size */
        ?,  /* inscriptions_json_total_content_size */
        ?,  /* inscriptions_json_largest_envelope_size */
        ?,  /* inscriptions_json_largest_content_size */
        ?,  /* inscriptions_json_largest_envelope_inscription_id */
        ?,  /* inscriptions_json_largest_content_inscription_id */
        ?,  /* inscriptions_json_average_envelope_size */
        ?,  /* inscriptions_json_average_content_size */

        ?,  /* inscriptions_brotli_count */
        ?,  /* inscriptions_gzip_count */
        ?,  /* inscriptions_compressed_envelope_bytes */

        ?,  /* cat21_genesis_count */
        ?,  /* cat21_avg_fee_rate */
        ?,  /* cat21_min_fee_rate */
        ?,  /* cat21_max_fee_rate */

        ?,  /* runes_unique_mints_count */
        ?,  /* runes_unique_mints_count_non_uncommon */
        ?,  /* runes_top_mint_count */
        ?,  /* runes_top_mint_count_non_uncommon */

        LEFT(?, 20),  /* runes_most_active_mint */
        LEFT(?, 20),  /* runes_most_active_non_uncommon_mint */
        LEFT(?, 20),  /* brc20_most_active_mint */
        LEFT(?, 20),  /* src20_most_active_mint */

        ?   /* analyser_version */
      )`;

      const stats = block.extras.ordpoolStats;
      const ins = stats.inscriptions;

      const params: any[] = [
        block.id,
        block.height,

        stats.amounts.atomical,
        stats.amounts.atomicalMint,
        stats.amounts.atomicalUpdate,

        stats.amounts.counterparty,
        stats.amounts.stamp,
        stats.amounts.src721,
        stats.amounts.src101,

        stats.amounts.cat21,
        stats.amounts.cat21Mint,

        stats.amounts.inscription,
        stats.amounts.inscriptionMint,
        stats.amounts.inscriptionImage,
        stats.amounts.inscriptionText,
        stats.amounts.inscriptionJson,

        stats.amounts.rune,
        stats.amounts.runeEtch,
        stats.amounts.runeMint,
        stats.amounts.runeCenotaph,

        stats.amounts.brc20,
        stats.amounts.brc20Deploy,
        stats.amounts.brc20Mint,
        stats.amounts.brc20Transfer,

        stats.amounts.src20,
        stats.amounts.src20Deploy,
        stats.amounts.src20Mint,
        stats.amounts.src20Transfer,

        stats.fees.runeMints,
        stats.fees.nonUncommonRuneMints,
        stats.fees.brc20Mints,
        stats.fees.src20Mints,
        stats.fees.cat21Mints,
        stats.fees.atomicals,
        stats.fees.inscriptionMints,
        stats.fees.inscriptionImageMints,
        stats.fees.inscriptionTextMints,
        stats.fees.inscriptionJsonMints,

        ins.totalEnvelopeSize,
        ins.totalContentSize,
        ins.largestEnvelopeSize,
        ins.largestContentSize,
        ins.largestEnvelopeInscriptionId,
        ins.largestContentInscriptionId,
        ins.averageEnvelopeSize,
        ins.averageContentSize,

        ins.image.totalEnvelopeSize,
        ins.image.totalContentSize,
        ins.image.largestEnvelopeSize,
        ins.image.largestContentSize,
        ins.image.largestEnvelopeInscriptionId,
        ins.image.largestContentInscriptionId,
        ins.image.averageEnvelopeSize,
        ins.image.averageContentSize,

        ins.text.totalEnvelopeSize,
        ins.text.totalContentSize,
        ins.text.largestEnvelopeSize,
        ins.text.largestContentSize,
        ins.text.largestEnvelopeInscriptionId,
        ins.text.largestContentInscriptionId,
        ins.text.averageEnvelopeSize,
        ins.text.averageContentSize,

        ins.json.totalEnvelopeSize,
        ins.json.totalContentSize,
        ins.json.largestEnvelopeSize,
        ins.json.largestContentSize,
        ins.json.largestEnvelopeInscriptionId,
        ins.json.largestContentInscriptionId,
        ins.json.averageEnvelopeSize,
        ins.json.averageContentSize,

        ins.brotliCount,
        ins.gzipCount,
        ins.compressedEnvelopeBytes,

        stats.cat21.genesisCount,
        stats.cat21.avgFeeRate,
        stats.cat21.minFeeRate,
        stats.cat21.maxFeeRate,

        stats.runes.uniqueMintsCount,
        stats.runes.uniqueMintsCountNonUncommon,
        stats.runes.topMintCount,
        stats.runes.topMintCountNonUncommon,

        stats.runes.mostActiveMint,
        stats.runes.mostActiveNonUncommonMint,
        stats.brc20.mostActiveMint,
        stats.src20.mostActiveMint,

        stats.version
      ];

      await DB.query(query, params, 'silent');

      logger.debug(`$saveBlockOrdpoolStatsInDatabase() - Block ${block.height} successfully stored!`, 'Ordpool');

    } catch (e: any) {
      if (e.errno === 1062) {
        logger.debug(`$saveBlockOrdpoolStatsInDatabase() - Block ${block.height} has already been indexed, ignoring`, 'Ordpool');
      } else {
        logger.err('Cannot save indexed block into ordpool_stats. Reason: ' + (e instanceof Error ? e.message : e), 'Ordpool');
        throw e;
      }
    }
  }

  public formatDbBlockIntoOrdpoolStats(dbBlk: OrdpoolDatabaseBlock): OrdpoolStats | undefined {

    if (!dbBlk.analyserVersion) {
      return undefined;
    }

    return {
      amounts: {
        atomical: dbBlk.amountsAtomical,
        atomicalMint: dbBlk.amountsAtomicalMint,
        atomicalUpdate: dbBlk.amountsAtomicalUpdate,

        counterparty: dbBlk.amountsCounterparty,
        stamp: dbBlk.amountsStamp,
        src721: dbBlk.amountsSrc721,
        src101: dbBlk.amountsSrc101,

        cat21: dbBlk.amountsCat21,
        cat21Mint: dbBlk.amountsCat21Mint,

        inscription: dbBlk.amountsInscription,
        inscriptionMint: dbBlk.amountsInscriptionMint,
        inscriptionImage: dbBlk.amountsInscriptionImage,
        inscriptionText: dbBlk.amountsInscriptionText,
        inscriptionJson: dbBlk.amountsInscriptionJson,

        rune: dbBlk.amountsRune,
        runeEtch: dbBlk.amountsRuneEtch,
        runeMint: dbBlk.amountsRuneMint,
        runeCenotaph: dbBlk.amountsRuneCenotaph,

        brc20: dbBlk.amountsBrc20,
        brc20Deploy: dbBlk.amountsBrc20Deploy,
        brc20Mint: dbBlk.amountsBrc20Mint,
        brc20Transfer: dbBlk.amountsBrc20Transfer,

        src20: dbBlk.amountsSrc20,
        src20Deploy: dbBlk.amountsSrc20Deploy,
        src20Mint: dbBlk.amountsSrc20Mint,
        src20Transfer: dbBlk.amountsSrc20Transfer
      },
      fees: {
        runeMints: dbBlk.feesRuneMints,
        nonUncommonRuneMints: dbBlk.feesNonUncommonRuneMints,
        brc20Mints: dbBlk.feesBrc20Mints,
        src20Mints: dbBlk.feesSrc20Mints,
        cat21Mints: dbBlk.feesCat21Mints,
        atomicals: dbBlk.feesAtomicals,
        inscriptionMints: dbBlk.feesInscriptionMints,
        inscriptionImageMints: dbBlk.feesInscriptionImageMints,
        inscriptionTextMints: dbBlk.feesInscriptionTextMints,
        inscriptionJsonMints: dbBlk.feesInscriptionJsonMints,
      },
      inscriptions: {
        totalEnvelopeSize: dbBlk.inscriptionsTotalEnvelopeSize,
        totalContentSize: dbBlk.inscriptionsTotalContentSize,
        largestEnvelopeSize: dbBlk.inscriptionsLargestEnvelopeSize,
        largestContentSize: dbBlk.inscriptionsLargestContentSize,
        largestEnvelopeInscriptionId: dbBlk.inscriptionsLargestEnvelopeInscriptionId,
        largestContentInscriptionId: dbBlk.inscriptionsLargestContentInscriptionId,
        averageEnvelopeSize: dbBlk.inscriptionsAverageEnvelopeSize,
        averageContentSize: dbBlk.inscriptionsAverageContentSize,

        image: {
          totalEnvelopeSize: dbBlk.inscriptionsImageTotalEnvelopeSize,
          totalContentSize: dbBlk.inscriptionsImageTotalContentSize,
          largestEnvelopeSize: dbBlk.inscriptionsImageLargestEnvelopeSize,
          largestContentSize: dbBlk.inscriptionsImageLargestContentSize,
          largestEnvelopeInscriptionId: dbBlk.inscriptionsImageLargestEnvelopeInscriptionId,
          largestContentInscriptionId: dbBlk.inscriptionsImageLargestContentInscriptionId,
          averageEnvelopeSize: dbBlk.inscriptionsImageAverageEnvelopeSize,
          averageContentSize: dbBlk.inscriptionsImageAverageContentSize,
        },
        text: {
          totalEnvelopeSize: dbBlk.inscriptionsTextTotalEnvelopeSize,
          totalContentSize: dbBlk.inscriptionsTextTotalContentSize,
          largestEnvelopeSize: dbBlk.inscriptionsTextLargestEnvelopeSize,
          largestContentSize: dbBlk.inscriptionsTextLargestContentSize,
          largestEnvelopeInscriptionId: dbBlk.inscriptionsTextLargestEnvelopeInscriptionId,
          largestContentInscriptionId: dbBlk.inscriptionsTextLargestContentInscriptionId,
          averageEnvelopeSize: dbBlk.inscriptionsTextAverageEnvelopeSize,
          averageContentSize: dbBlk.inscriptionsTextAverageContentSize,
        },
        json: {
          totalEnvelopeSize: dbBlk.inscriptionsJsonTotalEnvelopeSize,
          totalContentSize: dbBlk.inscriptionsJsonTotalContentSize,
          largestEnvelopeSize: dbBlk.inscriptionsJsonLargestEnvelopeSize,
          largestContentSize: dbBlk.inscriptionsJsonLargestContentSize,
          largestEnvelopeInscriptionId: dbBlk.inscriptionsJsonLargestEnvelopeInscriptionId,
          largestContentInscriptionId: dbBlk.inscriptionsJsonLargestContentInscriptionId,
          averageEnvelopeSize: dbBlk.inscriptionsJsonAverageEnvelopeSize,
          averageContentSize: dbBlk.inscriptionsJsonAverageContentSize,
        },

        brotliCount: dbBlk.inscriptionsBrotliCount,
        gzipCount: dbBlk.inscriptionsGzipCount,
        compressedEnvelopeBytes: dbBlk.inscriptionsCompressedEnvelopeBytes,
      },
      runes: {
        mostActiveMint: dbBlk.runesMostActiveMint,
        mostActiveNonUncommonMint: dbBlk.runesMostActiveNonUncommonMint,
        runeMintActivity: compactToMintActivity(dbBlk.runeMintActivity),
        runeEtchAttempts: compactToRuneEtchAttempts(dbBlk.runeEtchAttempts),
        uniqueMintsCount: dbBlk.runesUniqueMintsCount,
        uniqueMintsCountNonUncommon: dbBlk.runesUniqueMintsCountNonUncommon,
        topMintCount: dbBlk.runesTopMintCount,
        topMintCountNonUncommon: dbBlk.runesTopMintCountNonUncommon,
      },
      brc20: {
        mostActiveMint: dbBlk.brc20MostActiveMint,
        brc20MintActivity: compactToMintActivity(dbBlk.brc20MintActivity),
        brc20DeployAttempts: compactToBrc20DeployAttempts(dbBlk.brc20DeployAttempts)
      },
      src20: {
        mostActiveMint: dbBlk.src20MostActiveMint,
        src20MintActivity: compactToMintActivity(dbBlk.src20MintActivity),
        src20DeployAttempts: compactToSrc20DeployAttempts(dbBlk.src20DeployAttempts)
      },
      cat21: {
        minimalCat21MintActivity: compactToMinimalCat21Mints(dbBlk.cat21MintActivity),
        genesisCount: dbBlk.cat21GenesisCount,
        avgFeeRate: dbBlk.cat21AvgFeeRate,
        minFeeRate: dbBlk.cat21MinFeeRate,
        maxFeeRate: dbBlk.cat21MaxFeeRate,
      },
      // Block-detail responses don't carry the per-row satellite arrays;
      // chart endpoints query ordpool_stats_atomical_op /
      // ordpool_stats_counterparty directly via GROUP BY.
      atomicals: {
        atomicalOps: [],
      },
      counterparty: {
        counterpartyMessages: [],
      },
      version: dbBlk.analyserVersion
    };
  }

  /**
   * Inserts generic mint activity data in batches into the database.
   * The identifier is always truncated to 20 chars
   *
   * WARNING: Avoid setting the `batchSize` too high. A very large batch size may cause:
   * - Queries exceeding `max_allowed_packet` size in MySQL.
   * - Performance bottlenecks due to a single large insert operation.
   *
   * @param tableName - The target table name.
   * @param data - The data to insert, as an array of rows.
   * @param batchSize - Number of rows to include in a single batch (default: 100).
   */
  async batchInsertMintActivity(
    tableName: string,
    data: { hash: string; height: number; identifier: string; count: number }[],
    batchSize = 100
  ): Promise<void> {
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const values = batch.map(() => `(?, ?, LEFT(?, 20), ?)`).join(', ');

      const query = `
        INSERT INTO ${tableName} (hash, height, identifier, count)
        VALUES ${values}
        ON DUPLICATE KEY UPDATE count = VALUES(count)
      `;

      const params = batch.flatMap(row => [row.hash, row.height, row.identifier, row.count]);

      await DB.query(query, params);
    }
  }

  /**
   * Batch inserts CAT-21 mint activities into the database.
   *
   * WARNING: Avoid setting the `batchSize` too high. A very large batch size may cause:
   * - Queries exceeding `max_allowed_packet` size in MySQL.
   * - Performance bottlenecks due to a single large insert operation.
   *
   * @param mints - Array of Cat21Mint objects to insert.
   * @param batchSize - Number of rows to include in a single batch (default: 100).
   */
  async batchInsertCat21MintActivity(
    mints: Cat21Mint[],
    batchSize: number = 100
  ): Promise<void> {
    for (let i = 0; i < mints.length; i += batchSize) {

      const batch = mints.slice(i, i + batchSize);
      const values = batch.map(() => `(?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(', ');

      const params = batch.flatMap((mint) => {
        const { blockId, blockHeight, transactionId, txIndex, number, feeRate, blockTime, fee, size, weight, value, sat, firstOwner, traits } = mint;
        const { catColors, backgroundColors, glassesColors } = traitsToCompactColors(traits);

        return [
          blockId,
          blockHeight,
          transactionId,
          txIndex,
          number ?? null,
          feeRate,
          blockTime,
          fee,
          size,
          weight,
          value,
          sat ?? null,
          firstOwner,
          traits.genesis,
          catColors,
          traits.gender,
          traits.designIndex,
          traits.designPose,
          traits.designExpression,
          traits.designPattern,
          traits.designFacing,
          traits.laserEyes,
          traits.background,
          backgroundColors,
          traits.crown,
          traits.glasses,
          glassesColors,
        ];
      });

      const query = `
        INSERT INTO ordpool_stats_cat21_mint (
          hash, height, txid, tx_index, number, fee_rate, block_time,
          fee, size, weight, value, sat, first_owner,
          genesis, cat_colors, gender, design_index, design_pose,
          design_expression, design_pattern, design_facing,
          laser_eyes, background, background_colors, crown, glasses, glasses_colors
        )
        VALUES ${values}
        ON DUPLICATE KEY UPDATE
          number = VALUES(number),
          fee_rate = VALUES(fee_rate),
          block_time = VALUES(block_time),
          fee = VALUES(fee),
          size = VALUES(size),
          weight = VALUES(weight),
          value = VALUES(value),
          sat = VALUES(sat),
          first_owner = VALUES(first_owner),
          genesis = VALUES(genesis),
          cat_colors = VALUES(cat_colors),
          gender = VALUES(gender),
          design_index = VALUES(design_index),
          design_pose = VALUES(design_pose),
          design_expression = VALUES(design_expression),
          design_pattern = VALUES(design_pattern),
          design_facing = VALUES(design_facing),
          laser_eyes = VALUES(laser_eyes),
          background = VALUES(background),
          background_colors = VALUES(background_colors),
          crown = VALUES(crown),
          glasses = VALUES(glasses),
          glasses_colors = VALUES(glasses_colors)
      `;

      await DB.query(query, params);
    }
  }

  /**
   * Save mints, etchings and deployments into rdpool_stats_* tables.
   * @param hash - The block hash.
   * @param height - The block height.
   * @param stats - The OrdpoolStats object containing the statistics to save.
   */
  async saveTokenActivity(hash: string, height: number, stats: OrdpoolStats): Promise<void> {

    // Store Rune Mint Activity in Batches
    await this.batchInsertMintActivity('ordpool_stats_rune_mint',
      stats.runes.runeMintActivity
        .map(([identifier, count]) => ({
          hash,
          height,
          identifier,
          count
        }))
    );

    // Store BRC-20 Mint Activity in Batches
    await this.batchInsertMintActivity('ordpool_stats_brc20_mint',
      stats.brc20.brc20MintActivity
        .map(([identifier, count]) => ({
          hash,
          height,
          identifier,
          count
        }))
    );

    // Store SRC-20 Mint Activity in Batches
    await this.batchInsertMintActivity('ordpool_stats_src20_mint',
      stats.src20.src20MintActivity
        .map(([identifier, count]) => ({
          hash,
          height,
          identifier,
          count
        }))
    );

    // 😻 Store CAT-21 Mint Activity in Batches
    // should be always defined, for data from the analyser
    if (stats.cat21.cat21MintActivity) {
      await this.batchInsertCat21MintActivity(stats.cat21.cat21MintActivity);
    }

    // Insert Rune Etch Attempts
    for (const {
      txId,                 //  1
      runeId,               //  2
      runeName,             //  3
      divisibility,         //  4
      premine,              //  5
      symbol,               //  6
      cap,                  //  7
      amount,               //  8
      offsetStart,          //  9
      offsetEnd,            // 10
      heightStart,          // 11
      heightEnd,            // 12
      turbo                 // 13
    } of stats.runes.runeEtchAttempts) {
      await DB.query(
        `INSERT INTO ordpool_stats_rune_etch (
            hash,
            height,
            txid,           --  1
            rune_id,        --  2
            rune_name,      --  3
            divisibility,   --  4
            premine,        --  5
            symbol,         --  6
            cap,            --  7
            amount,         --  8
            offset_start,   --  9
            offset_end,     -- 10
            height_start,   -- 11
            height_end,     -- 12
            turbo           -- 13
          ) VALUES (
            ?,              --  height
            ?,              --  hash
            ?,              --  1 (txid)
            ?,              --  2 (rune_id)
            LEFT(?, 60),    --  3 (rune_name)
            ?,              --  4 (divisibility)
            ?,              --  5 (premine)
            LEFT(?, 10),    --  6 (symbol)
            ?,              --  7 (cap)
            ?,              --  8 (amount)
            ?,              --  9 (offset_start)
            ?,              -- 10 (offset_end)
            ?,              -- 11 (height_start)
            ?,              -- 12 (height_end)
            ?               -- 13 (turbo)
          )
          ON DUPLICATE KEY UPDATE
            txid = VALUES(txid),                 --  1
            rune_name = VALUES(rune_name),       --  3
            divisibility = VALUES(divisibility), --  4
            premine = VALUES(premine),           --  5
            symbol = VALUES(symbol),             --  6
            cap = VALUES(cap),                   --  7
            amount = VALUES(amount),             --  8
            offset_start = VALUES(offset_start), --  9
            offset_end = VALUES(offset_end),     -- 10
            height_start = VALUES(height_start), -- 11
            height_end = VALUES(height_end),     -- 12
            turbo = VALUES(turbo)                -- 13
          `,
        [
          hash,
          height,
          txId ?? null,
          runeId ?? null,
          runeName ?? null,
          sanitizeU8(divisibility),
          sanitizeU128(premine),
          symbol ?? null,
          sanitizeU128(cap),
          sanitizeU128(amount),
          sanitizeU64(offsetStart),
          sanitizeU64(offsetEnd),
          sanitizeU64(heightStart),
          sanitizeU64(heightEnd),
          turbo ?? null,
        ]
      );
    }

    // Insert BRC-20 Deploy Attempts
    for (const { txId, ticker, maxSupply, mintLimit, decimals } of stats.brc20.brc20DeployAttempts) {
      await DB.query(
        `INSERT INTO ordpool_stats_brc20_deploy (
          hash,
          height,
          txid,       -- 1
          ticker,     -- 2
          max_supply, -- 3
          mint_limit, -- 4
          decimals    -- 5
        )
        VALUES (
          ?,           -- hash
          ?,           -- height
          ?,           -- 1 (txid)
          LEFT(?, 20), -- 2 (ticker)
          LEFT(?, 50), -- 3 (max_supply)
          LEFT(?, 50), -- 4 (mint_limit)
          LEFT(?, 5)   -- 5 (decimals)
        )
        ON DUPLICATE KEY UPDATE
          max_supply = VALUES(max_supply), -- 3
          mint_limit = VALUES(mint_limit), -- 4
          decimals   = VALUES(decimals)    -- 5
        `,
        [
          hash,
          height,
          txId ?? null,
          ticker ?? null,
          maxSupply ?? null,
          mintLimit ?? null,
          decimals ?? null
        ]
      );
    }

    // Insert SRC-20 Deploy Attempts
    for (const { txId, ticker, maxSupply, mintLimit, decimals } of stats.src20.src20DeployAttempts) {
      await DB.query(
        `INSERT INTO ordpool_stats_src20_deploy (
          hash,
          height,
          txid,       -- 1
          ticker,     -- 2
          max_supply, -- 3
          mint_limit, -- 4
          decimals    -- 5
        )
        VALUES (
          ?,           -- hash
          ?,           -- height
          ?,           -- 1 (txid)
          LEFT(?, 20), -- 2 (ticker)
          LEFT(?, 50), -- 3 (max_supply)
          LEFT(?, 50), -- 4 (mint_limit)
          LEFT(?, 5)   -- 5 (decimals)
        )
        ON DUPLICATE KEY UPDATE
          max_supply = VALUES(max_supply), -- 3
          mint_limit = VALUES(mint_limit), -- 4
          decimals   = VALUES(decimals)    -- 5
        `,
        [
          hash,
          height,
          txId ?? null,
          ticker ?? null,
          maxSupply ?? null,
          mintLimit ?? null,
          decimals ?? null
        ]
      );

    }
  }

  /**
   * Retrieves the lowest block from the `blocks` table (starting from a given height)
   * that does not have corresponding data in the `ordpool_stats` table.
   *
   * This code is not used at the moment!
   *
   * @param startHeight - The height to start searching from.
   * @returns A promise that resolves to the block information of the first block
   * without stats, or `null` if all blocks have stats.
   */
  async getLowestBlockWithoutOrdpoolStats(startHeight: number): Promise<{
    id: string;
    height: number;
    timestamp: number;
  } | null> {

    const [row] = await DB.query(
      `SELECT
        hash,
        height,
        UNIX_TIMESTAMP(blockTimestamp) as timestamp
      FROM blocks
      WHERE height >= ?
      AND NOT EXISTS (
        SELECT 1 FROM ordpool_stats WHERE ordpool_stats.hash = blocks.hash
      )
      ORDER BY height ASC
      LIMIT 1
      `,
      [startHeight]
    ) as any;

    if (!row.length) {
      return null;
    }

    const [result] = row;

    return {
      id: result.hash,
      height: result.height,
      timestamp: result.timestamp
    };
  }

  /**
   * Retrieves a batch of blocks (starting from a given height)
   * that do not have corresponding entries in the `ordpool_stats` table.
   *
   * Blocks are ordered by height in ascending order (oldest first).
   *
   * @param startHeight - The height to start scanning from.
   * @param batchSize - The maximum number of blocks to return.
   * @returns A list of blocks that are missing ordpool stats.
   */
  async getBlocksWithoutOrdpoolStatsInRange(
    startHeight: number,
    batchSize: number
  ): Promise<
    {
      id: string;
      height: number;
      timestamp: number;
    }[]
  > {
    const [rows] = await DB.query(
      `
      SELECT
        hash,
        height,
        UNIX_TIMESTAMP(blockTimestamp) AS timestamp
      FROM blocks
      WHERE height >= ?
        AND NOT EXISTS (
          SELECT 1 FROM ordpool_stats WHERE ordpool_stats.hash = blocks.hash
        )
        AND NOT EXISTS (
          SELECT 1 FROM ordpool_stats_skipped WHERE ordpool_stats_skipped.height = blocks.height
        )
      ORDER BY height ASC
      LIMIT ?
      `,
      [startHeight, batchSize]
    ) as any;

    return rows.map((row: any) => ({
      id: row.hash,
      height: row.height,
      timestamp: row.timestamp
    }));
  }
}


export default new OrdpoolBlocksRepository();
