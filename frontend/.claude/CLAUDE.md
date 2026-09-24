# CLAUDE.md

Frontend for `ordpool-space/ordpool`: a `mempool/mempool` fork (Angular 20 + Bootstrap 5 + Node 24) with Ordinals customizations. Repo-wide rules live in the repo-root `CLAUDE.md`; this file is frontend-specific.

**E2E:** the workspace `E2E_BEST_PRACTICES.md` codifies our Playwright rules. The `cypress/` suite here is legacy upstream mempool code, out of scope for those rules: do not audit or port; touch only when a bug fix genuinely lives there. An ordpool-owned Playwright surface (workspace `ordpool/e2e/`) will land later and follow the doc from day one.

## HARD RULE: Keep useful comments
- Don't strip JSDoc or "why" inline comments as "simplification". Trim the text inside; keep the block.
- Frontend-specific keepers: viewer-component design rationale (alkanes-vs-runes split, ots-viewer tristate semantics, block-protocol-section structure), service caching/dedupe notes.
Ref: workspace `CLAUDE.md` "Keep useful comments (JSDoc AND inline 'why')".

## Node version
Node.js v24 (`.nvmrc`); CI pins `node-version: 24`.

## First-time setup and development
```bash
npm install
npm run config:defaults:ordpool   # update-config.js sets BASE_MODULE=ordpool, then generate-config.js writes src/resources/config.js; re-run only if config changes
npm start                          # = generate-config && sync-assets-dev && ng serve -c local-esplora, on http://localhost:4200
```
`npm start` needs local services: either an SSH tunnel forwarding 8332 (bitcoind) + 3000 (electrs), or the backend on 8999 + electrs on 3000. The `local-esplora` config proxies via `proxy.conf.local-esplora.js`:

| Route | Target | What |
|---|---|---|
| `/api/v1/**` | `http://127.0.0.1:8999` | ordpool backend (WebSocket + REST) |
| `/api/**` | `http://127.0.0.1:3000` | electrs (Esplora API), `/api` stripped |
| `/content/**`, `/preview/**` | `http://127.0.0.1:8999` | ordpool backend (inscription content/previews) |
| `/r/**` | `https://ordinals.com` | recursive inscription endpoints |

```bash
npm run build           # generate-config -> ng build --configuration production --localize -> sync-assets-dev -> sync-assets -> build-mempool.js
npm test                # Jest unit tests
npm run cypress:open    # Cypress E2E (interactive, needs dev server on :4200)
npm run cypress:run     # Cypress E2E (headless)
```
`sync-assets` (`sync-assets.js`) downloads mining-pool logos and remote assets and fails if the remote is unreachable; Angular compilation happens before this step. Lint scripts (`npm run lint` / `lint:fix` / `prettier`) exist but must NOT be run: see repo-root `CLAUDE.md` "Linting is FORBIDDEN".

## HARD RULE: AOT-compile templates before pushing
- Jest runs in JIT and accepts template binding expressions the AOT production build rejects (commonly a backslash-escaped apostrophe inside a binding string, NG5002 "Unterminated quote"). Jest passing is not enough.
- Before pushing changes to Angular template expressions (`[attr]="..."`, `{{ }}`, structural directives), run the full AOT build: `node ./node_modules/.bin/ng build --configuration production --no-progress`. Warnings are fine; errors fail CI.
- Fix by avoiding the apostrophe, or build the string in TypeScript and bind a property:
```html
<span [title]="'It\'s broken' + suffix"></span>   <!-- AOT rejects: NG5002 -->
<span [title]="hoverText"></span>                  <!-- bind a property instead -->
```
<!-- long-rule: JIT-vs-AOT example -->

