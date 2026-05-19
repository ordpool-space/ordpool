/**
 * Single source of truth for "what generation of ordpool-parser flag bits
 * the running code understands". Bump this every time the parser adds a
 * new flag bit OR changes the semantics of an existing one.
 *
 * Two consumers MUST refresh when this bumps -- both reference this
 * constant directly so the linkage is grep-able and you can't forget one:
 *
 *   1. blocks_summaries (per-tx flag cache)
 *      ORDPOOL_BLOCK_SUMMARY_VERSION in src/api/blocks.ts re-exports this
 *      value. The Classified loop reads summaries below this version and
 *      re-runs analyseTransactions on those blocks, refreshing the cached
 *      per-tx flag bytes that drive block-overview chip colours.
 *
 *   2. ordpool_stats (per-block aggregates)
 *      Requires a new version block in OrdpoolDatabaseMigration that
 *      wipes affected rows -- typically
 *        DELETE FROM ordpool_stats WHERE amounts_<protocol> > 0;
 *      The indexer's missing-block backfill then re-fills with current
 *      flag bytes. Migration version increments INDEPENDENTLY from flag
 *      generation (DDL changes also bump it), but every generation bump
 *      must be paired with a migration block.
 *
 * History (and the migration version that paired with each bump):
 *   1 -- initial flag set                                    (migration v1)
 *   2 -- stamps-family (counterparty / src721 / src101 / ...)  (migration v5)
 *   3 -- ordpool_ots                                         (migration v6)
 *   4 -- ordpool_alkanes (parser v2.4.8)                     (migration v9)
 *
 * BEFORE BUMPING:
 *   - Write a new version block in ordpool-database-migration.ts that
 *     wipes stale ordpool_stats rows for the affected protocol(s).
 *   - Add a line to this history.
 *
 * Forgetting step one leaves the per-block stats UI stale even though
 * per-tx chips refresh; that's exactly the bug the parser v2.4.8 ship
 * introduced when we bumped only the summary version and not the
 * migration. Don't repeat that.
 */
export const ORDPOOL_PARSER_FLAG_GENERATION = 4;
