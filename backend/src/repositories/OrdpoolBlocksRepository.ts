import bitcoinApi from '../api/bitcoin/bitcoin-api-factory';
import { BlockExtended, BlockExtension, BlockPrice, EffectiveFeeStats } from '../mempool.interfaces';
import DB from '../database';
import logger from '../logger';
import { Common } from '../api/common';
import PoolsRepository from './PoolsRepository';
import HashratesRepository from './HashratesRepository';
import { RowDataPacket, escape } from 'mysql2';
import BlocksSummariesRepository from './BlocksSummariesRepository';
import DifficultyAdjustmentsRepository from './DifficultyAdjustmentsRepository';
import bitcoinClient from '../api/bitcoin/bitcoin-client';
import config from '../config';
import chainTips from '../api/chain-tips';
import blocks from '../api/blocks';
import BlocksAuditsRepository from './BlocksAuditsRepository';
import transactionUtils from '../api/transaction-utils';
import { OrdpoolStats, OrdpoolTransactionFlags } from 'ordpool-parser';


export interface OrdpoolDatabaseBlock {
  id: string;
  height: number;

  amountsAtomical: number;
  amountsAtomicalMint: number;
  amountsAtomicalTransfer: number;
  amountsAtomicalUpdate: number;

  amountsCat21: number;
  amountsCat21Mint: number;
  amountsCat21Transfer: number;

  amountsInscription: number;
  amountsInscriptionMint: number;
  amountsInscriptionTransfer: number;
  amountsInscriptionBurn: number;

  amountsRune: number;
  amountsRuneEtch: number;
  amountsRuneMint: number;
  amountsRuneCenotaph: number;
  amountsRuneTransfer: number;
  amountsRuneBurn: number;

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

  inscriptionsTotalEnvelopeSize: number;
  inscriptionsTotalContentSize: number;
  inscriptionsLargestEnvelopeSize: number;
  inscriptionsLargestContentSize: number;
  inscriptionsLargestEnvelopeInscriptionId: string | null;
  inscriptionsLargestContentInscriptionId: string | null;
  inscriptionsAverageEnvelopeSize: number;
  inscriptionsAverageContentSize: number;

  runesMostActiveMint: string | null;
  runesMostActiveNonUncommonMint: string | null;
  brc20MostActiveMint: string | null;
  src20MostActiveMint: string | null;

  analyserVersion: number;
}

