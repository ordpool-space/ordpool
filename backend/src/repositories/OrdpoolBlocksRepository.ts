import {
  Cat21Mint,
  compactToBrc20DeployAttempts,
  compactToMinimalCat21Mints,
  compactToMintActivity,
  compactToRuneEtchAttempts,
  compactToSrc20DeployAttempts,
  getEmptyStats,
  getFirstInscriptionHeight,
  InscriptionSizeAggregate,
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


/**
 * One entry per column on `ordpool_stats`. Drives BOTH directions — INSERT
 * (via `val`) and the SELECT/format-function read path (via `alias` + `set`).
 * Single source of truth for the schema/value mapping; positional drift is
 * architecturally impossible.
 *
 * `placeholder` defaults to '?'. Override for SQL-side transforms like
 * `LEFT(?, 20)` on the most-active-mint columns where the value needs
 * server-side truncation to keep column widths sane.
 */
interface OrdpoolStatColumn {
  col: string;                                     // snake_case DB column
  alias: string;                                   // camelCase SELECT alias / OrdpoolDatabaseBlock field
  placeholder?: string;
  val: (s: OrdpoolStats) => unknown;               // write: read from stats
  set: (target: OrdpoolStats, value: any) => void; // read: assign into stats
}

/** Convert camelCase to snake_case, e.g. `runeMints` → `rune_mints`. */
const camelToSnake = (s: string): string => s.replace(/[A-Z]/g, m => '_' + m.toLowerCase());

/** Capitalise the first character, e.g. `mints` → `Mints`. */
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const MOST_ACTIVE_MINT_TRUNC = 20;
const TRUNCATED_PLACEHOLDER = `LEFT(?, ${MOST_ACTIVE_MINT_TRUNC})`;

/** Emit one OrdpoolStatColumn per camelCase field, mapping
 *  `field` ↔ `${colPrefix}_${snake_field}` (SQL) ↔ `${aliasPrefix}${PascalField}` (camelCase).
 *  `pick` returns the section object on a stats — typically a top-level key
 *  (`s => s.amounts`) but can drill deeper (`s => s.inscriptions.image`). */
const sectionCols = <Section extends object>(
  colPrefix: string,
  aliasPrefix: string,
  pick: (s: OrdpoolStats) => Section,
  fields: (keyof Section & string)[],
): OrdpoolStatColumn[] =>
  fields.map(f => ({
    col:   `${colPrefix}_${camelToSnake(f)}`,
    alias: aliasPrefix + cap(f),
    val:   s => (pick(s) as any)[f],
    set:   (t, v) => { (pick(t) as any)[f] = v; },
  }));

/** All 8 fields of an InscriptionSizeAggregate. Used 4× — global + per-bucket. */
const INSCRIPTION_SIZE_FIELDS: (keyof InscriptionSizeAggregate)[] = [
  'totalEnvelopeSize', 'totalContentSize',
  'largestEnvelopeSize', 'largestContentSize',
  'largestEnvelopeInscriptionId', 'largestContentInscriptionId',
  'averageEnvelopeSize', 'averageContentSize',
];

/**
 * Emit the 8 OrdpoolStatColumn entries for one InscriptionSizeAggregate
 * group (totals, largests + their inscription IDs, averages). Used 4×: once
 * for the global aggregate and once per content-type bucket.
 *
 * @param colPrefix   - SQL column prefix, e.g. `'inscriptions_image'`.
 * @param aliasPrefix - camelCase alias prefix, e.g. `'inscriptionsImage'`.
 * @param pick        - Pick the aggregate to read/write inside an
 *                      OrdpoolStats, e.g. `s => s.inscriptions.image`.
 */
const inscriptionSizeCols = (
  colPrefix: string,
  aliasPrefix: string,
  pick: (s: OrdpoolStats) => InscriptionSizeAggregate,
): OrdpoolStatColumn[] =>
  sectionCols(colPrefix, aliasPrefix, pick, INSCRIPTION_SIZE_FIELDS);

/**
 * Build a column entry whose placeholder is `LEFT(?, 20)` so MariaDB
 * truncates the value server-side. Used for the four `*_most_active_mint`
 * columns where the source string can exceed the column width.
 */
const truncatedMostActive = (
  col: string,
  alias: string,
  val: (s: OrdpoolStats) => unknown,
  set: (t: OrdpoolStats, v: any) => void,
): OrdpoolStatColumn => ({ col, alias, placeholder: TRUNCATED_PLACEHOLDER, val, set });

export const ORDPOOL_STATS_COLUMNS: OrdpoolStatColumn[] = [
  ...sectionCols('amounts', 'amounts', s => s.amounts, [
    'atomical', 'atomicalMint', 'atomicalUpdate',
    'counterparty', 'stamp', 'src721', 'src101',
    'cat21', 'cat21Mint',
    'inscription', 'inscriptionMint', 'inscriptionImage', 'inscriptionText', 'inscriptionJson',
    'rune', 'runeEtch', 'runeMint', 'runeCenotaph',
    'brc20', 'brc20Deploy', 'brc20Mint', 'brc20Transfer',
    'src20', 'src20Deploy', 'src20Mint', 'src20Transfer',
  ]),
  ...sectionCols('fees', 'fees', s => s.fees, [
    'runeMints', 'nonUncommonRuneMints', 'brc20Mints', 'src20Mints',
    'cat21Mints', 'atomicals', 'inscriptionMints',
    'inscriptionImageMints', 'inscriptionTextMints', 'inscriptionJsonMints',
  ]),
  ...inscriptionSizeCols('inscriptions',       'inscriptions',      s => s.inscriptions),
  ...inscriptionSizeCols('inscriptions_image', 'inscriptionsImage', s => s.inscriptions.image),
  ...inscriptionSizeCols('inscriptions_text',  'inscriptionsText',  s => s.inscriptions.text),
  ...inscriptionSizeCols('inscriptions_json',  'inscriptionsJson',  s => s.inscriptions.json),
  ...sectionCols('inscriptions', 'inscriptions', s => s.inscriptions, [
    'brotliCount', 'gzipCount', 'compressedEnvelopeBytes',
  ]),
  ...sectionCols('cat21', 'cat21', s => s.cat21, [
    'genesisCount', 'avgFeeRate', 'minFeeRate', 'maxFeeRate',
  ]),
  ...sectionCols('runes', 'runes', s => s.runes, [
    'uniqueMintsCount', 'uniqueMintsCountNonUncommon', 'topMintCount', 'topMintCountNonUncommon',
  ]),
  truncatedMostActive('runes_most_active_mint',              'runesMostActiveMint',
              s => s.runes.mostActiveMint,              (t, v) => { t.runes.mostActiveMint = v; }),
  truncatedMostActive('runes_most_active_non_uncommon_mint', 'runesMostActiveNonUncommonMint',
              s => s.runes.mostActiveNonUncommonMint,   (t, v) => { t.runes.mostActiveNonUncommonMint = v; }),
  truncatedMostActive('brc20_most_active_mint',              'brc20MostActiveMint',
              s => s.brc20.mostActiveMint,              (t, v) => { t.brc20.mostActiveMint = v; }),
  truncatedMostActive('src20_most_active_mint',              'src20MostActiveMint',
              s => s.src20.mostActiveMint,              (t, v) => { t.src20.mostActiveMint = v; }),
  // analyser_version doubles as the "is this row populated?" sentinel —
  // formatDbBlockIntoOrdpoolStats returns undefined when it's 0.
  {
    col: 'analyser_version', alias: 'analyserVersion',
    val: s => s.version,
    set: (t, v) => { t.version = v; },
  },
];

// Static parts of the INSERT — column list, placeholder list, and the SQL
// string itself. Computed once at module load. Per-call work in
// saveBlockOrdpoolStatsInDatabase is reduced to one .map() over the spec
// to materialise the param values.
const ORDPOOL_STATS_INSERT_SQL = (() => {
  const cols = ['hash', 'height', ...ORDPOOL_STATS_COLUMNS.map(c => c.col)];
  const phs  = ['?',    '?',     ...ORDPOOL_STATS_COLUMNS.map(c => c.placeholder ?? '?')];
  return `INSERT INTO ordpool_stats(${cols.join(', ')}) VALUES (${phs.join(', ')})`;
})();


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

      const stats = block.extras.ordpoolStats;

      // SQL is precomputed at module load; per-call work is just materialising
      // the param values. Positional alignment is preserved because both
      // the SQL and the params iterate ORDPOOL_STATS_COLUMNS in the same order.
      const params = [block.id, block.height, ...ORDPOOL_STATS_COLUMNS.map(c => c.val(stats))];
      await DB.query(ORDPOOL_STATS_INSERT_SQL, params, 'silent');

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

  /**
   * Build the OrdpoolStats object the frontend consumes from a joined
   * blocks + ordpool_stats + satellite-tables row. Returns `undefined`
   * when `analyser_version` is 0 — the marker for "block exists but
   * ordpool hasn't indexed it yet" (every column is at its default
   * value, no real signal to show).
   *
   * @param dbBlk - One row from BlocksRepository's ordpool-aware SELECT.
   * @returns Populated OrdpoolStats, or undefined for unindexed blocks.
   */
  public formatDbBlockIntoOrdpoolStats(dbBlk: OrdpoolDatabaseBlock): OrdpoolStats | undefined {

    if (!dbBlk.analyserVersion) {
      return undefined;
    }

    // Apply the spec: every ordpool_stats column → corresponding OrdpoolStats
    // field via the column's `set` function. Same source of truth as INSERT.
    const result = getEmptyStats();
    const dbBlkAny = dbBlk as unknown as Record<string, unknown>;
    for (const c of ORDPOOL_STATS_COLUMNS) {
      c.set(result, dbBlkAny[c.alias]);
    }

    // Satellite GROUP_CONCAT'd fields aren't part of the per-column spec
    // (they aggregate JOIN'd rows from sibling tables). Wire them in
    // separately via the existing compactor helpers.
    result.runes.runeMintActivity     = compactToMintActivity(dbBlk.runeMintActivity);
    result.runes.runeEtchAttempts     = compactToRuneEtchAttempts(dbBlk.runeEtchAttempts);
    result.brc20.brc20MintActivity    = compactToMintActivity(dbBlk.brc20MintActivity);
    result.brc20.brc20DeployAttempts  = compactToBrc20DeployAttempts(dbBlk.brc20DeployAttempts);
    result.src20.src20MintActivity    = compactToMintActivity(dbBlk.src20MintActivity);
    result.src20.src20DeployAttempts  = compactToSrc20DeployAttempts(dbBlk.src20DeployAttempts);
    result.cat21.minimalCat21MintActivity = compactToMinimalCat21Mints(dbBlk.cat21MintActivity);

    // atomicals.atomicalOps and counterparty.counterpartyMessages stay empty
    // here. Block-detail responses skip the per-row satellite arrays;
    // /api/v1/ordpool/statistics/atomical-ops and …/counterparty-messages
    // query the satellite tables directly via GROUP BY.

    return result;
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

    // Insert Atomical operations (mint / update / etc.) into the satellite
    // table. The parser already filters out x/y/z FT UTXO transfer ops.
    for (const { txId, operation, ticker } of stats.atomicals.atomicalOps) {
      await DB.query(
        `INSERT INTO ordpool_stats_atomical_op (hash, height, txid, operation, ticker)
         VALUES (?, ?, ?, ?, LEFT(?, 40))
         ON DUPLICATE KEY UPDATE ticker = VALUES(ticker)`,
        [hash, height, txId, operation, ticker ?? null]
      );
    }

    // Insert Counterparty messages into the satellite table. One row per
    // counterparty tx, capturing message_type for per-message-type charts.
    for (const { txId, messageType, messageTypeId } of stats.counterparty.counterpartyMessages) {
      await DB.query(
        `INSERT INTO ordpool_stats_counterparty (hash, height, txid, message_type, message_type_id)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           message_type = VALUES(message_type),
           message_type_id = VALUES(message_type_id)`,
        [hash, height, txId, messageType, messageTypeId]
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

  /**
   * Highest block height with a row in `ordpool_stats`, or `null` when the
   * stats table is empty. The indexer processes ASC from `firstStatsHeight`,
   * so this is the indexer's frontier. Read by /health/indexer-progress.
   */
  async getMaxStatsHeight(): Promise<number | null> {
    const [rows] = await DB.query(
      `SELECT MAX(b.height) AS h FROM ordpool_stats s JOIN blocks b ON b.hash = s.hash`
    ) as any;
    const h = rows[0]?.h;
    return h === null || h === undefined ? null : Number(h);
  }

  /**
   * Count of blocks at or above `startHeight` that still need ordpool stats
   * (no row in `ordpool_stats`, not in `ordpool_stats_skipped`). Mirrors the
   * query inside `getBlocksWithoutOrdpoolStatsInRange` minus the LIMIT.
   */
  async getPendingStatsCount(startHeight: number): Promise<number> {
    const [rows] = await DB.query(
      `SELECT COUNT(*) AS c
       FROM blocks
       WHERE height >= ?
         AND NOT EXISTS (SELECT 1 FROM ordpool_stats WHERE ordpool_stats.hash = blocks.hash)
         AND NOT EXISTS (SELECT 1 FROM ordpool_stats_skipped WHERE ordpool_stats_skipped.height = blocks.height)`,
      [startHeight]
    ) as any;
    return Number(rows[0]?.c ?? 0);
  }
}


export default new OrdpoolBlocksRepository();
