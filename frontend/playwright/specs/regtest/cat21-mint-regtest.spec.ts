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

  // ─── 5a. Fee picker tier click round-trip ─────────────────────
  // `<app-ordpool-fees-box-clickable>` renders four anchor tiles
  // (economy, hour, halfHour, fastest) bound to the values from
  // StateService.recommendedFees$. Clicking a tile emits
  // `feeClicked.emit(<rate>)` → the parent's `setFeeRate($event)` →
  // `cfeeRate.setValue()` → the number input's value updates.
  // The stub's WS frame supplies {fastest:5, halfHour:3, hour:1,
  // economy:1, minimum:1}.
  //
  // We exercise the picker inline with test 1 because a follow-up
  // standalone test on a separate page hit a state where Xverse's
  // vault unexpectedly looked reset (test-failed-3.png artifact on
  // run 27481577440 showed the "Create new wallet" onboarding
  // screen on the third page). Keeping the picker proof inside the
  // already-connected test 1 avoids that whole class of flake.
  const tiles = page.locator('.fee-estimation-container .item a');
  await expect(tiles).toHaveCount(4, { timeout: 30_000 });
  // Order on screen: 0=economy, 1=hour, 2=halfHour, 3=fastest.
  // The economy `<a>` ships with its click handler commented out by
  // design (current screenshot shows the comment block above it), so
  // we only click the three working tiers (1..3) and assert the input
  // updates each time.
  await tiles.nth(3).click(); // fastest -> 5 sat/vB
  await expect(feeRateInput).toHaveValue('5', { timeout: 5_000 });
  await tiles.nth(2).click(); // halfHour -> 3 sat/vB
  await expect(feeRateInput).toHaveValue('3', { timeout: 5_000 });
  await tiles.nth(1).click(); // hour -> 1 sat/vB
  await expect(feeRateInput).toHaveValue('1', { timeout: 5_000 });
  await shot(page, '05-fee-picker-tier-clicks');

  // ─── 5b. Fee-rate floor validation ────────────────────────────
  // `cfeeRate` is bound by `[Validators.required, Validators.min(0.1)]`.
  // Below 0.1 sat/vB Bitcoin Core's default `-minrelaytxfee` rejects
  // the broadcast, so the form has to refuse the input client-side.
  // We type 0 and 0.05, assert the Mint button stays disabled, then
  // reset to 1 for the rest of the round-trip.
  const mintButton = page.getByRole('button', { name: /mint my cat/i }).first();
  await feeRateInput.fill('0');
  await feeRateInput.press('Tab');
  await expect(mintButton).toBeDisabled({ timeout: 5_000 });
  await feeRateInput.fill('0.05');
  await feeRateInput.press('Tab');
  await expect(mintButton).toBeDisabled({ timeout: 5_000 });

  // Final manual override (also pins the rate the rest of the
  // mint round-trip will use).
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  await shot(page, '05-fee-set');

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

  // ─── 8a. RBF prevention ──────────────────────────────────────
  // CAT-21 inputs MUST have sequence ≥ 0xfffffffe — anything lower
  // signals RBF, and an RBF-replaceable mint can be "accelerated"
  // by a wallet (or by a paid accelerator service) which drops the
  // `nLockTime=21` and silently kills the cat. This is exactly
  // what happened in the Xverse RBF incident of 2024 — see
  // `project_cat21_must_not_signal_rbf.md`. Any future regression
  // in the orchestrator's PSBT builder (or in any wallet connector)
  // that signs with a lower sequence would slip past the
  // `locktime === 21` check alone, so we pin every input here.
  expect(esploraTx.vin.length).toBeGreaterThan(0);
  for (const vin of esploraTx.vin) {
    expect(vin.sequence).toBeGreaterThanOrEqual(0xfffffffe);
  }

  // ─── 8b. Output integrity ────────────────────────────────────
  // The cat sat lives on the FIRST sat of output 0 per ordinal
  // theory. CAT-21 protocol fixes that output at exactly 546 sat
  // (the segwit dust threshold). If a wallet quietly reshuffles
  // outputs (e.g. drops the dust output to "save sats") the cat is
  // gone even though `locktime=21` and parseability still hold,
  // because ord assigns the cat number to whatever the FIRST sat of
  // the FIRST output is. Verifying the output structure here
  // protects against that whole class of wallet-side fiddling.
  expect(esploraTx.vout.length).toBeGreaterThanOrEqual(1);
  expect(esploraTx.vout[0].value).toBe(546);

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
  // electrs's address index can lag the chain tip — poll with a
  // deadline so the test tolerates the per-address indexing delay.
  let small: { txid: string; vout: number; value: number } | undefined;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    small = (await getUtxos(paymentAddress)).find(
      (u) => u.value === SMALL_FUND_SATS && u.txid === fundTxid,
    );
    if (small) break;
    await new Promise((r) => setTimeout(r, 500));
  }
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
  // No fee-rate nudge needed any more. Earlier runs needed one
  // because `paymentOutputs$` was an RxJS Observable that read
  // `scanStates()` as a snapshot inside `map(...)` — the map
  // didn't re-run when the scanner signal updated, so the row's
  // `bucket` stayed at `not-scanned` indefinitely. Fixed in
  // cat21-mint.component.ts by switching to
  // `combineLatest([simulations$, scanner.states$])` so the map
  // fires whenever EITHER source emits. The scanner's `states$`
  // is a BehaviorSubject so the initial empty-Map value emits
  // immediately on subscribe; the cat-mocked outpoint flips its
  // bucket to `assets` the moment its scan completes.
  const assetBadge = page.locator('.badge.bg-danger', { hasText: /asset found/i }).first();
  await expect(assetBadge).toBeVisible({ timeout: 30_000 });
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

  // ─── 7. "Use anyway" → full mint round-trip — the cat is burned
  // The override button is the only way to proceed past the warning.
  // Clicking it selects the cat-bearing row (the orchestrator's
  // selectedPaymentOutput now points at the warned UTXO). The Mint
  // button stays enabled (the warning is informational, not a
  // hard-block — the user is in charge of their own funds). We
  // complete the mint and verify on-chain that the cat-mocked
  // outpoint was indeed spent as the input — proving that "I know
  // what I'm doing, mint anyway" actually reaches the chain.
  const overrideBtn = assetRow.getByRole('button', { name: /use anyway/i });
  await overrideBtn.click();
  const mintBtn = page.getByRole('button', { name: /mint my cat/i }).first();
  await expect(mintBtn).toBeEnabled({ timeout: 30_000 });

  const knownBeforeBurnSign = new Set(context.pages());
  await mintBtn.click();
  const burnSign = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeBurnSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByText(/review transaction/i).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await burnSign.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.some((b) => {
      if (!/^confirm$/i.test(b.textContent?.trim() ?? '')) return false;
      if (b.hasAttribute('disabled')) return false;
      const style = getComputedStyle(b);
      return style.pointerEvents !== 'none' && style.visibility !== 'hidden';
    });
  }, undefined, { timeout: 30_000, polling: 250 });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (burnSign.isClosed()) break;
    await burnSign.getByRole('button', { name: /^confirm$/i }).first()
      .click({ force: true })
      .catch(() => undefined);
    const closed = new Promise<void>((res) => burnSign.once('close', () => res()));
    await Promise.race([
      closed,
      expect(burnSign.getByRole('button', { name: /^confirm$/i }).first())
        .toBeHidden({ timeout: 30_000 }),
    ]).catch(() => undefined);
    if (burnSign.isClosed()) break;
  }

  const burnSuccess = page.locator('.alert.alert-success').first();
  await expect(burnSuccess).toBeVisible({ timeout: 90_000 });
  const burnHref = await burnSuccess.locator('a').first().getAttribute('href');
  const burnTxidMatch = burnHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(burnTxidMatch).not.toBeNull();
  const burnTxid = burnTxidMatch![1];

  const burnConfTip = mineBlocks(1);
  await waitForElectrsSync(burnConfTip);
  const burnTx = await getTx(burnTxid);
  expect(burnTx.locktime).toBe(21);
  expect(burnTx.vout[0].value).toBe(546);
  for (const vin of burnTx.vin) {
    expect(vin.sequence).toBeGreaterThanOrEqual(0xfffffffe);
  }
  // The mint had to spend the cat-mocked UTXO — the smaller
  // value-15000 row was the only one the user clicked. (The 99k
  // change row wouldn't have triggered a warning so a regression
  // that silently re-selected it would falsify this assertion.)
  const spentCatOutpoint = burnTx.vin.some(
    (v: { txid: string; vout: number }) => `${v.txid}:${v.vout}` === catOutpoint,
  );
  expect(spentCatOutpoint).toBe(true);
});