## Visual identity (differentiators from upstream)
Brand rules that look like style choices. Don't drift toward mempool.space styling.
- **Accent colour:** Bitcoin orange `$bitcoin: #FF9900` only, aliased `--primary`/`--info`/`--orange`/`--tertiary`; use `var(--primary)`. Never invent tints. For UI states `var(--success)` and `var(--info)` are real; **`--warning` and `--danger` are NOT defined anywhere** (measured in the browser: `border-color: var(--warning)` computes to `currentColor`, `background: var(--warning)` to transparent, so the state is silently invisible). Use Bootstrap's `.text-warning` / `.text-danger` until the tokens exist on `:root`.
- **No rounded corners.** Bootstrap `--bs-border-radius` family is overridden to `0` in `src/styles-ordpool-overrides2.scss`; don't hardcode `border-radius: <N>px` in new SCSS. `border-radius: 50%` for circular avatars/dots is fine.
- **Panel backgrounds via tokens on `:root`** in `src/styles-ordpool-overrides2.scss`: `var(--panel-bg)` (card), `var(--panel-bg-deep)` (sunken/dropzone/nested), `var(--panel-border)`, `var(--panel-hover)`. Page background is `#1d1f31` (`$bg`, aliased `var(--bg)`). Tokens are neutral gray (a blue cast is upstream DNA); never invent new panel hexes, add a 5th token if needed.
- **Typography:** default `<p>` matches `cat21-mint`. Avoid Bootstrap `.lead` for OTS-style explanatory text (too large); use `.smaller-text` (14px) only for asides/metadata, not body copy.
- **Icons:** FontAwesome solid (`['fas', '<name>']`), single colour (white on dark). No emoji icons.
- **Cube iconography (perspective + lighting are non-negotiable):**
  - Preferred geometry: isometric corner-on (one vertex to the viewer, three rhombus faces, hexagon silhouette). Used by the brand logo `/resources/ordpool-cube-logo.svg` and the bitmap-3d viewer scene cubes; new decorative cubes (favicons, OG images, hero art) use it too.
  - The block-timeline cube (`.bitcoin-block` in blockchain-blocks / mempool-blocks / stale-list) is the same iso cube, drawn by the `app-iso-cube` overlay (`components/_ordpool/iso-cube`). Upstream's markup stays in the DOM for tooltips, `data-cy` hooks and click targets; the global `:has(app-iso-cube)` rules in `styles-ordpool-overrides2.scss` retire its flat front, both Necker pseudo-elements and `.block-body`. A new cube-bearing component gets all of that by placing `<app-iso-cube>` with its three `ngProjectAs` slots inside the block.
  - Slots: TOP an upright label (median fee rate); LEFT and RIGHT mapped onto their faces with the iso affine `matrix(0.866, ±0.5, 0, 1)`, so verticals stay vertical and baselines run with the slanted edges. Type is set in em off `--block-size`. One number drives the strip: `timelineBlockSize` in `iso-cube.constants.ts` (stride, container offset, divider, wrapper height, height label). Blocks still loading get the same hexagon as a CSS-only placeholder, so the strip never shows a differently shaped block. The header, global-footer and family-footer logo is the same component in `class="inline"` mode.
  - Colour: the logo and the bitmap-3d scene cubes carry the fixed cascade. Timeline cubes are coloured by INFORMATION instead — the host passes `[feeRate]` and the cube takes the theme's fee-level palette, lifted in OKLab (lightness +0.15, chroma ×1.2) for the sun-lit top, sides at 75.25 % / 49.25 % towards black (the two factors that reproduce the cascade exactly for brand orange). The top label's ink switches at face luminance 0.2105, where the dark ink and white contrast equally against the face. Without a fee rate the cube falls back to brand orange.
  - Perspective: up-RIGHT Necker vanishing (viewer at lower-left). Upstream uses up-LEFT; reversed via CSS in `styles-ordpool-overrides2.scss`. The hidden `.time-ltr` toggle is killed there (`time-toggle` button `display: none`, leftover `.time-ltr` made a no-op).
  - Lighting: sun-from-upper-LEFT. TOP brightest (`#FF9900`), LEFT mid (`#C07300`), RIGHT deepest shadow (`#7E4B00`); brand orange always on the sun-lit face. The timeline-cube depth pseudo-elements (`::after` top, `::before` side) are overridden globally in `styles-ordpool-overrides2.scss`; don't add per-component cube-depth CSS, use the `.bitcoin-block` class hook.
- Reference page for the canonical look (typography + spacing + colour): `cat21-mint`.
<!-- long-rule: brand colour/geometry/lighting spec -->