export const ORDPOOL_BLOCK_DB_FIELDS = `

  /* HACK -- Ordpool stats */
  blocks_ordpool_stats.amounts_atomical                             AS amountsAtomical,                           /* 1 */
  blocks_ordpool_stats.amounts_atomical_mint                        AS amountsAtomicalMint,                       /* 2 */
  blocks_ordpool_stats.amounts_atomical_transfer                    AS amountsAtomicalTransfer,                   /* 3 */
  blocks_ordpool_stats.amounts_atomical_update                      AS amountsAtomicalUpdate,                     /* 4 */

  blocks_ordpool_stats.amounts_cat21                                AS amountsCat21,                              /* 5 */
  blocks_ordpool_stats.amounts_cat21_mint                           AS amountsCat21Mint,                          /* 6 */
  blocks_ordpool_stats.amounts_cat21_transfer                       AS amountsCat21Transfer,                      /* 7 */

  blocks_ordpool_stats.amounts_inscription                          AS amountsInscription,                        /* 8 */
  blocks_ordpool_stats.amounts_inscription_mint                     AS amountsInscriptionMint,                    /* 9 */
  blocks_ordpool_stats.amounts_inscription_transfer                 AS amountsInscriptionTransfer,                /* 10 */
  blocks_ordpool_stats.amounts_inscription_burn                     AS amountsInscriptionBurn,                    /* 11 */

  blocks_ordpool_stats.amounts_rune                                 AS amountsRune,                               /* 12 */
  blocks_ordpool_stats.amounts_rune_etch                            AS amountsRuneEtch,                           /* 13 */
  blocks_ordpool_stats.amounts_rune_mint                            AS amountsRuneMint,                           /* 14 */
  blocks_ordpool_stats.amounts_rune_cenotaph                        AS amountsRuneCenotaph,                       /* 15 */
  blocks_ordpool_stats.amounts_rune_transfer                        AS amountsRuneTransfer,                       /* 16 */
  blocks_ordpool_stats.amounts_rune_burn                            AS amountsRuneBurn,                           /* 17 */

  blocks_ordpool_stats.amounts_brc20                                AS amountsBrc20,                              /* 18 */
  blocks_ordpool_stats.amounts_brc20_deploy                         AS amountsBrc20Deploy,                        /* 19 */
  blocks_ordpool_stats.amounts_brc20_mint                           AS amountsBrc20Mint,                          /* 20 */
  blocks_ordpool_stats.amounts_brc20_transfer                       AS amountsBrc20Transfer,                      /* 21 */

  blocks_ordpool_stats.amounts_src20                                AS amountsSrc20,                              /* 22 */
  blocks_ordpool_stats.amounts_src20_deploy                         AS amountsSrc20Deploy,                        /* 23 */
  blocks_ordpool_stats.amounts_src20_mint                           AS amountsSrc20Mint,                          /* 24 */
  blocks_ordpool_stats.amounts_src20_transfer                       AS amountsSrc20Transfer,                      /* 25 */

  blocks_ordpool_stats.fees_rune_mints                              AS feesRuneMints,                             /* 26 */
  blocks_ordpool_stats.fees_non_uncommon_rune_mints                 AS feesNonUncommonRuneMints,                  /* 27 */
  blocks_ordpool_stats.fees_brc20_mints                             AS feesBrc20Mints,                            /* 28 */
  blocks_ordpool_stats.fees_src20_mints                             AS feesSrc20Mints,                            /* 29 */
  blocks_ordpool_stats.fees_cat21_mints                             AS feesCat21Mints,                            /* 30 */
  blocks_ordpool_stats.fees_atomicals                               AS feesAtomicals,                             /* 31 */
  blocks_ordpool_stats.fees_inscription_mints                       AS feesInscriptionMints,                      /* 32 */

  blocks_ordpool_stats.inscriptions_total_envelope_size             AS inscriptionsTotalEnvelopeSize,             /* 33 */
  blocks_ordpool_stats.inscriptions_total_content_size              AS inscriptionsTotalContentSize,              /* 34 */
  blocks_ordpool_stats.inscriptions_largest_envelope_size           AS inscriptionsLargestEnvelopeSize,           /* 35 */
  blocks_ordpool_stats.inscriptions_largest_content_size            AS inscriptionsLargestContentSize,            /* 36 */
  blocks_ordpool_stats.inscriptions_largest_envelope_inscription_id AS inscriptionsLargestEnvelopeInscriptionId,  /* 37 */
  blocks_ordpool_stats.inscriptions_largest_content_inscription_id  AS inscriptionsLargestContentInscriptionId,   /* 38 */
  blocks_ordpool_stats.inscriptions_average_envelope_size           AS inscriptionsAverageEnvelopeSize,           /* 39 */
  blocks_ordpool_stats.inscriptions_average_content_size            AS inscriptionsAverageContentSize,            /* 40 */

  blocks_ordpool_stats.runes_most_active_mint                       AS runesMostActiveMint,                       /* 41 */
  blocks_ordpool_stats.runes_most_active_non_uncommon_mint          AS runesMostActiveNonUncommonMint,            /* 42 */
  blocks_ordpool_stats.brc20_most_active_mint                       AS brc20MostActiveMint,                       /* 43 */
  blocks_ordpool_stats.src20_most_active_mint                       AS src20MostActiveMint,                       /* 44 */

  blocks_ordpool_stats.analyser_version                             AS analyserVersion                            /* 45 */
`;