/**
 * Sign-popup cancel — the user changes their mind partway through.
 *
 * Click Mint, wait for the Xverse approval popup, click Cancel
 * (not Confirm). The orchestrator's mint() promise rejects with the
 * sats-connect error, the state machine moves out of `minting`, the
 * success alert MUST NOT appear, no on-chain tx is broadcast. The
 * form stays usable so the user can retry.
 *
 * Catches regressions where:
 *   - the orchestrator doesn't catch the user-cancel rejection and
 *     hangs in `minting` forever (mint button stays disabled);
 *   - the success card renders despite no broadcast happening (the
 *     happy-path branch races the error branch);
 *   - the rejection is swallowed silently and Cat21Service still
 *     attempts to broadcast a zero-byte / unsigned PSBT.
 */
test('sign-popup cancel keeps state coherent', async () => {
  test.setTimeout(180_000);
  if (!sharedPaymentAddress) throw new Error('first test must have set sharedPaymentAddress');

  const FUND_BTC = 0.0003;
  rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, String(FUND_BTC));
  await waitForElectrsSync(mineBlocks(1));

  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });

  // Wait for picker + mint button enabled.
  const mintButton = page.getByRole('button', { name: /mint my cat/i }).first();
  const feeRateInput = page.locator(
    '.input-group:has(.input-group-text:text-is("Fee rate")) input[type="number"]',
  ).first();
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  await expect(mintButton).toBeEnabled({ timeout: 60_000 });
  await shot(page, 'cancel-01-ready');

  // Click Mint, wait for popup, click Cancel.
  const knownBeforeCancel = new Set(context.pages());
  await mintButton.click();
  const cancelPopup = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeCancel,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByText(/review transaction/i).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await shot(cancelPopup, 'cancel-02-popup');
  await cancelPopup.getByRole('button', { name: /^cancel$/i }).first()
    .click({ force: true });
  await cancelPopup.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);

  // Form must NOT show a success alert. Give the orchestrator a
  // moment to settle.
  await page.waitForTimeout(2_000);
  await shot(page, 'cancel-03-after-close');
  await expect(page.locator('.alert.alert-success')).toHaveCount(0);
});

