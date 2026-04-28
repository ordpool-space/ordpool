# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Backend: ordpool (Express + TypeScript)

Fork of mempool.space backend with ordpool indexing for digital artifacts (inscriptions, runes, BRC-20, SRC-20, CAT-21, atomicals).

### Node Version

Requires **Node.js v24** (see `.nvmrc`). Also requires a **Rust toolchain** for the native `rust-gbt` module (built during `npm install`).

### Prerequisites

The backend connects to these services:

| Service | Port | Required | Notes |
|---------|------|----------|-------|
| Bitcoin Core RPC | 8332 | Yes | Via SSH tunnel or local |
| Electrs (Esplora API) | 3000 | Yes | ordpool-electrs fork |
| MariaDB | 3306 | Yes | See `mempool-config.sample.json` for defaults |
| Redis | 6379 | Optional | Recommended — speeds up dev by caching between restarts |

**Easiest way to get bitcoind + electrs**: Use the SSH tunnel (see top-level CLAUDE.md for details).

**Local MariaDB setup:**
```bash
brew install mariadb
brew services start mariadb
```
Create the database and user as shown in `mempool-config.sample.json`.

**Local Redis setup:**
```bash
brew install redis
brew services start redis
```

### First-Time Setup

```bash
cp mempool-config.sample.json mempool-config.json   # then edit credentials
npm install              # also builds rust-gbt native module from ../rust/gbt
```

If `rust-gbt` build fails, make sure `rustc` and `cargo` are installed (`rustup` or `brew install rustup`).

### Configuration

Config file: `mempool-config.json` (copy from `mempool-config.sample.json`). Only override what differs from the defaults. Key sections: `CORE_RPC`, `ESPLORA`, `DATABASE`, `REDIS`.

### Development

```bash
npm start                # builds + runs (4GB heap limit)
npm run tsc              # compile TypeScript only (no run)
npm run build            # full build (tsc + create-resources)
npm run start-production # runs with 16GB heap
```

The backend starts on **port 8999** by default (`MEMPOOL.HTTP_PORT`).

On startup it runs database migrations automatically, including ordpool-specific tables (`ordpool-database-migration.ts`).

### Tests

```bash
npm test                 # Jest unit tests
npm run test:ci          # CI mode with coverage
```

### Linting

```bash
npm run lint             # ESLint
npm run lint:fix         # ESLint with auto-fix
npm run prettier         # Prettier formatting
```

### Dependency: ordpool-parser

The backend imports `ordpool-parser` for transaction analysis. For development with local changes:

```bash
# In ordpool-parser/
npm run build && cd dist && npm link

# In ordpool/backend/
npm link ordpool-parser
```

Key imports: `DigitalArtifactAnalyserService`, `InscriptionParserService`, `InscriptionPreviewService`, `convertVerboseBlockToSimplePlus`, `getFirstInscriptionHeight`.

### HARD RULE: Ordpool Flags Must Be Applied Everywhere

Ordpool transaction flags (`ordpool_inscription`, `ordpool_rune`, `ordpool_cat21`, `ordpool_atomical`, `ordpool_src20`, `ordpool_labitbu`) MUST be applied to every transaction, everywhere -- mempool, confirmed blocks, individual lookups, WebSocket, frontend. They must be computed together with the upstream flags in `getTransactionFlags`, not as a post-processing step.

**To avoid cascading async changes to upstream code**, use `quickAnalyseTransaction` (sync) for per-transaction flags, NOT `analyseTransaction` (async). The async deep analysis (`analyseTransactions`) is only for per-block `ordpoolStats` in `$getBlockExtended`. This keeps all upstream function signatures untouched (no async/await changes needed in `Common.getTransactionFlags`, `classifyTransaction`, `classifyTransactions`, `summarizeBlockTransactions`, `processBlockTemplates`, `dataToMempoolBlocks`, etc.).

### Code Marking Convention (for merge-friendly changes)

This is a fork of mempool.space. Ordpool-specific changes follow the same marking system as the frontend:

