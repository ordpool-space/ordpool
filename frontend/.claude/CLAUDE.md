# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Frontend: ordpool (Angular 20)

Fork of mempool.space frontend with Ordinals customizations. After the upstream-merge in April 2026 the stack is Angular 20 + Bootstrap 5 + Node 24 (was Angular 17 / Bootstrap 4 / Node 20 in v1).

### HARD RULE: Keep useful comments

**Don't strip JSDoc or "why" inline comments under the banner of
"simplification".** The text inside a comment can be trimmed (no
bombast, no LLM-speak, no before-after history); the block itself
stays. Viewer-component design rationale (alkanes-vs-runes split,
ots-viewer tristate semantics, block-protocol-section structure) and
service caching/dedupe notes are exactly the kind of comment a future
reader cannot reconstruct from code alone. Full decision tree in the
workspace `CLAUDE.md` HARD RULE "Keep useful comments (JSDoc AND
inline 'why')".

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

### Pre-push check: AOT-compile Angular templates

Jest tests run in **JIT** mode and accept template binding expressions
that the **AOT** production build rejects. The most common gotcha:
backslash-escaped apostrophes inside binding strings.

```html
<!-- ✗ AOT rejects this with NG5002 "Unterminated quote" -->
<span [title]="'It\'s broken' + suffix"></span>

<!-- ✓ Either avoid the apostrophe... -->
<span [title]="'It is fine ' + suffix"></span>

<!-- ✓ ...or build the string in TypeScript and bind a property -->
<span [title]="hoverText"></span>
```

Before pushing changes that touch Angular template expressions
(`[attr]="..."`, `{{ }}` interpolations, structural directives),
run a full production AOT build:

```bash
cd frontend
node ./node_modules/.bin/ng build --configuration production --no-progress
```

Warnings are fine; **errors fail CI**. Jest passing isn't enough —
template expressions are only fully validated at AOT.

### Visual Identity (the differentiators from upstream)

Ordpool's design has a few rules that look like style choices but are
**brand differentiators**. Don't accidentally drift toward upstream
mempool.space styling.

1. **Bitcoin orange (`$bitcoin: #FF9900`) is the only accent colour.**
   Aliased as `--primary`, `--info`, `--orange`, `--tertiary` in the
   theme. Use `var(--primary)` for any accent. Don't invent decorative
   tints (purple, teal, yellow, etc.) — if you need to differentiate UI
   states, reach for the theme's semantic vars: `var(--success)` (green),
   `var(--warning)` (yellow), `var(--danger)` (red). They're already in
   the colour vocabulary the user knows.

   The brand cube logo and the 3D bitmap viewer scene cubes use an
   orange tonal cascade (`#FF9900` brand → `#C07300` mid → `#7E4B00`
   shadow) for dimensional shading on the three visible faces. Those
   are NOT additional accent colours — they're internal tonal
   variations of the same brand orange, only ever applied to cube
   faces. See rule 6 below for the full spec.

2. **No rounded corners.** Upstream mempool uses `border-radius` on
   cards, buttons, dropzones, badges. Ordpool deliberately ships
   square. We kill it globally by overriding the Bootstrap CSS vars
   (`--bs-border-radius` family) to `0` in
   `frontend/src/styles-ordpool-overrides2.scss`, so every
   Bootstrap component renders flat without per-component overrides.
   Avoid hardcoding `border-radius: <Npx>` in new ordpool SCSS.
   `border-radius: 50%` for circular avatars / dots is fine.

3. **Card / panel backgrounds — use the panel tokens, never raw hexes.**
   Four CSS custom properties live on `:root` in
   `frontend/src/styles-ordpool-overrides2.scss`:

   - `var(--panel-bg)` — card / panel background.
   - `var(--panel-bg-deep)` — sunken / dropzone inset, nested panel.
   - `var(--panel-border)` — panel border (and decorative arrow lines etc).
   - `var(--panel-hover)` — hover state on interactive panels.

   The page background stays `#1d1f31` (`$bg`) — that one is theme-level
   and aliased as `var(--bg)`. **Do not invent new panel hexes.** The
   tokens are deliberately *neutral gray*, not blue. A blue cast is
   upstream mempool DNA; ordpool reads gray-on-navy with bitcoin orange
   accents. If you need a tint we don't have, add a 5th token here
   rather than scattering a one-off hex in a component SCSS.