/**
 * Broadcast-failure error path.
 *
 * The PSBT signs fine but POST `/api/tx` returns 400 (e.g. mempool
 * rejection — non-standard, fee-too-low post-replacement, or a
 * stale-UTXO double-spend). The orchestrator's broadcast call must
 * surface as an error alert, NOT as a fake success. The mock
 * intercepts the broadcast endpoint and returns 400 with a synthetic
 * "test-induced rejection" body.
 */
test('broadcast failure surfaces as an error, not a fake success', async () => {
  test.setTimeout(240_000);
  if (!sharedPaymentAddress) throw new Error('first test must have set sharedPaymentAddress');

  const FUND_BTC = 0.0003;
  rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, String(FUND_BTC));
  await waitForElectrsSync(mineBlocks(1));

  const page = await context.newPage();
  // Reject every POST to /api/tx — the SDK broadcasts via
  // `${mempoolApiUrl}/api/tx`. Status 400 mirrors a real mempool
  // rejection shape; the body is opaque to the spec.
  await page.route('**/api/tx', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 400,
        contentType: 'text/plain',
        headers: { 'access-control-allow-origin': '*' },
        body: 'test-induced broadcast rejection: bad-txns-inputs-missingorspent',
      });
      return;
    }
    await route.continue();
  });
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });

  const mintButton = page.getByRole('button', { name: /mint my cat/i }).first();
  const feeRateInput = page.locator(
    '.input-group:has(.input-group-text:text-is("Fee rate")) input[type="number"]',
  ).first();
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  await expect(mintButton).toBeEnabled({ timeout: 60_000 });

  // Click Mint, complete the sign popup successfully; the broadcast
  // fails downstream.
  const knownBeforeBcast = new Set(context.pages());
  await mintButton.click();
  const bcastSign = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeBcast,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByText(/review transaction/i).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await bcastSign.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.some((b) => {
      if (!/^confirm$/i.test(b.textContent?.trim() ?? '')) return false;
      if (b.hasAttribute('disabled')) return false;
      const style = getComputedStyle(b);
      return style.pointerEvents !== 'none' && style.visibility !== 'hidden';
    });
  }, undefined, { timeout: 30_000, polling: 250 });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (bcastSign.isClosed()) break;
    await bcastSign.getByRole('button', { name: /^confirm$/i }).first()
      .click({ force: true })
      .catch(() => undefined);
    const closed = new Promise<void>((res) => bcastSign.once('close', () => res()));
    await Promise.race([
      closed,
      expect(bcastSign.getByRole('button', { name: /^confirm$/i }).first())
        .toBeHidden({ timeout: 30_000 }),
    ]).catch(() => undefined);
    if (bcastSign.isClosed()) break;
  }

  // Error alert must appear; success alert must NOT.
  const errorAlert = page.locator('.alert.alert-danger, .alert-danger').first();
  await expect(errorAlert).toBeVisible({ timeout: 60_000 });
  await shot(page, 'bcast-fail-01-error-alert');
  await expect(page.locator('.alert.alert-success')).toHaveCount(0);
});

