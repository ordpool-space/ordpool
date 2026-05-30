# Mempool Frontend

You can build and run the Mempool frontend and proxy to the production Mempool backend (for easier frontend development), or you can connect it to your own backend for a full Mempool development instance, custom deployment, etc.

Jump to a section in this doc:
- [Quick Setup for Frontend Development](#quick-setup-for-frontend-development)
- [Manual Frontend Setup](#manual-setup)
- [Ordpool E2E (Playwright)](#ordpool-e2e-playwright)
- [Translations](#translations-transifex-project)

## Quick Setup for Frontend Development

If you want to quickly improve the UI, fix typos, or make other updates that don't require any backend changes, you don't need to set up an entire backend—you can simply run the Mempool frontend locally and proxy to the mempool.space backend.

### 1. Clone Mempool Repository

Get the latest Mempool code:

```
git clone https://github.com/mempool/mempool
cd mempool/frontend
```

### 2. Specify Website

The same frontend codebase is used for https://mempool.space and https://liquid.network.

Configure the frontend for the site you want by running the corresponding command:

```
$ npm run config:defaults:mempool
$ npm run config:defaults:liquid
```

🟧 NEW for ordpool 🟧

```shell
npm run config:defaults:ordpool
```



### 3. Run the Frontend

_Make sure to use Node.js 20.x and npm 9.x or newer._

Install project dependencies and run the frontend server:

```
$ npm install
$ npm run serve:local-prod
```

The frontend will be available at http://localhost:4200/ and all API requests will be proxied to the production server at https://mempool.space.

### 4. Test

After making your changes, you can run our end-to-end automation suite and check for possible regressions.

Headless:

```
$ npm run config:defaults:mempool && npm run cypress:run
```

Interactive:

```
$ npm run config:defaults:mempool && npm run cypress:open
```

This will open the Cypress test runner, where you can select any of the test files to run.

If all tests are green, submit your PR, and it will be reviewed by someone on the team as soon as possible.

## Manual Setup

Set up the [Mempool backend](../backend/) first, if you haven't already.

### 1. Build the Frontend

_Make sure to use Node.js 20.x and npm 9.x or newer._

Build the frontend:

```
cd frontend
npm install
npm run build
```

### 2. Run the Frontend

#### Development

To run your local Mempool frontend with your local Mempool backend:

```
npm run serve
```

#### Production

The `npm run build` command from step 1 above should have generated a `dist` directory. Put the contents of `dist/` onto your web server.

You will probably want to set up a reverse proxy, TLS, etc. There are sample nginx configuration files in the top level of the repository for reference, but note that support for such tasks is outside the scope of this project.

<!-- HACK: START Ordpool E2E -->
## Ordpool E2E (Playwright)

Ordpool ships browser end-to-end tests under `playwright/`. They cover the bitmap 3D viewer's renderer wiring (intro / orbit / PFP cinematic state machine) and the PFP physics (grounded, jump arc, sprint FOV, walking, exit). The upstream `npm run e2e` / Cypress harness is left alone; this is a separate, parallel suite.

### Why both layers exist

| File | Engine | Covers |
|---|---|---|
| `src/app/components/_ordpool/digital-artifact-viewer/bitmap-viewer/bitmap-3d-physics.spec.ts` | Jest | 40 pure-helper tests — state derivation, gravity branch, variable-jump cap, diagonal-magnitude clamp, pitch clamp, FOV target, ease alpha. No three.js, no DOM. |
| `playwright/specs/bitmap-3d.spec.ts` | Playwright + real Chromium | 7 browser tests proving the renderer mounts, the state machine transitions, and the physics integrates correctly against a real Octree + Capsule. |

The Jest tests pin the math. The Playwright tests pin the wiring through three.js. Either layer alone is incomplete — the math may be right but mis-wired, or the wiring may be intact but the math wrong.

### Setup (first run only)

```bash
cd frontend
npm install
npm run ordpool-e2e:install     # downloads the vendored Chromium (~150MB)
```

### Run the suite

```bash
# Foreground: auto-starts an ng-serve on port 4242 (against-prod proxy),
# runs the suite, tears the server down. ~11 minutes wall-clock on a
# laptop (most of it is per-test Angular boot + three.js dynamic import).
npm run ordpool-e2e

# Visible browser — useful when iterating on a spec.
npm run ordpool-e2e:headed

# Playwright Inspector — pause / step / inspect locators.
npm run ordpool-e2e:debug
```

If you have a long-running dev server already on `:4242`, Playwright will reuse it (in dev — `reuseExistingServer: !process.env.CI`). To start that server by hand:

```bash
npm run start:ordpool-e2e
```

Why port **4242** (not the usual 4200): keeps Playwright's ephemeral dev server from colliding with whatever else is already on 4200 on your laptop — different ports, the two stacks coexist.

### How a scene is provided to a test

The bitmap-3D viewer's input is a `sizes: number[]` array (Mondrian rectangles). Production reads it via `BitmapApiService.getBitmapData(height)` → `GET /api/v1/ordpool/bitmap/<height>`. E2E bypasses that chain:

1. A canonical fixture (block 800,000 — healthy variety of cube sizes 1-6, immutable on-chain) lives at `playwright/fixtures/bitmap-800000.json`. To regenerate or add a new block:
   ```bash
   curl -sf https://api.ordpool.space/api/v1/ordpool/bitmap/<height> \
     > playwright/fixtures/bitmap-<height>.json
   ```
2. Each spec injects the fixture via `page.addInitScript(...)` so `window.__bitmap3dFixture = { sizes: [...] }` is set before any page script runs.
3. The spec navigates to `/e2e/bitmap-3d` — a test-only Angular route that mounts a thin wrapper component (`Bitmap3dE2EComponent`) which reads from `window.__bitmap3dFixture` and renders `<app-bitmap-3d-renderer [sizes]>`.

The route is gated on `environment.testHooks` (true in dev, false in prod) so the component, its module, and the route entry all tree-shake out of the production bundle. Same gate disables the `window.__bitmap3d` debug hook on the renderer itself.

### Driving physics deterministically (`tick`)

Headless Chromium throttles `requestAnimationFrame` to ~0.2-0.5 Hz when there's no compositor. Wall-clock-bound waits for physics state (`onFloor`, `playerState`) flake constantly. The `--disable-background-timer-throttling` family of flags doesn't fully fix it.

Solution: the renderer exposes a `tick(frames, dt)` function on `window.__bitmap3d` when `environment.testHooks` is true. It runs the PFP frame body (input + 10-substep physics + ground-ray + eye-safety + step-up + FOV ease + state derivation) synchronously, regardless of whether rAF fires. The test drives `tick` instead of waiting on rAF.

```ts
// 60 ticks at 1/60 dt = 1 simulated second.
await page.evaluate(() => (window as any).__bitmap3d.tick(60));

// Drive keyboard state without dispatching DOM events (no focus / timing
// concerns).
await page.evaluate(() => (window as any).__bitmap3d.setKey('KeyW', true));

// Fire a one-shot jump (same path as the on-screen jump button).
await page.evaluate(() => (window as any).__bitmap3d.jump());
```

Cinematic transitions (intro → orbit, orbit → fly-to-pfp → pfp, pfp → fly-to-iso → exit-done) are still rAF-driven — but they complete within the default 30s `waitForFunction` timeout even on the heavily throttled rAF schedule.

### CI

`.github/workflows/ordpool-e2e-nightly.yml` runs the suite:

- nightly at **03:17 UTC** (off-the-hour, dodges the 03:00 cron herd on shared GHA runners), and
- on-demand via the Actions tab → "Ordpool E2E (Playwright)" → "Run workflow".

Runs on `ubuntu-latest` (the `mempool-ci` self-hosted runner that the upstream Cypress workflows use isn't accessible to ordpool). The vendored Chromium is cached by Playwright version. On failure, `playwright-report/` and `test-results/` (videos + traces) upload as artifacts with 14-day retention — drop into Playwright's `show-report` viewer locally to inspect.

### Adding a new spec

1. Drop a `*.spec.ts` under `playwright/specs/`.
2. Need a different bitmap? Capture it via the `curl` snippet above; commit the JSON to `playwright/fixtures/`.
3. Asserting on physics? Use `tick()` rather than `page.waitForTimeout` — see the bitmap-3D spec for the calibrated frame counts (jumping ~30 frames after pulse, falling ~30-80, idle ~110+).
4. Asserting on cinematic state? Use `waitForFunction` for `state === 'X'` — rAF is throttled but reaches each tween's destination within 30s.
5. Run locally with `npm run ordpool-e2e:headed` first to watch the spec actually work; commit when green.
<!-- HACK: END Ordpool E2E -->

## Translations: Transifex Project

The Mempool frontend strings are localized into 20+ locales:
https://www.transifex.com/mempool/mempool/dashboard/

### Translators

* Arabic @baro0k
* Czech @pixelmade2
* Danish @pierrevendelboe
* German @Emzy
* English (default)
* Spanish @maxhodler @bisqes
* Persian @techmix
* French @Bayernatoor
* Korean @kcalvinalvinn @sogoagain
* Italian @HodlBits
* Lithuanian @eimze21
* Hebrew @rapidlab309
* Georgian @wyd_idk
* Hungarian @btcdragonlord
* Dutch @m__btc
* Japanese @wiz @japananon
* Norwegian @T82771355
* Polish @maciejsoltysiak
* Portugese @jgcastro1985
* Slovenian @thepkbadger
* Finnish @bio_bitcoin
* Swedish @softsimon_
* Thai @Gusb3ll
* Turkish @stackmore
* Ukrainian @volbil
* Vietnamese @BitcoinvnNews
* Chinese @wdljt
* Russian @TonyCrusoe @Bitconan
* Romanian @mirceavesa
* Macedonian @SkechBoy
* Nepalese @kebinm