4. **Typography**: default `<p>` body size matches `cat21-mint`. Avoid
   the Bootstrap `.lead` class for OTS-style explanatory text — it
   reads too large in our layout. Use `.smaller-text` (14px) only for
   genuine asides / metadata, not body copy.

5. **Icons**: FontAwesome solid (`['fas', '<name>']`), single colour
   (white over the dark theme). Don't mix in emoji icons.

6. **Cube iconography — perspective + lighting are brand rules.**

   Every cube on ordpool shares two non-negotiable conventions
   (perspective + lighting), and one preferred geometric style
   (isometric corner-on, unless the cube needs a content-bearing
   front face).

   - **Preferred geometry: isometric corner-on.** One cube vertex
     points at the viewer, three rhombus faces meet there, outer
     silhouette is a regular hexagon. This is the canonical ordpool
     cube — the brand logo (`/resources/ordpool-cube-logo.svg`) and
     the bitmap-3d viewer scene cubes both use it. Any new cube
     element that's purely iconographic / decorative (favicons, OG
     images, hero illustrations) MUST also use this variant unless
     there's a specific reason not to.

     The one allowed exception is the block-timeline cube
     (`.bitcoin-block` in blockchain-blocks / mempool-blocks /
     stale-list). It's a 3-face Necker variant with a flat FRONT
     face plus top + side because the front carries content (fee
     rate, MB, cat21 avatar, tx count) that an iso corner-on view
     has no flat surface for. The same perspective + lighting rules
     below still apply.

   - **Perspective: up-RIGHT Necker vanishing.** Cube depth recedes
     toward the upper-right (viewer at lower-left). The Necker
     default. Mempool upstream uses up-LEFT for the block timeline;
     we reverse it via pure CSS overrides in
     `styles-ordpool-overrides2.scss` (no upstream files touched).
     Mempool's hidden `.time-ltr` toggle (an opt-in opposite-direction
     mode for RTL locales) is killed there too — the `time-toggle`
     button is `display: none` and any leftover `.time-ltr` class is
     transformed to a no-op, so the orientation stays consistent
     even for users who toggled it on in a past session.

   - **Lighting: sun-from-upper-LEFT.** TOP face is brightest (full
     bitcoin orange `#FF9900`), LEFT face is mid (`#C07300`, lifted
     from the bitmap-3d viewer palette), RIGHT face is the deepest
     shadow (`#7E4B00`, also from the viewer palette). Brand orange
     ALWAYS sits on the sun-lit face — it's the identity anchor;
     the shaded faces are derived tones.

   The brand logo SVG is used everywhere a logo appears: master-page
   header (desktop + mobile), global-footer, and the OTS web-
   notification icon (where it brand-identifies the source in the
   OS notification centre).

   The timeline-cube depth pseudo-elements (`::after` for the top
   face, `::before` for the side face) are overridden globally in
   `styles-ordpool-overrides2.scss` — don't add per-component CSS
   for cube depth. If a new cube-bearing component lands, it
   inherits the rule for free as long as it uses the `.bitcoin-block`
   class hook.

When you're unsure, check `cat21-mint`'s component for the canonical
ordpool look — it's the reference page for typography + spacing +
colour usage.

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

### Formatting Conventions for Bitcoin Data in Tables / Inline

When you render txids, addresses, hashes, fees, etc. in templates, follow
the patterns the rest of the codebase already uses. There are essentially
two truncation primitives (`shortenString` pipe vs `<app-truncate>` component)
and a small set of canonical components (`<app-amount>`, `<app-fee-rate>`,
`<app-timestamp>`, `<app-time>`, `<app-confirmations>`). Don't reinvent.

