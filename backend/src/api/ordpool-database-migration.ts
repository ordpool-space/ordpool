import DB from '../database';
import logger from '../logger';

class OrdpoolDatabaseMigration {

  // change this after every update
  private static currentVersion = 2;

  private queryTimeout = 3600_000;

  /**
   * Entry point
   */
  public async $initializeOrMigrateDatabase(): Promise<void> {
    logger.debug('ORDPOOL MIGRATIONS: Running migrations');

    const ordpoolDatabaseSchemaVersion = await this.$getOrdpoolSchemaVersionFromDatabase();

    if (ordpoolDatabaseSchemaVersion === 0) {
      logger.info('Changing database to Ordpool schema!');
      await this.$executeQuery(`INSERT INTO state VALUES('ordpool_schema_version', 0, NULL);`);
    }

    logger.debug('ORDPOOL MIGRATIONS: Current state.ordpool_schema_version ' + ordpoolDatabaseSchemaVersion);
    logger.debug('ORDPOOL MIGRATIONS: Latest OrdpoolDatabaseMigration.currentVersion is ' + OrdpoolDatabaseMigration.currentVersion);

    if (ordpoolDatabaseSchemaVersion >= OrdpoolDatabaseMigration.currentVersion) {
      logger.debug('ORDPOOL MIGRATIONS: Nothing to do.');
      return;
    }

    if (OrdpoolDatabaseMigration.currentVersion > ordpoolDatabaseSchemaVersion) {
      try {
        await this.$migrateTableSchemaFromVersion(ordpoolDatabaseSchemaVersion);
        logger.notice(`ORDPOOL MIGRATIONS: OK. Database schema have been migrated from version ${ordpoolDatabaseSchemaVersion} to ${OrdpoolDatabaseMigration.currentVersion} (latest version)`);
      } catch (e) {
        logger.err('ORDPOOL MIGRATIONS: Unable to migrate database, aborting. ' + e);
      }
    }

    return;
  }

  /**
   * Small query execution wrapper to log all executed queries
   */
  private async $executeQuery(query: string, silent = false): Promise<any> {
    if (!silent) {
      logger.debug('ORDPOOL MIGRATIONS: Execute query:\n' + query);
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

    logger.notice(`ORDPOOL MIGRATIONS: ${version > 0 ? 'Upgrading' : 'Initializing'} database schema version number to ${OrdpoolDatabaseMigration.currentVersion}`);
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
   */
  private getMigrationQueriesFromVersion(version: number): string[] {
    const queries: string[] = [];

    if (version < 1) {

      queries.push(`ALTER TABLE blocks ADD amount_atomical               INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_atomical_mint          INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_atomical_transfer      INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_atomcial_update        INT UNSIGNED NULL DEFAULT NULL`);

      queries.push(`ALTER TABLE blocks ADD amount_cat21                  INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_cat21_mint             INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_cat21_transfer         INT UNSIGNED NULL DEFAULT NULL`);

      queries.push(`ALTER TABLE blocks ADD amount_inscription            INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_inscription_mint       INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_inscription_transfer   INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_inscription_burn       INT UNSIGNED NULL DEFAULT NULL`);

      queries.push(`ALTER TABLE blocks ADD amount_runestone              INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_rune_etch              INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_rune_transfer          INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_rune_burn              INT UNSIGNED NULL DEFAULT NULL`);

      queries.push(`ALTER TABLE blocks ADD amount_brc20                  INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_brc20_deploy           INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_brc20_mint             INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_brc20_transfer         INT UNSIGNED NULL DEFAULT NULL`);

      queries.push(`ALTER TABLE blocks ADD amount_src20                  INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_src20_deploy           INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_src20_mint             INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`ALTER TABLE blocks ADD amount_src20_transfer         INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`TRUNCATE blocks`);
    }

    if (version < 2) {

      queries.push(`ALTER TABLE table_name RENAME COLUMN amount_atomcial_update TO amount_atomical_update;`);
      queries.push(`ALTER TABLE table_name RENAME COLUMN amount_runestone       TO amount_rune;`);

      queries.push(`ALTER TABLE blocks ADD amount_rune_mint              INT UNSIGNED NULL DEFAULT NULL   AFTER amount_rune_etch`);
      queries.push(`ALTER TABLE blocks ADD amount_rune_cenotaph          INT UNSIGNED NULL DEFAULT NULL   AFTER amount_rune_mint`);
      queries.push(`ALTER TABLE blocks ADD analyser_version              INT UNSIGNED NULL DEFAULT NULL`);
      queries.push(`TRUNCATE blocks`);
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