// Fee-picker proof now lives inline in test 1, before the Mint click.
// A standalone test on a separate page hit a state where Xverse's
// vault appeared reset (test-failed-3.png on run 27481577440 showed
// the "Create new wallet" onboarding screen on page 3 of the context),
// which was much harder to reproduce reliably than the inline
// assertion. Keeping all picker-mechanic asserts inside the already-
// connected test 1 sidesteps that flake entirely.

/**
 * Manual-override end-to-end: the user's typed rate must be EXACTLY
 * the rate that lands on-chain, regardless of what the picker is
 * suggesting at the moment.
 *
 * Mirror of cat21-indexer's mintAtRateAndVerify scenarios. Two real-
 * world cases:
 *
 *   A. "Mempool quiet, user wants a purple cat" (CAT-21 colour
 *      buckets are fee-rate driven — high fees unlock fire at
 *      69 sat/vB, saturated at 420). Default low stub fees stand.
 *      User types 100. Resulting tx fee/vsize ≈ 100 ±1 sat/vB.
 *
 *   B. "Mempool hot, user still wants low." Test POSTs an
 *      "high preset" to the stub's /admin/fees endpoint, which
 *      broadcasts a fresh `fees` snapshot to the WS. The picker
 *      tiles flip to the new values; the user types 1 anyway.
 *      Resulting tx fee/vsize ≈ 1 ±1 sat/vB.
 *
 * Both verify rate flow: input → cfeeRate FormControl →
 * orchestrator.setFeeRate → simulations$ → PSBT → Xverse signing
 * → broadcast → confirmed tx. A regression at any layer surfaces
 * as a mismatch in the on-chain fee_rate.
 */

const HIGH_FEES_PRESET = {
  fastestFee: 100,
  halfHourFee: 60,
  hourFee: 30,
  economyFee: 20,
  minimumFee: 10,
};

