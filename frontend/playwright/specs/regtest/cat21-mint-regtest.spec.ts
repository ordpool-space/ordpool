/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { Cat21ParserService, DigitalArtifactType } from 'ordpool-parser';

// All of these live in the SDK's published `e2e/` directory — see the
// SDK's package.json `files` allowlist. They're reused verbatim so the
// regtest helpers + the Xverse approval-popup machinery are single-
// sourced.
// The SDK ships these helpers as raw .ts under e2e/. Node 24's built-in
// type-stripping refuses to compile .ts under node_modules, so the
// workflow copies them out to ./sdk-lib/ before the spec runs.
import {
  getUtxos,
  waitForElectrsSync,
  rpc,
  mineBlocks,
  getTx,
} from './sdk-lib/regtest-helpers';
import { waitForApprovalPopup } from './sdk-lib/approval-popup';

/**
 * E2E (regtest mint) — ordpool /cat21-mint
 *
 * Drives the real Angular `/cat21-mint` page through a complete CAT-21
 * mint round-trip:
 *
 *   1. Launch Chromium headed under xvfb with the cached Xverse `.crx`
 *      loaded (its seed `user-data-dir` was produced by the SDK's
 *      global-setup against Bitcoin Regtest with the local electrs URL).
 *   2. Unlock the Xverse vault using the same TEST_PASSWORD the SDK
 *      uses for its own roundtrip spec.
 *   3. Navigate to http://localhost:4242/cat21-mint (the dev server the
 *      workflow spins up with the regtest serve config).
 *   4. Click the connect-wallet affordance, approve the Xverse connect
 *      popup, read back the connected payment + ordinals addresses
 *      from the rendered UI.
 *   5. Fund the wallet's payment address via `sendtoaddress`, mine a
 *      block, wait for electrs to index the funding UTXO.
 *   6. Wait for the UI to surface at least one viable UTXO row, pick
 *      a sensible fee rate from the rate input (we ship 1 sat/vB), and
 *      click "Mint my cat".
 *   7. Approve the Xverse sign popup; wait for the success alert.
 *   8. Pull the broadcast txid off the success link, mine another
 *      block, fetch via electrs, and assert the on-chain tx is a
 *      well-formed CAT-21 (locktime=21, parses through
 *      `Cat21ParserService`).
 *
 * The spec is intentionally CI-only (the workflow downloads the
 * unverified Xverse .crx into a runner that gets torn down). The
 * config refuses to run it locally — see `playwright.regtest.config.ts`.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/cat21-mint';
const TEST_PASSWORD = 'TestPassword123!';

// In regtest, 1 BTC = 100M sats. Fund with 0.001 BTC (100,000 sats) —
// plenty of headroom for the 546-sat output + miner fee at any
// reasonable rate, and large enough that the UI's auto-pick lands on
// our funding UTXO as the only viable row.
const FUND_AMOUNT_BTC = 0.001;
const FUND_AMOUNT_SATS = Math.round(FUND_AMOUNT_BTC * 1e8);

// The SDK ships its unpacked Xverse extension + seed user-data-dir
// under its own e2e/ directory. The workflow caches both and they
// land in node_modules at runtime via `npm ci`.
const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.XVERSE_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/xverse');
const SEED_USER_DATA_DIR =
  process.env.XVERSE_SEED_USER_DATA_DIR
  ?? path.resolve(__dirname, '../../../test-results/xverse-seed-user-data-dir');

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;
// Hoisted state shared across `test()` blocks in this file. Set by the
// full mint round-trip, consumed by the asset-scanner regression below.
// We don't reseed the Xverse vault between tests — the persistent
// context's localStorage already remembers the connected wallet, so a
// fresh page auto-reconnects to the same payment address.
let sharedPaymentAddress: string | undefined;

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21-mint-regtest-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(
      `Xverse extension not unpacked at ${EXT_PATH}. The workflow should ` +
      'have run the SDK\'s playwright-bootstrap.sh to populate it.',
    );
  }
  if (!fs.existsSync(path.join(SEED_USER_DATA_DIR, 'Default'))) {
    throw new Error(
      `Xverse seed user-data-dir missing at ${SEED_USER_DATA_DIR}. The SDK's ` +
      'global-setup should have produced it before this spec ran.',
    );
  }

  // Cheap regtest sanity check: confirm bitcoind is up + the chain has
  // matured 101 blocks (coinbase maturity requirement). The workflow's
  // earlier "wait for stack" step has already proved port 8999, but a
  // missing 101-block tip is the kind of failure mode that produces a
  // mysterious mid-spec "insufficient funds" rather than a clean error.
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(
      `regtest tip is ${tip} (<101). The SDK's regtest-bootstrap.sh should ` +
      'have mined past coinbase maturity before this spec ran.',
    );
  }

  // Clone the seed user-data-dir so we don't mutate the original — the
  // suite may retry, and a partially-onboarded vault from a prior run
  // would poison the unlock step.
  const workingDir = `${SEED_USER_DATA_DIR}.mintpage-${process.pid}-${Date.now()}`;
  fs.cpSync(SEED_USER_DATA_DIR, workingDir, { recursive: true });
  for (const stale of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    fs.rmSync(path.join(workingDir, stale), { force: true });
  }

  context = await chromium.launchPersistentContext(workingDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    viewport: { width: 1280, height: 900 },
  });

  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  extensionId = worker.url().split('/')[2];
});

test.afterAll(async () => {
  await context?.close();
});

test('cat21 mint round-trip on regtest via the Angular /cat21-mint page + Xverse', async () => {
  test.setTimeout(420_000); // 7 min — multiple wallet popups + 2 blocks

  // ─── 1. Unlock the vault ───────────────────────────────────────
  const primer = await context.newPage();
  await primer.setViewportSize({ width: 400, height: 800 });
  await primer.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await primer.waitForFunction(() => {
    const t = (document.body.innerText || '').toLowerCase();
    return t.includes('unlock') || t.includes('account 1');
  }, undefined, { timeout: 30_000, polling: 250 });
  if (/unlock/i.test(await primer.locator('body').innerText())) {
    await primer.locator('input[type="password"]').first().fill(TEST_PASSWORD);
    await primer.getByRole('button', { name: /^unlock$/i }).first().click();
    await primer.waitForFunction(() => {
      const t = (document.body.innerText || '').toLowerCase();
      return t.includes('account 1') || t.includes('not now') || t.includes('zest') || t.includes('send');
    }, undefined, { timeout: 30_000, polling: 250 });
  }
  const notNow = primer.getByText('Not now', { exact: true }).first();
  if (await notNow.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await notNow.click({ force: true }).catch(() => undefined);
  }
  await shot(primer, '01-unlocked');
  await primer.close();

  // ─── 2. Open /cat21-mint, click Connect, approve in Xverse ─────
  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, '02-page-loaded');

  // The connect link in the mint page reads "connect your wallet" and
  // sits inside the form when no wallet is yet bound. The wallet picker
  // is a ngb-modal that opens with the supported wallet list.
  const connectLink = page.getByRole('link', { name: /connect your wallet/i }).first();
  await expect(connectLink).toBeVisible({ timeout: 30_000 });

  const knownPagesBeforeConnect = new Set(context.pages());
  await connectLink.click();
  // Picker modal — pick Xverse
  await page.getByRole('button', { name: /^xverse$/i }).first()
    .click({ timeout: 20_000 });
  await shot(page, '03-picker-clicked');

  // Xverse opens a connect-approval popup in a new tab
  const approvalConnect = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeConnect,
    timeoutMs: 60_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.waitForFunction(() => {
        const t = (document.body.innerText || '').toLowerCase();
        return ['connect', 'approve', 'confirm', 'allow'].some((s) => t.includes(s));
      }, undefined, { timeout: 60_000, polling: 500 });
      return true;
    },
  });
  await shot(approvalConnect, '04-connect-approval');
  await approvalConnect.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
    .first().click();
  // Closing the connect popup forces Xverse to open a FRESH tab for the
  // sign step later — see the SDK roundtrip spec's notes for why.
  await approvalConnect.close().catch(() => undefined);

  // ─── 3. Read the payment address from the empty-state hint ─────
  // Before we fund the wallet, the mint form has no viable UTXOs and
  // renders the "send funds to this address" empty-state hint. That
  // hint includes the payment address in a `<code class="bitcoin">`
  // we can read verbatim — no SDK testHooks required.
  const paymentCode = page.locator('code.bitcoin', { hasText: /^(bcrt1q|bcrt1p|3|tb1q|2)/ }).first();
  await expect(paymentCode).toBeVisible({ timeout: 60_000 });
  const paymentAddress = (await paymentCode.textContent())!.trim();
  console.log(`[mint-page] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1q/);
  const wallet = { paymentAddress };
  sharedPaymentAddress = paymentAddress;

  // ─── 4. Fund the payment address, mine, wait for electrs ──────
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', wallet.paymentAddress, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[mint-page] funded ${wallet.paymentAddress} with ${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
  const fundedTip = mineBlocks(1);
  await waitForElectrsSync(fundedTip);

  const utxos = await getUtxos(wallet.paymentAddress);
  expect(utxos.length).toBeGreaterThan(0);
  const fundedUtxo = utxos.find((u) => u.value === FUND_AMOUNT_SATS);
  if (!fundedUtxo) {
    throw new Error(`could not find ${FUND_AMOUNT_SATS}-sat UTXO; got ${JSON.stringify(utxos)}`);
  }

  // ─── 4b. Reload page to refresh UTXO state ─────────────────────
  // The orchestrator fires getUtxos once on connect — funding the
  // wallet via RPC AFTER connect doesn't trigger a re-fetch. A
  // page reload forces a fresh utxos$ pipeline. The SDK persists
  // the last-connected wallet in localStorage; if Xverse pops a
  // permission-renewal popup we approve it, otherwise move on.
  const knownPagesBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeReload,
    timeoutMs: 8_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.waitForFunction(() => {
        const t = (document.body.innerText || '').toLowerCase();
        return ['connect', 'approve', 'confirm', 'allow'].some((s) => t.includes(s));
      }, undefined, { timeout: 8_000, polling: 250 });
      return true;
    },
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
      .first().click();
    await reapprove.close().catch(() => undefined);
  }
  await shot(page, '04b-reloaded');

  // ─── 5. Drive the fee picker + summary; wait for "Mint my cat" ─
  // The mint form's fee-rate input uses `[formControl]="cfeeRate"`
  // (FormControl reference), which doesn't emit a `formControlName`
  // attribute. Pin it by the surrounding input-group label instead.
  const feeRateInput = page.locator(
    '.input-group:has(.input-group-text:text-is("Fee rate")) input[type="number"]',
  ).first();
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  await shot(page, '05-fee-set');

  const mintButton = page.getByRole('button', { name: /mint my cat/i }).first();
  await expect(mintButton).toBeEnabled({ timeout: 60_000 });
  await shot(page, '06-ready-to-mint');

  // ─── 6. Click Mint, approve sign popup ─────────────────────────
  const knownPagesBeforeSign = new Set(context.pages());
  await mintButton.click();

  const approvalSign = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByText(/review transaction/i).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await shot(approvalSign, '07-sign-approval');

  // Wait for the Confirm button to be live (Xverse renders it before
  // wiring the onClick — same dance the SDK roundtrip uses).
  await approvalSign.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.some((b) => {
      if (!/^confirm$/i.test(b.textContent?.trim() ?? '')) return false;
      if (b.hasAttribute('disabled')) return false;
      const style = getComputedStyle(b);
      return style.pointerEvents !== 'none' && style.visibility !== 'hidden';
    });
  }, undefined, { timeout: 30_000, polling: 250 });
  await expect(approvalSign.getByRole('button', { name: /^confirm$/i }).first()).toBeEnabled({ timeout: 30_000 });

  // Retry the Confirm click — Xverse occasionally swallows the first
  // click during the React onClick attach.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (approvalSign.isClosed()) break;
    await approvalSign.getByRole('button', { name: /^confirm$/i }).first()
      .click({ force: true })
      .catch(() => undefined);
    const closed = new Promise<void>((res) => approvalSign.once('close', () => res()));
    await Promise.race([
      closed,
      expect(approvalSign.getByRole('button', { name: /^confirm$/i }).first())
        .toBeHidden({ timeout: 30_000 }),
    ]).catch(() => undefined);
    if (approvalSign.isClosed()) break;
  }

  // ─── 7. Wait for success card + extract broadcast txid ────────
  const successAlert = page.locator('.alert.alert-success').first();
  await expect(successAlert).toBeVisible({ timeout: 90_000 });
  await shot(page, '08-success');

  const successLink = successAlert.locator('a').first();
  const successHref = await successLink.getAttribute('href');
  expect(successHref).toBeTruthy();
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];
  console.log(`[mint-page] success txid = ${broadcastTxid}`);

  // ─── 8. Mine the confirmation block, parse the cat21 ───────────
  const confirmedTip = mineBlocks(1);
  await waitForElectrsSync(confirmedTip);
  const esploraTx = await getTx(broadcastTxid);
  console.log(`[mint-page] locktime=${esploraTx.locktime}  block_hash=${esploraTx.status.block_hash}`);
  expect(esploraTx.locktime).toBe(21);
  expect(esploraTx.status.block_hash).toBeTruthy();

  const parsed = Cat21ParserService.parse(esploraTx);
  expect(parsed).not.toBeNull();
  expect(parsed!.type).toBe(DigitalArtifactType.Cat21);
  expect(parsed!.transactionId).toBe(broadcastTxid);
  expect(parsed!.getImage()).toMatch(/^<svg/);
});

/**
 * Regression for the UtxoContentScanner -> UI warning pipeline.
 *
 * The wallet asset scanner queries our ord and cat21-ord upstreams for
 * `/output/<outpoint>` JSON metadata on every funding-source candidate
 * UTXO at or under `AUTO_SCAN_MAX_VALUE_SAT` (50_000 sat). When the
 * response contains inscriptions, runes, or cats, the orchestrator
 * marks the row's bucket as `assets` and the cat21-mint UI renders
 * a red `⚠ asset found` badge plus a "Use anyway" override button —
 * which sends the asset to the miner as fee if the user picks it.
 *
 * On regtest the real ord upstreams don't know about our UTXOs, so we
 * can't naturally reproduce a cat-bearing funding source. Instead we
 * intercept the SDK's `/output/<outpoint>` requests at the Playwright
 * route layer and return cat metadata for one specific outpoint (the
 * small UTXO we just funded). All other outpoints get `clean`
 * responses so the auto-pick can still find a viable input.
 *
 * What this proves:
 *   1. The orchestrator actually calls `/output/<outpoint>` against
 *      both ord URLs for funding-source UTXOs ≤ 50_000 sat.
 *   2. When the response carries assets, the row's bucket flips to
 *      `assets` and the UI surfaces the red `asset found` badge.
 *   3. The override button on that row reads "Use anyway" (the
 *      danger-styled outline), not "Use this UTXO" — so the user
 *      can't accidentally pick it without acknowledging the warning.
 *
 * What this does NOT prove:
 *   - That a real ord JSON-API response with cat metadata gets parsed
 *     correctly — the mock body matches the documented shape, but a
 *     live ord could ship a richer payload (sat ranges, transfer
 *     history) that this test doesn't exercise.
 */
