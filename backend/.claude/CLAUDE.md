# CLAUDE.md

Backend for `ordpool-space/ordpool`: a `mempool/mempool` fork with ordpool indexing for digital artifacts (inscriptions, runes, BRC-20, SRC-20, CAT-21, atomicals). Repo-wide rules live in the repo-root `CLAUDE.md`; this file is backend-specific.

## HARD RULE: Keep useful comments
- Don't strip JSDoc or "why" inline comments as "simplification". Trim the text inside; keep the block.
- Backend-specific keepers a reader can't reconstruct from code: route-handler example URLs, alkanes / OTS / parser-flag linkage notes, migration-generation cross-references.
Ref: workspace `CLAUDE.md` "Keep useful comments (JSDoc AND inline 'why')"; rollback `6a880bfd3`.

## Node version
Node.js v24 (`.nvmrc`) plus a Rust toolchain for the native `rust-gbt` module, built during `npm install` (needs `rustc`/`cargo`, via `rustup` or `brew install rustup`).

## Prerequisites
| Service | Port | Required | Notes |
|---|---|---|---|
| Bitcoin Core RPC | 8332 | Yes | via SSH tunnel or local |
| Electrs (Esplora API) | 3000 | Yes | ordpool-electrs fork |
| MariaDB | 3306 | Yes | defaults in `mempool-config.sample.json` |
| Redis | 6379 | Optional | caches between restarts |

bitcoind + electrs come easiest via the SSH tunnel (see the workspace `CLAUDE.md`). Local services:
```bash
brew install mariadb && brew services start mariadb   # create DB + user per mempool-config.sample.json
brew install redis   && brew services start redis
```

## First-time setup and development
```bash
cp mempool-config.sample.json mempool-config.json   # edit credentials; override only what differs. Sections: CORE_RPC, ESPLORA, DATABASE, REDIS
npm install               # also builds rust-gbt from ../rust/gbt (if it fails, install rustc/cargo)
npm start                 # build + run on port 8999 (MEMPOOL.HTTP_PORT), 4GB heap; runs DB migrations on startup
npm run tsc               # compile only, no run
npm run build             # tsc + create-resources
npm run start-production  # runs with 16GB heap
npm test                  # Jest unit tests
npm run test:ci           # CI mode with coverage
```
Lint scripts (`npm run lint` / `lint:fix` / `prettier`) exist but must NOT be run: see repo-root `CLAUDE.md` "Linting is FORBIDDEN".

## Dependency: ordpool-parser
- Imported by git SHA in `package.json`: `"ordpool-parser": "github:ordpool-space/ordpool-parser#<sha>"`. Its `prepare` script runs `npm run build` on install, so the compiled output is always fresh.
- Bumping the SHA: edit `package.json`, run `npm install` to regenerate `package-lock.json`, commit BOTH. CI caches `node_modules` by lockfile hash; a SHA-only change restores stale `node_modules` and `prepare` never re-runs.
- Local live-dev (no commit): `cd ordpool-parser && npm run build && cd dist && npm link`, then `npm link ordpool-parser` in `backend/`.
- Key imports: `DigitalArtifactAnalyserService`, `InscriptionParserService`, `InscriptionPreviewService`, `convertVerboseBlockToSimplePlus`, `getFirstInscriptionHeight`.