async function ordpoolMintAtRate(opts: {
  rate: number;
  scenarioLabel: string;
  /** When true, POST the high preset to the stub before opening the
   *  page so the picker tiles render with values that visibly
   *  disagree with the user's typed rate. Reset on teardown. */
  mockFeesAsHigh?: boolean;
}): Promise<{ broadcastTxid: string; fee: number; vsize: number; rate: number }> {
  if (!sharedPaymentAddress) throw new Error('first test must have set sharedPaymentAddress');

  if (opts.mockFeesAsHigh) {
    const res = await fetch('http://localhost:8999/admin/fees', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(HIGH_FEES_PRESET),
    });
    if (!res.ok) {
      throw new Error(`stub /admin/fees rejected: ${res.status} ${await res.text()}`);
    }
  }

  try {
    // ─── Fund a fresh UTXO at the shared payment address ─────────
    const FUND_BTC = 0.001;
    const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, String(FUND_BTC)).trim();
    console.log(`[${opts.scenarioLabel}] funded ${sharedPaymentAddress} +${FUND_BTC} BTC tx=${fundTxid}`);
    const tip = mineBlocks(1);
    await waitForElectrsSync(tip);

    // ─── Open page, auto-reconnect ───────────────────────────────
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
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
    await shot(page, `mr-${opts.scenarioLabel}-01-loaded`);

    // ─── Wait for the fee picker tiles to render, sanity-check that
    // the WS frame actually carried the expected scenario values. ─
    const tiles = page.locator('.fee-estimation-container .item a');
    await expect(tiles).toHaveCount(4, { timeout: 30_000 });
    if (opts.mockFeesAsHigh) {
      // tile index 3 is the fastest tier — should show 100 from the
      // high preset we POSTed.
      await expect(tiles.nth(3)).toContainText('100', { timeout: 10_000 });
    }

    // ─── User-typed override ─────────────────────────────────────
    const feeRateInput = page.locator(
      '.input-group:has(.input-group-text:text-is("Fee rate")) input[type="number"]',
    ).first();
    await feeRateInput.fill(String(opts.rate));
    await feeRateInput.press('Tab');
    await shot(page, `mr-${opts.scenarioLabel}-02-rate-typed`);

    const mintButton = page.getByRole('button', { name: /mint my cat/i }).first();
    await expect(mintButton).toBeEnabled({ timeout: 60_000 });

    // ─── Click Mint, approve Xverse sign popup ───────────────────
    const knownBeforeSign = new Set(context.pages());
    await mintButton.click();
    const approvalSign = await waitForApprovalPopup({
      context,
      knownPages: knownBeforeSign,
      timeoutMs: 120_000,
      isApproval: async (p) => {
        if (!p.url().startsWith('chrome-extension://')) return false;
        await p.getByText(/review transaction/i).first()
          .waitFor({ state: 'visible', timeout: 120_000 });
        return true;
      },
    });
    await shot(approvalSign, `mr-${opts.scenarioLabel}-03-sign-popup`);

    await approvalSign.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.some((b) => {
        if (!/^confirm$/i.test(b.textContent?.trim() ?? '')) return false;
        if (b.hasAttribute('disabled')) return false;
        const style = getComputedStyle(b);
        return style.pointerEvents !== 'none' && style.visibility !== 'hidden';
      });
    }, undefined, { timeout: 30_000, polling: 250 });
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

    // ─── Wait for success alert + extract broadcast txid ─────────
    const successAlert = page.locator('.alert.alert-success').first();
    await expect(successAlert).toBeVisible({ timeout: 90_000 });
    await shot(page, `mr-${opts.scenarioLabel}-04-success`);
    const successHref = await successAlert.locator('a').first().getAttribute('href');
    const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
    expect(txidMatch).not.toBeNull();
    const broadcastTxid = txidMatch![1];

    // ─── Mine confirmation, parse, compute on-chain fee_rate ─────
    const confTip = mineBlocks(1);
    await waitForElectrsSync(confTip);
    const tx = await getTx(broadcastTxid);
    expect(tx.locktime).toBe(21);
    expect(tx.status.block_hash).toBeTruthy();
    // RBF + output integrity, on every mint round-trip — see test 1's
    // 8a/8b comments for the safety rationale.
    expect(tx.vin.length).toBeGreaterThan(0);
    for (const vin of tx.vin) {
      expect(vin.sequence).toBeGreaterThanOrEqual(0xfffffffe);
    }
    expect(tx.vout.length).toBeGreaterThanOrEqual(1);
    expect(tx.vout[0].value).toBe(546);
    const parsed = Cat21ParserService.parse(tx);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe(DigitalArtifactType.Cat21);
    const vsize = Math.ceil(tx.weight / 4);
    const rate = tx.fee / vsize;
    console.log(`[${opts.scenarioLabel}] fee=${tx.fee} sat, vsize=${vsize} vB, rate=${rate.toFixed(3)} sat/vB (target ${opts.rate})`);

    await page.close().catch(() => undefined);
    return { broadcastTxid, fee: tx.fee, vsize, rate };
  } finally {
    // Always restore the default low preset so the next test sees a
    // predictable stub state.
    if (opts.mockFeesAsHigh) {
      await fetch('http://localhost:8999/admin/fees/reset', { method: 'POST' })
        .catch(() => undefined);
    }
  }
}

test('manual override: typing 100 mints a "purple cat" — high rate ends up on-chain', async () => {
  test.setTimeout(420_000);
  const { rate } = await ordpoolMintAtRate({ rate: 100, scenarioLabel: 'purple' });
  expect(Math.abs(rate - 100)).toBeLessThan(1);
});

test('manual override: typing 1 while the picker suggests 100 (mempool hot) — low rate ends up on-chain', async () => {
  test.setTimeout(420_000);
  const { rate } = await ordpoolMintAtRate({ rate: 1, scenarioLabel: 'hot-mempool', mockFeesAsHigh: true });
  expect(Math.abs(rate - 1)).toBeLessThan(1);
});