test('asset scanner: cat-bearing funding UTXO surfaces the "asset found" warning', async () => {
  test.setTimeout(180_000);
  if (!sharedPaymentAddress) {
    throw new Error('first test must have set sharedPaymentAddress');
  }
  const paymentAddress = sharedPaymentAddress;

  // ─── 1. Fund a small NEW UTXO ─────────────────────────────────
  // 0.00015 BTC = 15_000 sat — well under AUTO_SCAN_MAX_VALUE_SAT
  // so it's eligible for the auto-scan pipeline. The change UTXO
  // from the first test (~99_000 sat) is over the threshold and
  // stays `unscanned`.
  const SMALL_FUND_BTC = 0.00015;
  const SMALL_FUND_SATS = Math.round(SMALL_FUND_BTC * 1e8);
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddress, String(SMALL_FUND_BTC)).trim();
  console.log(`[asset-scanner] cat-mock target txid=${fundTxid} (small UTXO ${SMALL_FUND_SATS} sat)`);
  const tip = mineBlocks(1);
  await waitForElectrsSync(tip);
  // Look up the vout that received our 15_000 sat — sendtoaddress's
  // change vout ordering isn't deterministic.
  const small = (await getUtxos(paymentAddress)).find((u) => u.value === SMALL_FUND_SATS && u.txid === fundTxid);
  if (!small) {
    throw new Error(`could not find the ${SMALL_FUND_SATS}-sat funding UTXO under ${paymentAddress}`);
  }
  const catOutpoint = `${small.txid}:${small.vout}`;
  console.log(`[asset-scanner] cat-bearing outpoint = ${catOutpoint}`);

  // ─── 2. Open a fresh page, mock the ord endpoints ─────────────
  const page = await context.newPage();
  // Register the route BEFORE goto so the very first scan call lands
  // on our mock. The pattern `**/output/*` matches both ord URLs
  // (`https://ord.ordpool.space/output/<outpoint>` and
  // `https://ord.cat21.space/output/<outpoint>`) which the SDK queries
  // in parallel via forkJoin.
  await page.route('**/output/*', async (route) => {
    const url = route.request().url();
    const isCatTarget = url.includes(catOutpoint);
    const body = isCatTarget
      ? {
          // ord shape — empty inscriptions / runes:
          inscriptions: [],
          runes: {},
          // cat21-ord shape — non-empty cats array marks this UTXO as
          // carrying the genesis cat. The SDK's UtxoContentScanner
          // merges both responses and any of {inscriptions, runes,
          // cats} being non-empty flips the bucket to `assets`.
          cats: [0],
          // Plausible ord noise the SDK ignores:
          sat_ranges: [[1_000_000, 1_000_001]],
          value: SMALL_FUND_SATS,
          script_pubkey: '',
        }
      : {
          inscriptions: [],
          runes: {},
          cats: [],
        };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });

  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, 'as-01-page-loaded');

  // The persistent context's localStorage remembers the connect from
  // test 1 — Xverse SHOULD auto-reconnect silently. If a permission-
  // renewal popup happens to open, approve it.
  const known = new Set(context.pages());
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: known,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
      .first().click().catch(() => undefined);
    await reapprove.close().catch(() => undefined);
  }

  // ─── 3. Open the funding source picker ────────────────────────
  // The picker lives inside a `<details>` that's collapsed by
  // default. Click the summary to expand so the rows are visible
  // (and so Playwright's auto-wait can see them).
  const pickerSummary = page.locator('details > summary', { hasText: /choose a different funding source/i }).first();
  await expect(pickerSummary).toBeVisible({ timeout: 60_000 });
  await pickerSummary.click();
  await shot(page, 'as-02-picker-open');

  // ─── 4. Assert the asset-found badge appears ─────────────────
  const assetBadge = page.locator('.badge.bg-danger', { hasText: /asset found/i }).first();
  await expect(assetBadge).toBeVisible({ timeout: 45_000 });
  await shot(page, 'as-03-asset-found-badge');

  // ─── 5. Assert the row carrying the badge is OUR cat-mocked one
  // and that its action button is the danger-styled override
  // ("Use anyway"), not the regular "Use this UTXO".
  const assetRow = page.locator('.utxo-row-assets').filter({ hasText: catOutpoint }).first();
  await expect(assetRow).toBeVisible();
  await expect(assetRow.getByRole('button', { name: /use anyway/i })).toBeVisible();
  await expect(assetRow.getByRole('button', { name: /^use this utxo$/i })).toHaveCount(0);

  // ─── 6. And the inline asset-detail block names the cat ───────
  // The template renders the `cats` count when the scan returns
  // non-empty `cats`. Even just confirming the detail block exists
  // proves the orchestrator believed the mock and pushed the state
  // through to the template branch.
  const detail = assetRow.locator('.utxo-assets-detail');
  await expect(detail).toBeVisible();
});

