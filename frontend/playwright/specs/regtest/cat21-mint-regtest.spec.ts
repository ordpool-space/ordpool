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

  // ─── 5. Drive the fee picker + summary; wait for "Mint my cat" ─
  // The UTXO list polls electrs on a ~30s cadence in production. In
  // dev/regtest the orchestrator re-fetches whenever the wallet emits
  // a new connection event, so the new UTXO should show up shortly
  // after the connect dance above.
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