| Data type | Recommended template |
|---|---|
| Txid in a table cell (linked) | `<a [routerLink]="['/tx/' \| relativeUrl, txid]" title="{{ txid }}">{{ txid \| shortenString : 13 }}</a>` |
| Txid as a header / hero element (CSS-truncated, last 4–12 chars guaranteed) | `<app-truncate [text]="txid" [lastChars]="12" [link]="['/tx/' \| relativeUrl, txid]"></app-truncate>` |
| Block hash in a table cell | `<a [routerLink]="['/block/' \| relativeUrl, block.id]" title="{{ block.id }}">{{ block.id \| shortenString : 13 }}</a> <app-clipboard [text]="block.id"></app-clipboard>` |
| Block height (table cell) | `<a [routerLink]="['/block/' \| relativeUrl, height]">{{ height \| number }}</a>` |
| Block height (next to a block hash, e.g. `blocks-list`) | `<a [routerLink]="['/block/' \| relativeUrl, block.id]">{{ block.height }}</a>` (raw, no `\| number`, height is small) |
| Address in a table cell | `<app-truncate [text]="addr" [lastChars]="8" [link]="['/address/' \| relativeUrl, addr]"></app-truncate>` |
| Generic hex string / merkle root (truncated) | `<code class="smaller-text">{{ hash \| shortenString : 13 }}</code>` |
| Fee in sats (plain number) | `{{ (fee \| number) ?? '-' }} <span class="symbol" i18n="shared.sats">sats</span>` |
| Fee rate in sat/vB | `<app-fee-rate [fee]="feeSats" [weight]="weight"></app-fee-rate>` (or `[fee]="ratePerVb"` if you already have sat/vB) |
| BTC / sat amount with view-mode toggle + fiat | `<app-amount [satoshis]="sats" digitsInfo="1.2-3" [noFiat]="true"></app-amount>` |
| Fiat conversion of a sat value | `<app-fiat [value]="sats" digitsInfo="1.0-0"></app-fiat>` |
| Absolute timestamp from Unix seconds | `<app-timestamp [customFormat]="'yyyy-MM-dd HH:mm:ss'" [unixTime]="ts" [hideTimeSince]="true"></app-timestamp>` |
| "X minutes ago" inside a tight row (mined-when, first-seen) | `<app-time kind="since" [time]="seconds" [fastRender]="true" [showTooltip]="true"></app-time>` |
| Confirmations counter | `<app-confirmations [chainTip]="latestBlock?.height" [height]="tx?.status?.block_height"></app-confirmations>` (renders bg-success/bg-warning/bg-danger badge automatically) |
| Right-align a numeric column | `class="text-end"` on `<th>` and `<td>` |

#### Concrete examples (from real files)

- Txid in a list — `src/app/components/_ordpool/block-ots-summary/block-ots-summary.component.html:18-20`:
  `<a [routerLink]="['/tx/' | relativeUrl, row.txid]" title="{{ row.txid }}">{{ row.txid | shortenString : 13 }}</a>`
- Block hash in the block detail page — `src/app/components/block/block.component.html:65`:
  `<td>&lrm;<a [routerLink]="['/block/' | relativeUrl, block.id]" title="{{ block.id }}">{{ block.id | shortenString : 13 }}</a> <app-clipboard [text]="block.id"></app-clipboard></td>`
- Block height linked from OTS calendars — `src/app/components/_ordpool/ots-calendars/ots-calendars.component.html:102`:
  `<a [routerLink]="['/block/' | relativeUrl, cal.lastBlockheight]">{{ cal.lastBlockheight | number }}</a>`
- Address as truncated chip — `src/app/components/address/address.component.html:5-6`:
  `<app-truncate [text]="addressString" [lastChars]="8" [link]="['/address/' | relativeUrl, addressString]">…</app-truncate>`
- Merkle root — `src/app/components/_ordpool/block-ots-summary/block-ots-summary.component.html:22`:
  `<td><code class="smaller-text">{{ row.merkleRoot | shortenString : 13 }}</code></td>`
- Fee in sats — `src/app/components/transaction/transaction-details/transaction-details.component.html:223`:
  `<td>{{ (tx.fee | number) ?? '-' }} <span class="symbol" i18n="shared.sats">sats</span> …</td>`
- Fee rate — `src/app/components/transaction/cpfp-info.component.html:22`:
  `<td><app-fee-rate [fee]="cpfpTx.fee" [weight]="cpfpTx.weight"></app-fee-rate></td>`