**1. Inline markers (`// HACK`)** — When modifying existing mempool files:
```
// HACK --- Ordpool Flags
// HACK -- Ordpool stats
// HACK for Ordpool: increase the GROUP_CONCAT maximum length
```

**2. File naming** — Ordpool-dedicated files use `ordpool-` prefix:
`ordpool-indexer.ts`, `ordpool-database-migration.ts`, `ordpool-missing-blocks.ts`, `ordpool-missing-stats.ts`

**3. Directory structure** — Ordpool-exclusive API routes live in `_ordpool/` directories:
- `src/api/explorer/_ordpool/` — Statistics API, inscription endpoints, config
- `src/repositories/OrdpoolBlocksRepository.ts` — Dedicated repository

**NEVER delete upstream code. Always comment it out** with `/* HACK -- Ordpool: reason */` to preserve it for future merges.

### Ordpool Database Tables

Created by `ordpool-database-migration.ts` on startup:

- `ordpool_stats` — Per-block statistics (inscription/rune/BRC-20/SRC-20/CAT-21/atomical counts)
- `ordpool_stats_rune_mint`, `ordpool_stats_rune_etch` — Rune activity per block
- `ordpool_stats_brc20_mint`, `ordpool_stats_brc20_deploy` — BRC-20 activity
- `ordpool_stats_src20_mint`, `ordpool_stats_src20_deploy` — SRC-20 activity
- `ordpool_stats_cat21_mint` — CAT-21 mint records with traits

### HARD RULE: Migrations are IMMUTABLE

**Each version block in `ordpool-database-migration.ts` is frozen the moment it ships.** Once `currentVersion = N` has been deployed against any database, the queries inside `if (version <= N)` are part of recorded history. They have already run on production and possibly on multiple developer machines. **Never edit them retroactively.**

Schema changes go on TOP, not in PLACE.

Wrong:
```ts
private static currentVersion = 1;
if (version <= 1) {
  queries.push(`CREATE TABLE ordpool_stats (... amounts_inscription_transfer ...)`);  // edit this to remove the column ❌
}
```

Right:
```ts
private static currentVersion = 2;  // bump
if (version <= 1) {
  queries.push(`CREATE TABLE ordpool_stats (... amounts_inscription_transfer ...)`);  // unchanged
}
if (version <= 2) {
  queries.push(`ALTER TABLE ordpool_stats DROP COLUMN amounts_inscription_transfer, ...`);
  queries.push(`ALTER TABLE ordpool_stats ADD COLUMN amounts_stamp ..., ...`);
}
```

Why this matters: a fresh install at v0 runs both blocks in order and ends up at the current schema. A v1 install only runs the v2 block and ends up at the same schema. Both paths converge. If you edit v1 retroactively, fresh installs end up with a schema that no v1 production database has ever had — divergence — and the v2 ALTER for an existing v1 prod database may collide (DROP a column that v1 never created in your edited version, etc.).

The "manual cleanup all previous attempts" defensive `DROP COLUMN IF EXISTS` block at the top of v1 is the *only* legitimate exception — it's pre-v1 cleanup committed before the schema was tagged as v1. Once a version ships, the slate is fixed.

Same rule applies to every migration in this repo, including upstream-mempool-style migrations in `database-migration.service.ts`.

### Architecture

- **Entry point**: `src/index.ts` — Express server + WebSocket, cluster management, migration runner, main polling loop
- **Ordpool indexer**: `src/ordpool-indexer.ts` — Orchestrates batch processing of blocks for ordpool stats
- **API routes**: `src/api/explorer/_ordpool/ordpool.routes.ts`
  - `GET /api/v1/ordpool/statistics/:type/:interval/:aggregation`
  - `GET /content/:inscriptionId` — Raw inscription content
  - `GET /preview/:inscriptionId` — Preview with rendering instructions
- **Database**: `src/database.ts` — MySQL connection pool via mysql2
- **Config**: `src/config.ts` — Merges `mempool-config.json` with defaults
