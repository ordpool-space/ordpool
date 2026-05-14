
import DB from '../database';
import logger from '../logger';

class OrdpoolDatabaseMigration {

  // change this after every update
  private static currentVersion = 8;

  private queryTimeout = 3600_000;

  /**
   * Entry point
   */
  public async $initializeOrMigrateDatabase(): Promise<void> {
    logger.debug('ORDPOOL MIGRATIONS: Running migrations', 'Ordpool');

    const ordpoolDatabaseSchemaVersion = await this.$getOrdpoolSchemaVersionFromDatabase();

    if (ordpoolDatabaseSchemaVersion === 0) {
      logger.info('Changing database to Ordpool schema!', 'Ordpool');
      await this.$executeQuery(`INSERT INTO state VALUES('ordpool_schema_version', 0, NULL);`);
    }

    // Bump these two from debug → notice so journalctl's default config
    // ("info and above") preserves them. We need to be able to confirm from
    // the journal whether a migration was attempted on every deploy.
    logger.notice('ORDPOOL MIGRATIONS: Current state.ordpool_schema_version ' + ordpoolDatabaseSchemaVersion, 'Ordpool');
    logger.notice('ORDPOOL MIGRATIONS: Latest OrdpoolDatabaseMigration.currentVersion is ' + OrdpoolDatabaseMigration.currentVersion, 'Ordpool');

    if (ordpoolDatabaseSchemaVersion >= OrdpoolDatabaseMigration.currentVersion) {
      logger.debug('ORDPOOL MIGRATIONS: Nothing to do.', 'Ordpool');
      return;
    }

    if (OrdpoolDatabaseMigration.currentVersion > ordpoolDatabaseSchemaVersion) {
      try {
        await this.$migrateTableSchemaFromVersion(ordpoolDatabaseSchemaVersion);
        logger.notice(`ORDPOOL MIGRATIONS: OK. Database schema have been migrated from version ${ordpoolDatabaseSchemaVersion} to ${OrdpoolDatabaseMigration.currentVersion} (latest version)`, 'Ordpool');
      } catch (e) {
        // Fail loud. The pre-existing message claimed "aborting" but only
        // logged + returned, leaving the service running with a stale schema
        // — exactly what bit us on 2026-05-04 (35h of broken homepage). Now
        // we re-throw: startServer's try/catch wraps and aborts the process,
        // systemd retries hit StartLimit, OnFailure fires, alert email lands.
        logger.err('ORDPOOL MIGRATIONS: Unable to migrate database, aborting. ' + e, 'Ordpool');
        throw new Error('OrdpoolDatabaseMigration failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    }

    return;
  }

  /**
   * Small query execution wrapper to log all executed queries
   */
  private async $executeQuery(query: string, silent = false): Promise<any> {
    if (!silent) {
      logger.debug('ORDPOOL MIGRATIONS: Execute query:\n' + query, 'Ordpool');
    }
    return DB.query({ sql: query, timeout: this.queryTimeout });
  }

  /**
   * Get current ordpool database version, or 0 if 'ordpool_schema_version' does not exists.
   */
  private async $getOrdpoolSchemaVersionFromDatabase(): Promise<number> {
    const query = `SELECT IFNULL((SELECT number FROM state WHERE name = 'ordpool_schema_version'), 0) AS number;`;
    const [rows] = await this.$executeQuery(query, true);
    return rows[0]['number'];
  }

  /**
   * We actually execute the migrations queries here
   */
  private async $migrateTableSchemaFromVersion(version: number): Promise<void> {
    const transactionQueries: string[] = [];
    for (const query of this.getMigrationQueriesFromVersion(version)) {
      transactionQueries.push(query);
    }

    logger.notice(`ORDPOOL MIGRATIONS: ${version > 0 ? 'Upgrading' : 'Initializing'} database schema version number to ${OrdpoolDatabaseMigration.currentVersion}`, 'Ordpool');
    transactionQueries.push(this.getUpdateToLatestSchemaVersionQuery());

    try {
      await this.$executeQuery('START TRANSACTION;');
      for (const query of transactionQueries) {
        await this.$executeQuery(query);
      }
      await this.$executeQuery('COMMIT;');
    } catch (e) {
      await this.$executeQuery('ROLLBACK;');
      throw e;
    }
  }

  /**
   * Generate migration queries based on schema version
   *
   * Hint: Quick reset for development:
   *
   * DROP TABLE `ordpool_stats`;
   * DROP TABLE `ordpool_stats_rune_mint`;
   * DROP TABLE `ordpool_stats_brc20_mint`;
   * DROP TABLE `ordpool_stats_src20_mint`;
   * DROP TABLE `ordpool_stats_cat21_mint`;
   * DROP TABLE `ordpool_stats_rune_etch`;
   * DROP TABLE `ordpool_stats_brc20_deploy`;
   * DROP TABLE `ordpool_stats_src20_deploy`;
   * DELETE FROM state where name = "ordpool_schema_version"
   */
  private getMigrationQueriesFromVersion(version: number): string[] {
    const queries: string[] = [];

    if (version <= 1) {

      // MANUAL CLEANUP ALL PREVIOUS ATTEMPTS 😅
      queries.push(`ALTER TABLE blocks
        DROP COLUMN IF EXISTS amount_atomical,
        DROP COLUMN IF EXISTS amount_atomical_mint,
        DROP COLUMN IF EXISTS amount_atomical_transfer,
        DROP COLUMN IF EXISTS amount_atomcial_update,

        DROP COLUMN IF EXISTS amount_cat21,
        DROP COLUMN IF EXISTS amount_cat21_mint,
        DROP COLUMN IF EXISTS amount_cat21_transfer,

        DROP COLUMN IF EXISTS amount_inscription,
        DROP COLUMN IF EXISTS amount_inscription_mint,
        DROP COLUMN IF EXISTS amount_inscription_transfer,
        DROP COLUMN IF EXISTS amount_inscription_burn,

        DROP COLUMN IF EXISTS amount_runestone,
        DROP COLUMN IF EXISTS amount_rune,
        DROP COLUMN IF EXISTS amount_rune_etch,
        DROP COLUMN IF EXISTS amount_rune_transfer,
        DROP COLUMN IF EXISTS amount_rune_burn,

        DROP COLUMN IF EXISTS amount_brc20,
        DROP COLUMN IF EXISTS amount_brc20_deploy,
        DROP COLUMN IF EXISTS amount_brc20_mint,
        DROP COLUMN IF EXISTS amount_brc20_transfer,

        DROP COLUMN IF EXISTS amount_src20,
        DROP COLUMN IF EXISTS amount_src20_deploy,
        DROP COLUMN IF EXISTS amount_src20_mint,
        DROP COLUMN IF EXISTS amount_src20_transfer,

        DROP COLUMN IF EXISTS analyser_version,

        DROP COLUMN IF EXISTS amounts_atomical,
        DROP COLUMN IF EXISTS amounts_atomical_mint,
        DROP COLUMN IF EXISTS amounts_atomical_transfer,
        DROP COLUMN IF EXISTS amounts_atomical_update,
        DROP COLUMN IF EXISTS amounts_cat21,
        DROP COLUMN IF EXISTS amounts_cat21_mint,
        DROP COLUMN IF EXISTS amounts_cat21_transfer,
        DROP COLUMN IF EXISTS amounts_inscription,
        DROP COLUMN IF EXISTS amounts_inscription_mint,
        DROP COLUMN IF EXISTS amounts_inscription_transfer,
        DROP COLUMN IF EXISTS amounts_inscription_burn,
        DROP COLUMN IF EXISTS amounts_rune,
        DROP COLUMN IF EXISTS amounts_rune_etch,
        DROP COLUMN IF EXISTS amounts_rune_mint,
        DROP COLUMN IF EXISTS amounts_rune_cenotaph,
        DROP COLUMN IF EXISTS amounts_rune_transfer,
        DROP COLUMN IF EXISTS amounts_rune_burn,
        DROP COLUMN IF EXISTS amounts_brc20,
        DROP COLUMN IF EXISTS amounts_brc20_deploy,
        DROP COLUMN IF EXISTS amounts_brc20_mint,
        DROP COLUMN IF EXISTS amounts_brc20_transfer,
        DROP COLUMN IF EXISTS amounts_src20,
        DROP COLUMN IF EXISTS amounts_src20_deploy,
        DROP COLUMN IF EXISTS amounts_src20_mint,
        DROP COLUMN IF EXISTS amounts_src20_transfer,
        DROP COLUMN IF EXISTS fees_rune_mints,
        DROP COLUMN IF EXISTS fees_non_uncommon_rune_mints,
        DROP COLUMN IF EXISTS fees_brc20_mints,
        DROP COLUMN IF EXISTS fees_src20_mints,
        DROP COLUMN IF EXISTS fees_cat21_mints,
        DROP COLUMN IF EXISTS fees_atomicals,
        DROP COLUMN IF EXISTS fees_inscription_mints,
        DROP COLUMN IF EXISTS inscriptions_total_envelope_size,
        DROP COLUMN IF EXISTS inscriptions_total_content_size,
        DROP COLUMN IF EXISTS inscriptions_largest_envelope_size,
        DROP COLUMN IF EXISTS inscriptions_largest_content_size,
        DROP COLUMN IF EXISTS inscriptions_largest_envelope_inscription_id,
        DROP COLUMN IF EXISTS inscriptions_largest_content_inscription_id,
        DROP COLUMN IF EXISTS inscriptions_average_envelope_size,
        DROP COLUMN IF EXISTS inscriptions_average_content_size,
        DROP COLUMN IF EXISTS runes_most_active_mint,
        DROP COLUMN IF EXISTS runes_most_active_non_uncommon_mint,
        DROP COLUMN IF EXISTS brc20_most_active_mint,
        DROP COLUMN IF EXISTS src20_most_active_mint;`);


       queries.push(`CREATE TABLE ordpool_stats (
          hash                                         VARCHAR(65) NOT NULL,
          height                                       INT(10) UNSIGNED NOT NULL,

          amounts_atomical                             INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_atomical_mint                        INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_atomical_transfer                    INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_atomical_update                      INT UNSIGNED NOT NULL DEFAULT 0,

          amounts_labitbu                              INT UNSIGNED NOT NULL DEFAULT 0,

          amounts_cat21                                INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_cat21_mint                           INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_cat21_transfer                       INT UNSIGNED NOT NULL DEFAULT 0,

          amounts_inscription                          INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_inscription_mint                     INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_inscription_transfer                 INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_inscription_burn                     INT UNSIGNED NOT NULL DEFAULT 0,

          amounts_rune                                 INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_rune_etch                            INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_rune_mint                            INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_rune_cenotaph                        INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_rune_transfer                        INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_rune_burn                            INT UNSIGNED NOT NULL DEFAULT 0,

          amounts_brc20                                INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_brc20_deploy                         INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_brc20_mint                           INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_brc20_transfer                       INT UNSIGNED NOT NULL DEFAULT 0,

          amounts_src20                                INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_src20_deploy                         INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_src20_mint                           INT UNSIGNED NOT NULL DEFAULT 0,
          amounts_src20_transfer                       INT UNSIGNED NOT NULL DEFAULT 0,

          fees_rune_mints                              INT UNSIGNED NOT NULL DEFAULT 0,
          fees_non_uncommon_rune_mints                 INT UNSIGNED NOT NULL DEFAULT 0,
          fees_brc20_mints                             INT UNSIGNED NOT NULL DEFAULT 0,
          fees_src20_mints                             INT UNSIGNED NOT NULL DEFAULT 0,
          fees_cat21_mints                             INT UNSIGNED NOT NULL DEFAULT 0,
          fees_atomicals                               INT UNSIGNED NOT NULL DEFAULT 0,
          fees_labitbus                                INT UNSIGNED NOT NULL DEFAULT 0,
          fees_inscription_mints                       INT UNSIGNED NOT NULL DEFAULT 0,

          inscriptions_total_envelope_size             INT UNSIGNED NOT NULL DEFAULT 0,
          inscriptions_total_content_size              INT UNSIGNED NOT NULL DEFAULT 0,
          inscriptions_largest_envelope_size           INT UNSIGNED NOT NULL DEFAULT 0,
          inscriptions_largest_content_size            INT UNSIGNED NOT NULL DEFAULT 0,

          -- assumptions: 64 (transaction ID) + 1 (i seperator) + 35 (index) = 100 characters, a 35 digits long index should be more than enough
          inscriptions_largest_envelope_inscription_id VARCHAR(100) CHARACTER SET ascii DEFAULT NULL,
          inscriptions_largest_content_inscription_id  VARCHAR(100) CHARACTER SET ascii DEFAULT NULL,

          inscriptions_average_envelope_size           INT UNSIGNED NOT NULL DEFAULT 0,
          inscriptions_average_content_size            INT UNSIGNED NOT NULL DEFAULT 0,

          -- this is the runes ID (block:tx)
          -- assumptions: 10 (block height) + 1 (: separator) + 7 (transaction index) = 18 characters, +2 to be very safe
          runes_most_active_mint                       VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
          runes_most_active_non_uncommon_mint          VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,

          -- Ticker names on Fractal Mainnet will be limited to 6 - 12 bytes.
          -- Tickers with 4 or 5 characters will not be permitted, as they are already in use on the Bitcoin mainnet.
          -- For brc-20 on Fractal, ticker names can include letters (both uppercase and lowercase: a-z/A-Z), numbers (0-9), and underscores (_).
          -- In total, you have 63 different characters to work with.
          -- Ticker names are not case-sensitive.
          -- https://docs.fractalbitcoin.io/doc/brc-20-on-fractal
          -- BUT there are are ticker names like '龙B' on mainnet --> we go full unicode to be safe
          -- 20 should be a save value
          brc20_most_active_mint                       VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,

          -- SRC20 ticker names on Bitcoin must must be 1-5 characters in length.
          -- https://github.com/stampchain-io/stamps_sdk/blob/main/docs/src20specs.md
          -- SRC20 ticker names on Fractal must be between 6 and 12 characters.
          -- https://docs.openstamp.io/introduction/src20-protocol/src20-on-fractal
          -- 20 should be a save value
          src20_most_active_mint                       VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,

          analyser_version                             INT UNSIGNED NOT NULL DEFAULT 0,

          PRIMARY KEY (hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

        queries.push(`CREATE TABLE ordpool_stats_rune_mint (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          hash VARCHAR(65) NOT NULL,
          height INT(10) UNSIGNED NOT NULL,
          -- the identifier for Rune mints is the Rune ID, which is a composite string in the format blockId:txNumber
          identifier VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          count INT NOT NULL,
          UNIQUE KEY (hash, identifier),
          INDEX idx_height (height)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

        queries.push(`CREATE TABLE ordpool_stats_brc20_mint (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          hash VARCHAR(65) NOT NULL,
          height INT(10) UNSIGNED NOT NULL,
          -- the identifier is the ticker of the token
          identifier VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
          count INT NOT NULL,
          UNIQUE KEY (hash, identifier),
          INDEX idx_height (height)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

        queries.push(`CREATE TABLE ordpool_stats_src20_mint (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          hash VARCHAR(65) NOT NULL,
          height INT(10) UNSIGNED NOT NULL,
          -- the identifier is the ticker of the token
          identifier VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
          count INT NOT NULL,
          UNIQUE KEY (hash, identifier),
          INDEX idx_height (height)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

        queries.push(`CREATE TABLE ordpool_stats_rune_etch (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          hash VARCHAR(65) NOT NULL,
          height INT(10) UNSIGNED NOT NULL,
          txid VARCHAR(65) NOT NULL,
          rune_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- Format: blockHeight:txIndex
          rune_name VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
          divisibility TINYINT UNSIGNED DEFAULT NULL, -- u8 range: 0-255
          premine DECIMAL(39, 0) DEFAULT NULL, -- u128 range: 0-340282366920938463463374607431768211455
          symbol VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
          cap DECIMAL(39, 0) DEFAULT NULL, -- u128 range: 0-340282366920938463463374607431768211455
          amount DECIMAL(39, 0) DEFAULT NULL, -- u128 range: 0-340282366920938463463374607431768211455
          offset_start BIGINT UNSIGNED DEFAULT NULL, -- u64 range: 0-18446744073709551615
          offset_end BIGINT UNSIGNED DEFAULT NULL, -- u64 range: 0-18446744073709551615
          height_start BIGINT UNSIGNED DEFAULT NULL, -- u64 range: 0-18446744073709551615
          height_end BIGINT UNSIGNED DEFAULT NULL, -- u64 range: 0-18446744073709551615
          turbo BOOLEAN DEFAULT NULL,
          UNIQUE KEY (hash, rune_id),
          INDEX idx_height (height)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

        queries.push(`CREATE TABLE ordpool_stats_brc20_deploy (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          hash VARCHAR(65) NOT NULL,
          height INT(10) UNSIGNED NOT NULL,
          txid VARCHAR(65) NOT NULL,
          ticker VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
          max_supply VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
          mint_limit VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
          decimals VARCHAR(5) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
          UNIQUE KEY (hash, ticker, txid),
          INDEX idx_height (height)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

        queries.push(`CREATE TABLE ordpool_stats_src20_deploy (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          hash VARCHAR(65) NOT NULL,
          height INT(10) UNSIGNED NOT NULL,
          txid VARCHAR(65) NOT NULL,
          ticker VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
          max_supply VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
          mint_limit VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
          decimals VARCHAR(5) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
          UNIQUE KEY (hash, ticker, txid),
          INDEX idx_height (height)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

        queries.push(`CREATE TABLE ordpool_stats_cat21_mint (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          hash VARCHAR(65) NOT NULL,
          height INT(10) UNSIGNED NOT NULL,
          txid VARCHAR(65) NOT NULL,
          tx_index INT UNSIGNED NOT NULL,
          number INT UNSIGNED DEFAULT NULL,
          fee_rate DOUBLE NOT NULL,
          block_time timestamp NOT NULL,
          fee BIGINT UNSIGNED NOT NULL,
          size INT UNSIGNED NOT NULL,
          weight INT UNSIGNED NOT NULL,
          value BIGINT UNSIGNED NOT NULL,
          sat BIGINT UNSIGNED DEFAULT NULL,
          first_owner VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
          genesis BOOLEAN NOT NULL,
          cat_colors VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
          gender ENUM('Male', 'Female') NOT NULL,
          design_index INT UNSIGNED NOT NULL,
          design_pose ENUM('Standing', 'Sleeping', 'Pouncing', 'Stalking') NOT NULL,
          design_expression ENUM('Smile', 'Grumpy', 'Pouting', 'Shy') NOT NULL,
          design_pattern ENUM('Solid', 'Striped', 'Eyepatch', 'Half/Half') NOT NULL,
          design_facing ENUM('Left', 'Right') NOT NULL,
          laser_eyes ENUM('Orange', 'Red', 'Green', 'Blue', 'None') NOT NULL,
          background ENUM('Block9', 'Cyberpunk', 'Whitepaper', 'Orange') NOT NULL,
          background_colors VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
          crown ENUM('Gold', 'Diamond', 'None') NOT NULL,
          glasses ENUM('Black', 'Cool', '3D', 'Nouns', 'None') NOT NULL,
          glasses_colors VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
          UNIQUE KEY (hash, tx_index),
          INDEX idx_height (height)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }

    // v2: align ordpool_stats columns with ordpool-parser v2.1.0 flag rework.
    //   - drop the 6 *_transfer / *_burn amount columns (atomical/cat21/inscription/rune):
    //     a stateless tx parser cannot fire transfer or burn flags (sat tracking required),
    //     so these columns held zeros for every block ever indexed.
    //   - add amount columns for the 4 promoted protocol-family flags (counterparty,
    //     stamp, src721, src101) which were already detected by the parser but had no DB column.
    //   - add 3 inscription content-type bucket columns (image / text / json) for the
    //     'what kind of inscriptions get inscribed?' chart.
    if (version <= 2) {
      queries.push(`ALTER TABLE ordpool_stats
        DROP COLUMN IF EXISTS amounts_atomical_transfer,
        DROP COLUMN IF EXISTS amounts_cat21_transfer,
        DROP COLUMN IF EXISTS amounts_inscription_transfer,
        DROP COLUMN IF EXISTS amounts_inscription_burn,
        DROP COLUMN IF EXISTS amounts_rune_transfer,
        DROP COLUMN IF EXISTS amounts_rune_burn,

        ADD COLUMN IF NOT EXISTS amounts_counterparty       INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amounts_stamp              INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amounts_src721             INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amounts_src101             INT UNSIGNED NOT NULL DEFAULT 0,

        ADD COLUMN IF NOT EXISTS amounts_inscription_image  INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amounts_inscription_text   INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amounts_inscription_json   INT UNSIGNED NOT NULL DEFAULT 0;`);
    }

    // v3: full ordpool_stats package + poison-block skip list + clean re-index.
    //
    //   1. ordpool_stats_skipped: poison-block tracking. The missing-stats
    //      indexer used to retry the same failing block forever — block
    //      869,599's corrupt brotli inscription crashed the parser every 2
    //      minutes for hours with no alarm. After K consecutive failures
    //      on the same height we upsert here and the missing-stats query
    //      excludes it. Recovery after a parser fix:
    //        DELETE FROM ordpool_stats_skipped;                    -- retry all
    //        DELETE FROM ordpool_stats_skipped WHERE height = X;   -- one block
    //
    //   2. Drop labitbu columns. Labitbu is a one-time event (10,000 WebPs
    //      in blocks 908,072–908,196). The flag still fires for that
    //      historical window in the parser, but block-level stats add no
    //      signal going forward.
    //
    //   3. Add inscription per-content-type size aggregates (image / text /
    //      json), per-bucket mint fees, compression telemetry. Each
    //      inscription lands in exactly one bucket (priority json > image >
    //      text). Lets us answer "are image inscriptions getting bigger?".
    //
    //   4. Add CAT-21 block aggregates (genesisCount, fee-rate min/avg/max).
    //      Cat *numbers* aren't recorded — those come from cat21-ord /
    //      cat21-indexer downstream.
    //
    //   5. Add rune block aggregates with UNCOMMON•GOODS split: every
    //      metric ships in pairs (overall + non-uncommon variant).
    //      UNCOMMON•GOODS (rune 1:0) dominates every "most active" stat in
    //      ~every block, so the non-uncommon variant is the second story
    //      worth recording alongside the headline.
    //
    //   6. Two new satellite tables: ordpool_stats_atomical_op (per atomical
    //      operation: mint / update with ticker for FT-family) and
    //      ordpool_stats_counterparty (per Counterparty message type, for
    //      per-message-type breakdown charts).
    //
    //   7. TRUNCATE everything and let the indexer rebuild. Existing rows
    //      were written under v2.1 parser semantics and now have new
    //      DEFAULT-0 columns. Cleanest path: wipe + re-index from
    //      firstInscriptionHeight on first restart.
    if (version <= 3) {
      queries.push(`CREATE TABLE IF NOT EXISTS ordpool_stats_skipped (
        height           INT(10) UNSIGNED NOT NULL,
        hash             VARCHAR(65) NOT NULL,
        first_failed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_failed_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        failure_count    INT UNSIGNED NOT NULL DEFAULT 1,
        last_error       TEXT DEFAULT NULL,
        PRIMARY KEY (height)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

      queries.push(`ALTER TABLE ordpool_stats
        DROP COLUMN IF EXISTS amounts_labitbu,
        DROP COLUMN IF EXISTS fees_labitbus,

        ADD COLUMN IF NOT EXISTS fees_inscription_image_mints  INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS fees_inscription_text_mints   INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS fees_inscription_json_mints   INT UNSIGNED NOT NULL DEFAULT 0,

        ADD COLUMN IF NOT EXISTS inscriptions_image_total_envelope_size              INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_image_total_content_size               INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_image_largest_envelope_size            INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_image_largest_content_size             INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_image_largest_envelope_inscription_id  VARCHAR(100) CHARACTER SET ascii DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS inscriptions_image_largest_content_inscription_id   VARCHAR(100) CHARACTER SET ascii DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS inscriptions_image_average_envelope_size            INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_image_average_content_size             INT UNSIGNED NOT NULL DEFAULT 0,

        ADD COLUMN IF NOT EXISTS inscriptions_text_total_envelope_size               INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_text_total_content_size                INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_text_largest_envelope_size             INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_text_largest_content_size              INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_text_largest_envelope_inscription_id   VARCHAR(100) CHARACTER SET ascii DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS inscriptions_text_largest_content_inscription_id    VARCHAR(100) CHARACTER SET ascii DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS inscriptions_text_average_envelope_size             INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_text_average_content_size              INT UNSIGNED NOT NULL DEFAULT 0,

        ADD COLUMN IF NOT EXISTS inscriptions_json_total_envelope_size               INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_json_total_content_size                INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_json_largest_envelope_size             INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_json_largest_content_size              INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_json_largest_envelope_inscription_id   VARCHAR(100) CHARACTER SET ascii DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS inscriptions_json_largest_content_inscription_id    VARCHAR(100) CHARACTER SET ascii DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS inscriptions_json_average_envelope_size             INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_json_average_content_size              INT UNSIGNED NOT NULL DEFAULT 0,

        ADD COLUMN IF NOT EXISTS inscriptions_brotli_count                INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_gzip_count                  INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inscriptions_compressed_envelope_bytes   INT UNSIGNED NOT NULL DEFAULT 0,

        ADD COLUMN IF NOT EXISTS cat21_genesis_count                      INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS cat21_avg_fee_rate                       DOUBLE       DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS cat21_min_fee_rate                       DOUBLE       DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS cat21_max_fee_rate                       DOUBLE       DEFAULT NULL,

        ADD COLUMN IF NOT EXISTS runes_unique_mints_count                 INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS runes_unique_mints_count_non_uncommon    INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS runes_top_mint_count                     INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS runes_top_mint_count_non_uncommon        INT UNSIGNED NOT NULL DEFAULT 0;`);

      queries.push(`CREATE TABLE IF NOT EXISTS ordpool_stats_atomical_op (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        hash        VARCHAR(65) NOT NULL,
        height      INT(10) UNSIGNED NOT NULL,
        txid        VARCHAR(65) NOT NULL,
        operation   ENUM('nft','ft','dft','dmt','dat','mod','evt','sl') NOT NULL,
        ticker      VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
        UNIQUE KEY (hash, txid, operation),
        INDEX idx_height (height)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

      queries.push(`CREATE TABLE IF NOT EXISTS ordpool_stats_counterparty (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        hash            VARCHAR(65) NOT NULL,
        height          INT(10) UNSIGNED NOT NULL,
        txid            VARCHAR(65) NOT NULL,
        message_type    VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        message_type_id INT UNSIGNED NOT NULL,
        UNIQUE KEY (hash, txid),
        INDEX idx_height (height),
        INDEX idx_message_type (message_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

      queries.push(`TRUNCATE TABLE ordpool_stats;`);
      queries.push(`TRUNCATE TABLE ordpool_stats_rune_mint;`);
      queries.push(`TRUNCATE TABLE ordpool_stats_brc20_mint;`);
      queries.push(`TRUNCATE TABLE ordpool_stats_src20_mint;`);
      queries.push(`TRUNCATE TABLE ordpool_stats_rune_etch;`);
      queries.push(`TRUNCATE TABLE ordpool_stats_brc20_deploy;`);
      queries.push(`TRUNCATE TABLE ordpool_stats_src20_deploy;`);
      queries.push(`TRUNCATE TABLE ordpool_stats_cat21_mint;`);
      queries.push(`TRUNCATE TABLE ordpool_stats_atomical_op;`);
      queries.push(`TRUNCATE TABLE ordpool_stats_counterparty;`);
    }

    if (version <= 4) {
      // ordpool_stats_atomical_op.operation was an ENUM with the 8 known
      // atomical opcodes. MariaDB returns "Data truncated for column
      // 'operation' at row 1" when an INSERT carries a value not in that
      // ENUM, which after POISON_THRESHOLD failures put the whole block
      // into ordpool_stats_skipped. Widen to VARCHAR(16) so unfamiliar
      // opcode strings just store as-is. Analytics that care about
      // 'nft' / 'ft' / 'dft' / etc. can still WHERE-filter, and unknown
      // values become a passive data point rather than a stop-the-block
      // event. Then clear ordpool_stats_skipped so the indexer requeues
      // the previously-poisoned blocks on the widened schema.
      queries.push(`ALTER TABLE ordpool_stats_atomical_op MODIFY COLUMN operation VARCHAR(16) NOT NULL;`);
      queries.push(`DELETE FROM ordpool_stats_skipped;`);
    }

    // v5: stamp + atomical content-type bucket counters.
    //
    // Mirrors the inscription_image/text/json triple added in v2 but for
    // stamps and atomicals. Backfill is purge-driven, not destructive:
    // delete only the per-block summary rows that had a stamp or atomical,
    // so the missing-stats indexer re-picks those blocks (the satellite
    // tables ordpool_stats_atomical_op/counterparty are idempotent on
    // re-insert via ON DUPLICATE KEY UPDATE, so they don't need touching).
    // Blocks with no stamps and no atomicals are unaffected — no point
    // re-indexing them just to set six zero counters.
    if (version <= 5) {
      queries.push(`ALTER TABLE ordpool_stats
        ADD COLUMN IF NOT EXISTS amounts_stamp_image     INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amounts_stamp_text      INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amounts_stamp_json      INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amounts_atomical_image  INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amounts_atomical_text   INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amounts_atomical_json   INT UNSIGNED NOT NULL DEFAULT 0;`);

      queries.push(`DELETE FROM ordpool_stats WHERE amounts_stamp > 0 OR amounts_atomical > 0;`);
      queries.push(`DELETE FROM ordpool_stats_skipped;`);
    }

    if (version <= 6) {
      // OpenTimestamps calendar commits. ONE row per OTS commit txid the
      // backend has observed via calendar-server polling. Populated by
      // OrdpoolOtsPoller (api/ots/ordpool-ots-poller.ts) and an in-memory
      // Set<string> snapshot of every txid here is what the per-tx
      // pre-enrichment uses to OR ordpool_ots into _ordpoolFlags.
      //
      // - merkle_root is the 32-byte OP_RETURN payload (the calendar's
      //   tip at broadcast); useful for tx-page display + external
      //   .ots receipt verification.
      // - confirmed_at + blockhash/blockheight/blocktime/fee/feerate are
      //   filled in once the tx confirms (pending rows have NULLs).
      // - ascii_bin keeps txid + blockhash comparisons exact and fast.
      queries.push(`
        CREATE TABLE IF NOT EXISTS ordpool_stats_ots (
          txid              CHAR(64)        NOT NULL PRIMARY KEY,
          calendar          VARCHAR(16)     NOT NULL,
          merkle_root       BINARY(32)      NOT NULL,
          first_seen_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
          confirmed_at      DATETIME        NULL,
          blockhash         CHAR(64)        NULL,
          blockheight       INT UNSIGNED    NULL,
          blocktime         INT UNSIGNED    NULL,
          fee               INT             NULL,
          feerate           DECIMAL(8,2)    NULL,
          INDEX idx_blockheight (blockheight),
          INDEX idx_calendar_blockheight (calendar, blockheight),
          INDEX idx_first_seen (first_seen_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;
      `);
    }

    // Re-index blocks affected by two parser fixes shipped in
    // ordpool-parser v2.4.4 + v2.4.5 (commit 599f414):
    //
    //  1. SRC-20 numeric-amt validator. getSrc20Flaws used to require
    //     typeof amt === 'string', silently dropping every SRC-20
    //     deploy/mint/transfer that wrote `"amt":100` instead of
    //     `"amt":"100"` (same for `max`/`lim`/`dec` on deploys). The
    //     canonical spec accepts both forms. Affects amounts_src20_*
    //     and the ordpool_stats_src20_mint / _deploy satellites.
    //
    //  2. Rune turbo decode (inherited from upstream
    //     magicoss/runestone-lib runestone.ts:123, `etchingResult.set`
    //     where it should be `turboResult.set`). Corrupts the turbo
    //     column in ordpool_stats_rune_etch.
    //
    // Satellite tables get rewritten via ON DUPLICATE KEY UPDATE on the
    // next index pass (same approach as v5).
    if (version <= 7) {
      queries.push(`DELETE FROM ordpool_stats WHERE amounts_src20 > 0 OR amounts_rune_etch > 0;`);
    }

    // Re-index blocks where the Stamps-family parent flag state may flip
    // under the v2.4.6 validator gates: ordpool_src20 / _src721 / _src101
    // now only fire when the canonical validator passes. Satellites rewrite
    // via ON DUPLICATE KEY UPDATE on the next index pass.
    if (version <= 8) {
      queries.push(`DELETE FROM ordpool_stats WHERE amounts_src20 > 0 OR amounts_src721 > 0 OR amounts_src101 > 0;`);
    }

    return queries;
  }

  /**
   * Save the schema version in the database
   */
  private getUpdateToLatestSchemaVersionQuery(): string {
    return `UPDATE state SET number = ${OrdpoolDatabaseMigration.currentVersion} WHERE name = 'ordpool_schema_version';`;
  }
}

export default new OrdpoolDatabaseMigration();