## Code marking convention (merge-friendly)
Fork of mempool.space; three-tier marking keeps merges clean.
- Inline markers in existing mempool files: `// HACK --- Ordpool Flags`, `// HACK -- Ordpool stats`, `// HACK -- ordpoolColorFunction`, `<!-- HACK: START Ordpool Stats --> ... <!-- HACK: END Ordpool Stats -->`.
- File naming: `.ordpool.*` suffix for alternatives (`src/index.ordpool.html`, `src/app/master-page.module.ordpool.ts`); `ordpool-` prefix for dedicated files (`ordpool-api.service.ts`).
- Directories: `src/app/components/_ordpool/` (all ordpool UI: artifact viewers, CAT-21 mint, wallet connect, stats); CSS overrides `src/styles-ordpool-overrides1.scss`, `src/styles-ordpool-overrides2.scss`.
- NEVER delete upstream code; comment it out with `/* HACK -- Ordpool: ... */`.

## Dependency: ordpool-parser
- Imported by git SHA in `package.json`: `"ordpool-parser": "github:ordpool-space/ordpool-parser#<sha>"`. Its `prepare` script builds on install.
- Bumping the SHA: edit `package.json`, run `npm install` to regenerate `package-lock.json`, commit BOTH. CI caches `node_modules` by lockfile hash; a SHA-only change restores stale `node_modules` and the build fails with missing types.
- Local live-dev: `cd ordpool-parser && npm run build && cd dist && npm link`, then `npm link ordpool-parser` in `frontend/`.

## Config modes
| Command | Sets |
|---|---|
| `npm run config:defaults:ordpool` | `BASE_MODULE=ordpool`, `MEMPOOL_WEBSITE_URL=https://ordpool.space` |
| `npm run config:defaults:mempool` | full mempool config (testnet, signet, liquid enabled) |
| `npm run config:defaults:liquid` | Liquid-focused config |

## Formatting Bitcoin data in templates
Two truncation primitives (`shortenString` pipe vs `<app-truncate>` component) and a small set of canonical components (`<app-amount>`, `<app-fee-rate>`, `<app-timestamp>`, `<app-time>`, `<app-confirmations>`). Don't reinvent.

| Data type | Recommended template |
|---|---|
| Txid in a table cell (linked) | `<a [routerLink]="['/tx/' \| relativeUrl, txid]" title="{{ txid }}">{{ txid \| shortenString : 13 }}</a>` |
| Txid as header / hero (CSS-truncated, last 4-12 guaranteed) | `<app-truncate [text]="txid" [lastChars]="12" [link]="['/tx/' \| relativeUrl, txid]"></app-truncate>` |
| Block hash in a table cell | `<a [routerLink]="['/block/' \| relativeUrl, block.id]" title="{{ block.id }}">{{ block.id \| shortenString : 13 }}</a> <app-clipboard [text]="block.id"></app-clipboard>` |
| Block height (table cell) | `<a [routerLink]="['/block/' \| relativeUrl, height]">{{ height \| number }}</a>` |
| Block height (next to a hash, e.g. `blocks-list`) | `<a [routerLink]="['/block/' \| relativeUrl, block.id]">{{ block.height }}</a>` (raw, no `\| number`; height is small) |
| Address in a table cell | `<app-truncate [text]="addr" [lastChars]="8" [link]="['/address/' \| relativeUrl, addr]"></app-truncate>` |
| Generic hex / merkle root (truncated) | `<code class="smaller-text">{{ hash \| shortenString : 13 }}</code>` |
| Fee in sats (plain number) | `{{ (fee \| number) ?? '-' }} <span class="symbol" i18n="shared.sats">sats</span>` |
| Fee rate in sat/vB | `<app-fee-rate [fee]="feeSats" [weight]="weight"></app-fee-rate>` (or `[fee]="ratePerVb"` if already sat/vB) |
| BTC / sat amount with view-mode toggle + fiat | `<app-amount [satoshis]="sats" digitsInfo="1.2-3" [noFiat]="true"></app-amount>` |
| Fiat conversion of a sat value | `<app-fiat [value]="sats" digitsInfo="1.0-0"></app-fiat>` |
| Absolute timestamp from Unix seconds | `<app-timestamp [customFormat]="'yyyy-MM-dd HH:mm:ss'" [unixTime]="ts" [hideTimeSince]="true"></app-timestamp>` |
| "X minutes ago" in a tight row | `<app-time kind="since" [time]="seconds" [fastRender]="true" [showTooltip]="true"></app-time>` |
| Confirmations counter | `<app-confirmations [chainTip]="latestBlock?.height" [height]="tx?.status?.block_height"></app-confirmations>` (auto bg-success/warning/danger badge) |
| Right-align a numeric column | `class="text-end"` on `<th>` and `<td>` |