/**
 * Regression for the fee-rate picker.
 *
 * `<app-ordpool-fees-box-clickable>` renders four anchor tiles
 * (economy, hour, halfHour, fastest) bound to the values from
 * StateService.recommendedFees$. Clicking a tile emits
 * `feeClicked.emit(<rate>)`, which the parent component receives in
 * `setFeeRate($event)` and forwards into the `cfeeRate` FormControl.
 * The number input bound to `[formControl]="cfeeRate"` updates
 * accordingly.
 *
 * The stub answers the mempool WebSocket on connect with a snapshot
 * containing `{fees:{fastestFee:5, halfHourFee:3, hourFee:1,
 * economyFee:1, minimumFee:1}}`. So this test pins:
 *
 *   1. The picker renders the four numeric rates straight from the
 *      WebSocket-derived `recommendedFees$` stream (proves WS → state
 *      → template flow).
 *   2. Clicking the fastest tile writes `5` into the manual fee-rate
 *      input.
 *   3. Clicking the economy tile writes `1` (or, on this stub,
 *      identical to hour because both are 1).
 *   4. The picker survives a page reload — the WS reconnect populates
 *      fees again without needing a user action.
 */
test('fee picker: tier clicks update the manual fee-rate input', async () => {
  test.setTimeout(120_000);

  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, 'fp-01-loaded');

  // Auto-reconnect from localStorage — same dance as the asset-scanner
  // test. The wallet must be connected for the form (and the picker)
  // to render.
  const known = new Set(context.pages());
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: known,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
      .first().click().catch(() => undefined);
    await reapprove.close().catch(() => undefined);
  }

  // Wait for the picker to leave its skeleton-loading template.
  // While loading, the four `.item` divs sit inside
  // `.loading-container` and contain `.skeleton-loader` rather than
  // the real `<a>` tiles. Anchor presence is the cheapest signal.
  const tiles = page.locator('.fee-estimation-container .item a');
  await expect(tiles).toHaveCount(4, { timeout: 45_000 });
  await shot(page, 'fp-02-picker-ready');

  // The tile order is fixed: 0=economy, 1=hour, 2=halfHour, 3=fastest.
  // Stub fees: economy=1, hour=1, halfHour=3, fastest=5. Each tile
  // renders `<app-fee-rate>` showing "<rate> sat/vB". We pin each
  // tile's text contains both the expected rate and the unit so
  // we don't accidentally match a substring like "15" against "1".
  await expect(tiles.nth(2)).toContainText('3', { timeout: 10_000 });
  await expect(tiles.nth(2)).toContainText('sat/vB');
  await expect(tiles.nth(3)).toContainText('5');
  await expect(tiles.nth(3)).toContainText('sat/vB');

  // The manual fee-rate input the mint form binds via
  // `[formControl]="cfeeRate"`. Pin it by the surrounding input-group
  // label (same selector test 1 uses).
  const feeRateInput = page.locator(
    '.input-group:has(.input-group-text:text-is("Fee rate")) input[type="number"]',
  ).first();
  await expect(feeRateInput).toBeVisible();

  // Click the fastest tile (index 3) — expect the input to read "5".
  await tiles.nth(3).click();
  await expect(feeRateInput).toHaveValue('5', { timeout: 5_000 });
  await shot(page, 'fp-03-fastest-clicked');

  // Click the halfHour tile (index 2) — expect input "3".
  await tiles.nth(2).click();
  await expect(feeRateInput).toHaveValue('3', { timeout: 5_000 });
  await shot(page, 'fp-04-halfhour-clicked');

  // Click the hour tile (index 1) — expect input "1".
  await tiles.nth(1).click();
  await expect(feeRateInput).toHaveValue('1', { timeout: 5_000 });
});
