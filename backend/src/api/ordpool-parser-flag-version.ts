/**
 * Single source of truth for "what generation of ordpool-parser flag bits
 * the running code understands". Bump this every time the parser adds a
 * new flag bit OR changes the semantics of an existing one.
 *
 * Two consumers MUST refresh when this bumps. Both reference this
 * constant directly so the linkage is grep-able:
 *
 *   1. blocks_summaries (per-tx flag cache)
 *      ORDPOOL_BLOCK_SUMMARY_VERSION in src/api/blocks.ts re-exports this
 *      value. The classify loop reads summaries below this version and
 *      re-runs analyseTransactions, refreshing the cached per-tx flag
 *      bytes that drive block-overview chip colours.
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
 * Generation history (paired migration version in parens):
 *   1 -- initial flag set                                       (migration v1)
 *   2 -- stamps-family (counterparty / src721 / src101 / ...)   (migration v5)
 *   3 -- ordpool_ots                                            (migration v6)
 *   4 -- ordpool_alkanes (parser v2.4.8)                        (migration v9)
 */
export const ORDPOOL_PARSER_FLAG_GENERATION = 4;