Concrete examples (real files):
- Txid in a list: `src/app/components/_ordpool/block-ots-summary/block-ots-summary.component.html:18-20`
- Block hash on the block detail page: `src/app/components/block/block.component.html:65`
- Block height from OTS calendars: `src/app/components/_ordpool/ots-calendars/ots-calendars.component.html:102`
- Address as truncated chip: `src/app/components/address/address.component.html:5-6`
- Merkle root: `src/app/components/_ordpool/block-ots-summary/block-ots-summary.component.html:22`
- Fee in sats: `src/app/components/transaction/transaction-details/transaction-details.component.html:223`
- Fee rate: `src/app/components/transaction/cpfp-info.component.html:22`
- Block reward via app-amount: `src/app/components/blocks-list/blocks-list.component.html:65`
- Mined-since on dashboard: `src/app/dashboard/dashboard.component.html:117`
- Confirmations: `src/app/components/transactions-list/transactions-list.component.html:539`

Truncation cheat sheet (`shortenString` keeps `length/2` chars each end with `...` between; `src/app/shared/pipes/shorten-string-pipe/shorten-string.pipe.ts`):
- `shortenString : 13` for txids, block hashes, asset IDs, merkle roots in tables (dominant): `block.component.html:65`, `block-preview.component.html:23`, `asset.component.html:34`, `assets.component.html:14`, `ots-calendars.component.html:157,160`, `block-ots-summary.component.html:19,22`.
- `shortenString : 16` only in tooltip overlays (`rbf-timeline-tooltip.component.html:13`, `block-overview-tooltip.component.html:14`).
- `<app-truncate [lastChars]="12">` for txid hero rows (`transaction.component.html:14`, `transaction-raw.component.html:30`).
- `<app-truncate [lastChars]="8">` for addresses and asset chips (`address.component.html:5`, `address-text.component.html:15`, `asset.component.html:5`, `address-group.component.html:15`).
- `<app-truncate [lastChars]="5">` or `="6"` only in ultra-tight widgets (recent-tx, lightning channels); not in regular tables (readers can't disambiguate cats / tx hashes / runes from 5 chars).

Prefer `<app-truncate>` when the container width is known (headers, cards): CSS ellipsis, always preserves the last N chars exactly (copy-paste reliable). Use `shortenString : 13` for table cells where you want fixed output independent of column width.

Anti-patterns (do NOT replicate):
1. Raw fee numbers without `\| number` (renders `123456789` not `123,456,789`): `ots-calendars.component.html:161`, `block-ots-summary.component.html:23`.
2. Raw fee rate without `<app-fee-rate>` (no unit, no rounding, no sat/vB, misses the user's rate-unit setting sat/vB vs sat/WU): `ots-calendars.component.html:162`.
3. `text-right` instead of `text-end` (Bootstrap 5 logical classes; codebase has 93 `text-end` vs 10 `text-right` from the Bootstrap 4 era): `ots-calendars.component.html:88-91`.
4. `shortenString` without an explicit length (default 12, one short of the standard 13). Always pass `: 13` for txids/hashes in tables.
5. Inventing fee-rate units inline (`{{ rate | number:'1.0-0' }} sat/vB` bypasses the unit toggle and i18n key `shared.sat-vbyte`). Lone exception: the accelerator UI (`accelerate-checkout.component.html`), unit fixed by design.
6. `block.height` with `\| number` in `blocks-list`-style tables but not elsewhere: pipe through `\| number` in OTS-style tables (matches `ots-calendars`); bare `{{ block.height }}` is fine in tight 6-digit-height columns (`blocks-list`); document the deviation if you copy it.
