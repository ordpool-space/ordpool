# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Frontend: ordpool (Angular 20)

Fork of mempool.space frontend with Ordinals customizations. After the upstream-merge in April 2026 the stack is Angular 20 + Bootstrap 5 + Node 24 (was Angular 17 / Bootstrap 4 / Node 20 in v1).

### Node Version

Requires **Node.js v24** (see `.nvmrc`). The CI workflows pin `node-version: 24`.

### First-Time Setup

```bash
npm install
npm run config:defaults:ordpool   # generates src/resources/config.js with Ordpool settings
```

The config step runs `update-config.js` to set `BASE_MODULE=ordpool`, then `generate-config.js` to produce `src/resources/config.js`. You only need to re-run this if you change the config.

### Development (the main workflow)

```bash
npm start
```

This is the alias for:
```bash
npm run generate-config && npm run sync-assets-dev && ng serve -c local-esplora
```

It starts the Angular dev server on `http://localhost:4200` using the `local-esplora` configuration, which proxies API calls to local services via `proxy.conf.local-esplora.js`:

| Route | Target | What |
|-------|--------|------|
| `/api/v1/**` | `http://127.0.0.1:8999` | ordpool backend (WebSocket + REST) |
| `/api/**` | `http://127.0.0.1:3000` | electrs (Esplora API), path rewritten to strip `/api` |
| `/content/**`, `/preview/**` | `http://127.0.0.1:8999` | ordpool backend (inscription content/previews) |
| `/r/**` | `https://ordinals.com` | recursive inscription endpoints |

**Before running `npm start`**, you need either:
- A private SSH tunnel which forwards ports 8332 (bitcoind) and 3000 (electrs) to a dedicated machine
- Or the backend running locally on port 8999 + electrs on port 3000

### Production Build

```bash
npm run build
```

This runs: `generate-config` → `ng build --configuration production --localize` → `sync-assets-dev` → `sync-assets` → `build-mempool.js`

Note: `sync-assets` (`sync-assets.js`) downloads mining pool logos and other remote assets. It will fail if the remote server is unreachable. The Angular compilation itself happens before this step.

### Tests

```bash
npm test                # Jest unit tests
npm run cypress:open    # Cypress E2E (interactive, needs running dev server on :4200)
npm run cypress:run     # Cypress E2E (headless)
```

### Linting

```bash
npm run lint            # ESLint
npm run lint:fix        # ESLint with auto-fix
npm run prettier        # Prettier formatting
```

### Code Marking Convention (for merge-friendly changes)

This is a fork of mempool.space. To keep changes isolated and merges manageable, ordpool-specific code follows a three-tier marking system:

**1. Inline markers (`// HACK`)** — Used when modifying existing mempool files. Mark the insertion point so it's easy to find during merges:
```
// HACK --- Ordpool Flags
// HACK -- Ordpool stats
// HACK -- ordpoolColorFunction
<!-- HACK: START Ordpool Stats --> ... <!-- HACK: END Ordpool Stats -->
```

**2. File naming** — Ordpool-specific alternative files use a `.ordpool.*` suffix:
- `src/index.ordpool.html` — Ordpool entry point HTML
- `src/app/master-page.module.ordpool.ts` — Ordpool-specific Angular module
- Dedicated files use the `ordpool-` prefix (e.g., `ordpool-api.service.ts`)

**3. Directory structure** — Ordpool-exclusive components live in `_ordpool/` directories (underscore prefix keeps them sorted at the top):
- `src/app/components/_ordpool/` — All ordpool UI components (digital artifact viewers, CAT-21 mint, wallet connect, stats, etc.)
- CSS overrides: `src/styles-ordpool-overrides1.scss`, `src/styles-ordpool-overrides2.scss`

**When modifying existing mempool files**, always add a `// HACK` comment to mark the change. When adding new ordpool-only functionality, put it in an `_ordpool/` directory or a file with `ordpool-` prefix. This keeps the diff clean for upstream merges.

**NEVER delete upstream code.** Always comment it out with a `/* HACK -- Ordpool: ... */` block comment instead. This preserves the original code for future merges and makes it obvious what was disabled.

### Dependency: ordpool-parser

The frontend depends on `ordpool-parser` via a git SHA ref in `package.json`:
```json
"ordpool-parser": "github:ordpool-space/ordpool-parser#<sha>"
```

The `prepare` script in ordpool-parser runs `npm run build` on install, so the compiled output is always fresh.

**CRITICAL: When updating the git SHA, ALWAYS run `npm install` afterwards to regenerate `package-lock.json`, then commit BOTH files together.** CI caches `node_modules` keyed by the lockfile hash. If you update the SHA without updating the lockfile, CI restores stale `node_modules` from cache and the build fails with missing types.

```bash
# Correct workflow for bumping ordpool-parser:
# 1. Update the SHA in package.json
# 2. Run npm install to regenerate the lockfile
npm install
# 3. Commit BOTH package.json AND package-lock.json
git add package.json package-lock.json
git commit -m "bump ordpool-parser to <sha>"
```

For local development with live changes (no commit needed):
```bash
# In ordpool-parser/
npm run build && cd dist && npm link

# In ordpool/frontend/
npm link ordpool-parser
```

### Config Modes

| Command | Sets |
|---------|------|
| `npm run config:defaults:ordpool` | `BASE_MODULE=ordpool`, `MEMPOOL_WEBSITE_URL=https://ordpool.space` |
| `npm run config:defaults:mempool` | Full mempool config (testnet, signet, liquid enabled) |
| `npm run config:defaults:liquid` | Liquid-focused config |