class OrdpoolBlocksRepository {
  /**
   * Save indexed block data in the database
   */
  public async $saveBlockOrdpoolStatsInDatabase(block: BlockExtended): Promise<void> {

    if (!block.extras.ordpoolStats) {
      return;
    }

    try {
      const query = `INSERT INTO blocks_ordpool_stats(
        hash,
        height,

        amounts_atomical,                                   /* 1 */
        amounts_atomical_mint,                              /* 2 */
        amounts_atomical_transfer,                          /* 3 */
        amounts_atomical_update,                            /* 4 */

        amounts_cat21,                                      /* 5 */
        amounts_cat21_mint,                                 /* 6 */
        amounts_cat21_transfer,                             /* 7 */

        amounts_inscription,                                /* 8 */
        amounts_inscription_mint,                           /* 9 */
        amounts_inscription_transfer,                       /* 10 */
        amounts_inscription_burn,                           /* 11 */

        amounts_rune,                                       /* 12 */
        amounts_rune_etch,                                  /* 13 */
        amounts_rune_mint,                                  /* 14 */
        amounts_rune_cenotaph,                              /* 15 */
        amounts_rune_transfer,                              /* 16 */
        amounts_rune_burn,                                  /* 17 */

        amounts_brc20,                                      /* 18 */
        amounts_brc20_deploy,                               /* 19 */
        amounts_brc20_mint,                                 /* 20 */
        amounts_brc20_transfer,                             /* 21 */

        amounts_src20,                                      /* 22 */
        amounts_src20_deploy,                               /* 23 */
        amounts_src20_mint,                                 /* 24 */
        amounts_src20_transfer,                             /* 25 */

        fees_rune_mints,                                    /* 26 */
        fees_non_uncommon_rune_mints,                       /* 27 */
        fees_brc20_mints,                                   /* 28 */
        fees_src20_mints,                                   /* 29 */
        fees_cat21_mints,                                   /* 30 */
        fees_atomicals,                                     /* 31 */
        fees_inscription_mints,                             /* 32 */

        inscriptions_total_envelope_size,                   /* 33 */
        inscriptions_total_content_size,                    /* 34 */
        inscriptions_largest_envelope_size,                 /* 35 */
        inscriptions_largest_content_size,                  /* 36 */
        inscriptions_largest_envelope_inscription_id,       /* 37 */
        inscriptions_largest_content_inscription_id,        /* 38 */
        inscriptions_average_envelope_size,                 /* 39 */
        inscriptions_average_content_size,                  /* 40 */

        runes_most_active_mint,                             /* 41 */
        runes_most_active_non_uncommon_mint,                /* 42 */
        brc20_most_active_mint,                             /* 43 */
        src20_most_active_mint,                             /* 44 */

        analyser_version                                    /* 45 */

      ) VALUE (
        ?,
        ?,

        ?,  /* 1 amounts_atomical */
        ?,  /* 2 amounts_atomical_mint */
        ?,  /* 3 amounts_atomical_transfer */
        ?,  /* 4 amounts_atomical_update */

        ?,  /* 5 amounts_cat21 */
        ?,  /* 6 amounts_cat21_mint */
        ?,  /* 7 amounts_cat21_transfer */

        ?,  /* 8 amounts_inscription */
        ?,  /* 9 amounts_inscription_mint */
        ?,  /* 10 amounts_inscription_transfer */
        ?,  /* 11 amounts_inscription_burn */

        ?,  /* 12 amounts_rune */
        ?,  /* 13 amounts_rune_etch */
        ?,  /* 14 amounts_rune_mint */
        ?,  /* 15 amounts_rune_cenotaph */
        ?,  /* 16 amounts_rune_transfer */
        ?,  /* 17 amounts_rune_burn */

        ?,  /* 18 amounts_brc20 */
        ?,  /* 19 amounts_brc20_deploy */
        ?,  /* 20 amounts_brc20_mint */
        ?,  /* 21 amounts_brc20_transfer */

        ?,  /* 22 amounts_src20 */
        ?,  /* 23 amounts_src20_deploy */
        ?,  /* 24 amounts_src20_mint */
        ?,  /* 25 amounts_src20_transfer */

        ?,  /* 26 fees_rune_mints */
        ?,  /* 27 fees_non_uncommon_rune_mints */
        ?,  /* 28 fees_brc20_mints */
        ?,  /* 29 fees_src20_mints */
        ?,  /* 30 fees_cat21_mints */
        ?,  /* 31 fees_atomicals */
        ?,  /* 32 fees_inscription_mints */

        ?,  /* 33 inscriptions_total_envelope_size */
        ?,  /* 34 inscriptions_total_content_size */
        ?,  /* 35 inscriptions_largest_envelope_size */
        ?,  /* 36 inscriptions_largest_content_size */
        ?,  /* 37 inscriptions_largest_envelope_inscription_id */
        ?,  /* 38 inscriptions_largest_content_inscription_id */
        ?,  /* 39 inscriptions_average_envelope_size */
        ?,  /* 40 inscriptions_average_content_size */

        LEFT(?, 20),  /* 41 runes_most_active_mint - truncated to 20 ASCII characters */
        LEFT(?, 20),  /* 42 runes_most_active_non_uncommon_mint - truncated to 20 ASCII characters */
        LEFT(?, 20),  /* 43 brc20_most_active_mint - truncated to 20 Unicode characters (between 1 and 4 bytes) */
        LEFT(?, 20),  /* 44 src20_most_active_mint - truncated to 20 Unicode characters (between 1 and 4 bytes) */

        ?   /* 45 analyser_version */
      )`;


      const params: any[] = [
        block.id,
        block.height,

        block.extras.ordpoolStats.amounts.atomical,                           // 1
        block.extras.ordpoolStats.amounts.atomicalMint,                       // 2
        block.extras.ordpoolStats.amounts.atomicalTransfer,                   // 3
        block.extras.ordpoolStats.amounts.atomicalUpdate,                     // 4

        block.extras.ordpoolStats.amounts.cat21,                              // 5
        block.extras.ordpoolStats.amounts.cat21Mint,                          // 6
        block.extras.ordpoolStats.amounts.cat21Transfer,                      // 7

        block.extras.ordpoolStats.amounts.inscription,                        // 8
        block.extras.ordpoolStats.amounts.inscriptionMint,                    // 9
        block.extras.ordpoolStats.amounts.inscriptionTransfer,                // 10
        block.extras.ordpoolStats.amounts.inscriptionBurn,                    // 11

        block.extras.ordpoolStats.amounts.rune,                               // 12
        block.extras.ordpoolStats.amounts.runeEtch,                           // 13
        block.extras.ordpoolStats.amounts.runeMint,                           // 14
        block.extras.ordpoolStats.amounts.runeCenotaph,                       // 15
        block.extras.ordpoolStats.amounts.runeTransfer,                       // 16
        block.extras.ordpoolStats.amounts.runeBurn,                           // 17

        block.extras.ordpoolStats.amounts.brc20,                              // 18
        block.extras.ordpoolStats.amounts.brc20Deploy,                        // 19
        block.extras.ordpoolStats.amounts.brc20Mint,                          // 20
        block.extras.ordpoolStats.amounts.brc20Transfer,                      // 21

        block.extras.ordpoolStats.amounts.src20,                              // 22
        block.extras.ordpoolStats.amounts.src20Deploy,                        // 23
        block.extras.ordpoolStats.amounts.src20Mint,                          // 24
        block.extras.ordpoolStats.amounts.src20Transfer,                      // 25

        block.extras.ordpoolStats.fees.runeMints,                             // 26
        block.extras.ordpoolStats.fees.nonUncommonRuneMints,                  // 27
        block.extras.ordpoolStats.fees.brc20Mints,                            // 28
        block.extras.ordpoolStats.fees.src20Mints,                            // 29
        block.extras.ordpoolStats.fees.cat21Mints,                            // 30
        block.extras.ordpoolStats.fees.atomicals,                             // 31
        block.extras.ordpoolStats.fees.inscriptionMints,                      // 32

        block.extras.ordpoolStats.inscriptions.totalEnvelopeSize,             // 33
        block.extras.ordpoolStats.inscriptions.totalContentSize,              // 34
        block.extras.ordpoolStats.inscriptions.largestEnvelopeSize,           // 35
        block.extras.ordpoolStats.inscriptions.largestContentSize,            // 36
        block.extras.ordpoolStats.inscriptions.largestEnvelopeInscriptionId,  // 37
        block.extras.ordpoolStats.inscriptions.largestContentInscriptionId,   // 38
        block.extras.ordpoolStats.inscriptions.averageEnvelopeSize,           // 39
        block.extras.ordpoolStats.inscriptions.averageContentSize,            // 40

        block.extras.ordpoolStats.runes.mostActiveMint,                       // 41
        block.extras.ordpoolStats.runes.mostActiveNonUncommonMint,            // 42
        block.extras.ordpoolStats.brc20.mostActiveMint,                       // 43
        block.extras.ordpoolStats.src20.mostActiveMint,                       // 44

        block.extras.ordpoolStats.version                                     // 45
      ];

      await DB.query(query, params);
      logger.debug(`$saveBlockOrdpoolStatsInDatabase() - Block ${block.height} successfully stored!`, logger.tags.mining);

    } catch (e: any) {
      if (e.errno === 1062) {
        logger.debug(`$saveBlockOrdpoolStatsInDatabase() - Block ${block.height} has already been indexed, ignoring`, logger.tags.mining);
      } else {
        logger.err('Cannot save indexed block into blocks_ordpool_stats. Reason: ' + (e instanceof Error ? e.message : e), logger.tags.mining);
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
        atomical:             dbBlk.amountsAtomical,
        atomicalMint:         dbBlk.amountsAtomicalMint,
        atomicalTransfer:     dbBlk.amountsAtomicalTransfer,
        atomicalUpdate:       dbBlk.amountsAtomicalUpdate,

        cat21:                dbBlk.amountsCat21,
        cat21Mint:            dbBlk.amountsCat21Mint,
        cat21Transfer:        dbBlk.amountsCat21Transfer,

        inscription:          dbBlk.amountsInscription,
        inscriptionMint:      dbBlk.amountsInscriptionMint,
        inscriptionTransfer:  dbBlk.amountsInscriptionTransfer,
        inscriptionBurn:      dbBlk.amountsInscriptionBurn,

        rune:                 dbBlk.amountsRune,
        runeEtch:             dbBlk.amountsRuneEtch,
        runeMint:             dbBlk.amountsRuneMint,
        runeCenotaph:         dbBlk.amountsRuneCenotaph,
        runeTransfer:         dbBlk.amountsRuneTransfer,
        runeBurn:             dbBlk.amountsRuneBurn,

        brc20:                dbBlk.amountsBrc20,
        brc20Deploy:          dbBlk.amountsBrc20Deploy,
        brc20Mint:            dbBlk.amountsBrc20Mint,
        brc20Transfer:        dbBlk.amountsBrc20Transfer,

        src20:                dbBlk.amountsSrc20,
        src20Deploy:          dbBlk.amountsSrc20Deploy,
        src20Mint:            dbBlk.amountsSrc20Mint,
        src20Transfer:        dbBlk.amountsSrc20Transfer
      },
      fees: {
        runeMints:                    dbBlk.feesRuneMints,
        nonUncommonRuneMints:         dbBlk.feesNonUncommonRuneMints,
        brc20Mints:                   dbBlk.feesBrc20Mints,
        src20Mints:                   dbBlk.feesSrc20Mints,
        cat21Mints:                   dbBlk.feesCat21Mints,
        atomicals:                    dbBlk.feesAtomicals,
        inscriptionMints:             dbBlk.feesInscriptionMints
      },
      inscriptions: {
        totalEnvelopeSize:            dbBlk.inscriptionsTotalEnvelopeSize,
        totalContentSize:             dbBlk.inscriptionsTotalContentSize,

        largestEnvelopeSize:          dbBlk.inscriptionsLargestEnvelopeSize,
        largestContentSize:           dbBlk.inscriptionsLargestContentSize,

        largestEnvelopeInscriptionId: dbBlk.inscriptionsLargestEnvelopeInscriptionId,
        largestContentInscriptionId:  dbBlk.inscriptionsLargestContentInscriptionId,

        averageEnvelopeSize:          dbBlk.inscriptionsAverageEnvelopeSize,
        averageContentSize:           dbBlk.inscriptionsAverageContentSize
      },
      runes: {
        mostActiveMint:               dbBlk.runesMostActiveMint,
        mostActiveNonUncommonMint:    dbBlk.runesMostActiveNonUncommonMint
      },
      brc20: {
        mostActiveMint:               dbBlk.brc20MostActiveMint,
      },
      src20: {
        mostActiveMint:               dbBlk.src20MostActiveMint,
      },
      version:                        dbBlk.analyserVersion
    };
  }
}

export default new OrdpoolBlocksRepository();