- Block reward via app-amount — `src/app/components/blocks-list/blocks-list.component.html:65`:
  `<app-amount [satoshis]="block.extras.reward" [noFiat]="true" digitsInfo="1.2-2"></app-amount>`
- Mined-since on dashboard — `src/app/dashboard/dashboard.component.html:117`:
  `<app-time kind="since" [time]="block.timestamp" [fastRender]="true" [showTooltip]="true"></app-time>`
- Confirmations — `src/app/components/transactions-list/transactions-list.component.html:539`:
  `<app-confirmations [chainTip]="latestBlock?.height" [height]="tx?.status?.block_height" …></app-confirmations>`

#### Truncation length cheat sheet

`shortenString` keeps `length/2` chars at start + `length/2` at end with
`...` between (see `src/app/shared/pipes/shorten-string-pipe/shorten-string.pipe.ts`).
The codebase converges on:

- **`shortenString : 13`** — for txids, block hashes, asset IDs, merkle
  roots in tables (dominant). Examples: `block.component.html:65`,
  `block-preview.component.html:23`, `asset.component.html:34`,
  `assets.component.html:14`, `ots-calendars.component.html:157,160`,
  `block-ots-summary.component.html:19,22`.
- **`shortenString : 16`** — only in tooltip-style overlays
  (`rbf-timeline-tooltip.component.html:13`, `block-overview-tooltip.component.html:14`).
- **`<app-truncate [lastChars]="12">`** — for txid hero rows on the
  transaction page (`transaction.component.html:14`,
  `transaction-raw.component.html:30`).
- **`<app-truncate [lastChars]="8">`** — for addresses and asset chips
  (`address.component.html:5`, `address-text.component.html:15`,
  `asset.component.html:5`, `address-group.component.html:15`).
- **`<app-truncate [lastChars]="5">` or `[lastChars]="6"`** — only in
  ultra-tight widgets (recent-tx, lightning channels). Don't use these
  in regular tables; readers can't disambiguate cats / tx hashes / runes
  from 5 chars.

Prefer `<app-truncate>` over `shortenString` whenever the surrounding
container has a known width (header rows, cards). It uses CSS-based
ellipsis and always preserves the last N chars exactly, which makes
copy-paste reliable. Use `shortenString : 13` for table cells where
you want predictable, fixed character output independent of column width.

#### Anti-patterns (seen in the wild — do NOT replicate)

1. **Raw fee numbers without locale grouping.** `<td>{{ row.fee }}</td>`
   in `ots-calendars.component.html:161` and `block-ots-summary.component.html:23`
   render `123456789` instead of `123,456,789`. Always pipe through `| number`.
2. **Raw fee rate without `<app-fee-rate>`.** `ots-calendars.component.html:162`
   shows `{{ row.feerate }}` with no unit, no rounding, no `sat/vB` symbol.
   Use `<app-fee-rate [fee]="…">` instead — it picks up the user's rate-unit
   setting (sat/vB vs. sat/WU) and renders the i18n-translated unit.
3. **`text-right` instead of `text-end`.** Bootstrap 5 uses logical
   directional classes; the codebase has 93 `text-end` vs. 10 `text-right`
   left over from the Bootstrap 4 era (e.g. `ots-calendars.component.html:88-91`).
   Use `text-end` for new code.
4. **`shortenString` without an explicit length argument.** Default is 12,
   which is one char shorter than the de-facto standard 13 used everywhere.
   Always pass `: 13` for txids/hashes in tables.
5. **Inventing fee-rate units inline.** Don't write
   `{{ rate | number:'1.0-0' }} sat/vB` — that bypasses the unit toggle
   and the i18n key `shared.sat-vbyte`. The lone exception is the
   accelerator UI (`accelerate-checkout.component.html`) where the unit
   is fixed by design.
6. **`block.height` with `| number` inside `blocks-list`-style tables but
   without it elsewhere.** Be consistent: when block heights are wrapped
   in `<a>` tags in OTS-style tables, pipe through `| number` (matches
   `ots-calendars`); when in tight columns sized for 6-digit heights
   (the main `blocks-list`), bare `{{ block.height }}` is fine — but
   document the deviation if you copy that pattern.