## HARD RULE: Ordpool flags are computed in getTransactionFlags, everywhere, functionally
- Every ordpool flag (`ordpool_inscription`, `ordpool_rune`, `ordpool_cat21`, `ordpool_atomical`, `ordpool_src20`, `ordpool_labitbu`; type flags `ordpool_counterparty`, `ordpool_stamp`, `ordpool_src721`, `ordpool_src101`, `ordpool_ots`; sub-op flags) is applied on every path (mempool, confirmed blocks, lookups, WebSocket, frontend), computed inside `getTransactionFlags`, never as a post-processing step.
- Pattern: functional return value, no side-channel mutation. `Common.getTransactionFlags()` (`src/api/common.ts`, async) ends with `flags = await DigitalArtifactAnalyserService.analyseTransaction(tx, flags)`; above the early-return it does `flags |= getOtsFlag(tx.txid)` (`src/api/ordpool-ots-flag.ts`).
- Block extension calls `await DigitalArtifactAnalyserService.analyseTransactions(txs)` for the per-block `ordpoolStats`; the OTS bit still lands on `tx.flags` via the same `getOtsFlag(tx.txid)` inside `Common.getTransactionFlags` on the per-tx path.
- Frontend mirror `getTransactionFlags` (`src/app/shared/transaction.utils.ts`) is also async, returns the merged bigint, plus `OtsKnowledgeService.isOtsCommit(tx)` for the strip-wire OTS case.
- No `_ordpoolFlags` side-channel in our code; the parser's own `_ordpoolFlags` mutation is upstream and unread in this fork.
- Regression spec: `frontend/src/app/shared/transaction.utils.spec.ts` asserts Counterparty mpma tx `4a412b0a...4788e` gets `ordpool_counterparty` (bit 55). Keep green.
<!-- long-rule: flag list + backend/frontend call path -->

## Code marking convention (merge-friendly)
Fork of mempool.space; mark ordpool changes so upstream merges stay clean.
- Inline: `// HACK --- Ordpool Flags`, `// HACK -- Ordpool stats`, `// HACK for Ordpool: <reason>` (e.g. increase the `GROUP_CONCAT` maximum length).
- File naming: `ordpool-` prefix (`ordpool-indexer.ts`, `ordpool-database-migration.ts`, `ordpool-missing-blocks.ts`, `ordpool-missing-stats.ts`).
- Dirs: `src/api/explorer/_ordpool/` (statistics API, inscription endpoints, config); `src/repositories/OrdpoolBlocksRepository.ts`.
- NEVER delete upstream code; comment it out with `/* HACK -- Ordpool: reason */` to preserve it for future merges.

## Ordpool database tables
Created by `ordpool-database-migration.ts` on startup:
- `ordpool_stats` (per-block inscription/rune/BRC-20/SRC-20/CAT-21/atomical counts)
- `ordpool_stats_rune_mint`, `ordpool_stats_rune_etch` (rune activity per block)
- `ordpool_stats_brc20_mint`, `ordpool_stats_brc20_deploy` (BRC-20 activity)
- `ordpool_stats_src20_mint`, `ordpool_stats_src20_deploy` (SRC-20 activity)
- `ordpool_stats_cat21_mint` (CAT-21 mint records with traits)

## HARD RULE: Migrations are IMMUTABLE
- Each `if (version <= N)` block in `ordpool-database-migration.ts` is frozen the moment `currentVersion = N` ships. It has already run on production; never edit it retroactively.
- Schema changes go on TOP, not in place: bump `currentVersion`, add a new block.
- Same rule for upstream-style migrations in `database-migration.service.ts`.
- Only legitimate exception: the pre-v1 `DROP COLUMN IF EXISTS` cleanup block at the top of v1 (committed before the schema was tagged v1).
```ts
private static currentVersion = 2;                                            // bump, don't edit v1
if (version <= 1) { queries.push(`CREATE TABLE ordpool_stats (...)`); }        // unchanged
if (version <= 2) { queries.push(`ALTER TABLE ordpool_stats ADD COLUMN ...`); } // new block on top
```
Why: a fresh install replays all blocks in order; an existing install runs only the new blocks. Both converge only if shipped blocks never change. Editing a shipped block gives fresh installs a schema no production DB ever had, and a later ALTER can collide.
<!-- long-rule: migration versioning example -->

## Architecture
- Entry: `src/index.ts` (Express + WebSocket, cluster management, migration runner, main polling loop)
- Indexer: `src/ordpool-indexer.ts` (batch block processing for ordpool stats)
- Routes: `src/api/explorer/_ordpool/ordpool.routes.ts`
  - `GET /api/v1/ordpool/statistics/:type/:interval/:aggregation`
  - `GET /content/:inscriptionId` (raw inscription content)
  - `GET /preview/:inscriptionId` (preview with rendering instructions)
- Database: `src/database.ts` (MySQL connection pool via mysql2)
- Config: `src/config.ts` (merges `mempool-config.json` with defaults)
