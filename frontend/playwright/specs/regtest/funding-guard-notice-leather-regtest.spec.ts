/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  seedInscribedCoin,
  getUtxos,
  rpc,
  waitForApprovalPopup,
  onboardLeather,
  waitForOptionalApprovalPopup,
  clickApprovalAndRequireClose,
} from 'ordpool-sdk/e2e';
import { readPaymentAddress } from './payment-address';

/**
 * E2E (regtest) — the SEPARATE-ADDRESS NOTICE cell: asset-notice, CTA ENABLED.
 *
 * The third funding-panel state, and the one that needs a wallet the other two
 * specs can't provide: a SEPARATE-address wallet (payment != ordinals) with a
 * genuinely DIRTY-ONLY pool. Leather is separate-address (its connector fills
 * paymentAddress and ordinalsAddress from two different derivations, so
 * isOneAddressWallet reads it as separate).
 *
 * WHY THIS RUNS ON THE INSCRIBE-DIRTY-MATRIX LANE, not the mint lane: a
 * dirty-only pool needs an UNCONTAMINATED payment address, and the mint lane
 * cannot give leather one. The freshly-onboarded p2wpkh wallets (unisat, wizz,
 * leather) all derive the SAME payment address from one test mnemonic, so on the
 * mint lane leather's address is loaded with every unisat/wizz/leather spec's
 * seeds (a fresh user-data-dir does NOT mean a fresh address). The
 * inscribe-dirty-matrix lane runs only the Xverse-driven matrix, which seeds to
 * the Xverse address, a different derivation, so leather's shared p2wpkh address
 * is untouched here and the ONLY coin is the one we seed. The premise guard below
 * enforces exactly that.
 *
 * THE PREMISE GUARD (this cell's equivalent of the matrices'
 * assertDirtyCoinIsBestFit): before the page reads anything, assert the pool is
 * dirty-ONLY, i.e. the payment address holds EXACTLY the seeded coin and nothing
 * else. Without it, a stray clean coin would silently turn asset-notice into auto
 * and the notice assertions would be testing nothing, which is exactly how the
 * shared-vault leftovers slipped past on the Xverse attempt.
 *
 * The dirty coin is a real inscription-bearing UTXO at 10,000 sat: covering (the
 * mint needs far less) and <= AUTO_SCAN_MAX_VALUE_SAT, so it is auto-scanned to
 * bucket 'assets' with the inscription id in the detail, which is what lets the
 * notice NAME the coin. On a separate-address wallet a dirty-only covering pool
 * is asset-notice, so this asserts BOTH halves of that state:
 *   - the notice alert is shown, NAMES the inscription by id, and the Mint button
 *     stays ENABLED (notice-and-proceed: the user is informed, not blocked), and
 *   - the picker flags the coin (asset-found badge, inscription named).
 * It deliberately does NOT click Mint: proceeding here would spend the asset with
 * the user's informed consent, and the point of this spec is the notice, not the
 * spend. The one-address BLOCK is the mirror in
 * funding-guard-warning-block-unisat-regtest.spec.ts.
 *
 * CI-only (unverified .crx). See `playwright.regtest.config.ts`.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/cat21-mint';

// Covering (mint needs ~700-1300 at 1 sat/vB) and <= AUTO_SCAN_MAX_VALUE_SAT
// (50k), so the coin is auto-scanned to 'assets' and the notice can name it.
const INSCRIBED_POSTAGE_SATS = 10_000;

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.LEATHER_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/leather');
const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  if (p.isClosed()) return;
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `funding-guard-notice-leather-${name}.png`),
    fullPage: true,
  });
}

// Leather's connect approval is the get-addresses popup; click its stable
// testid (lifted verbatim from the proven inscribe-mint-leather spec, whose
// generic text/role match was NOT reliable for this button).
/** Approve the connect popup. Required unless `optional`: a first connect always asks, a reload may not. */
async function approveLeatherConnect(knownPages: Set<Page>, timeoutMs: number, opts: { optional?: boolean } = {}): Promise<void> {
  const wait = opts.optional ? waitForOptionalApprovalPopup : waitForApprovalPopup;
  const popup = await wait({
    context,
    knownPages,
    timeoutMs,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByTestId('get-addresses-approve-button').waitFor({ state: 'visible', timeout: timeoutMs });
      return true;
    },
  });
  if (!popup) return;
  await clickApprovalAndRequireClose(popup.getByTestId('get-addresses-approve-button'), popup, { closeTimeoutMs: 30_000, label: 'Leather connect popup' });
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`Leather extension not unpacked at ${EXT_PATH}.`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). bootstrap should have mined past maturity.`);
  }

  const workingDir = path.resolve(RESULTS_DIR, `leather-notice-user-data-dir-${process.pid}-${Date.now()}`);
  fs.mkdirSync(workingDir, { recursive: true });

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
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  extensionId = worker.url().split('/')[2];

  const primer = await context.newPage();
  await onboardLeather(primer, extensionId);
  await primer.close();
});

test.afterAll(async () => {
  await context?.close();
});

test('separate-address wallet, dirty-only pool: asset-notice names the coin and proceeds (leather, real ord)', async () => {
  test.setTimeout(300_000);

  // ─── 1. Open /cat21-mint, connect Leather (separate-address, fresh) ──
  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const connectTrigger = page.getByTestId('connect-wallet-trigger').first();
  await expect(connectTrigger).toBeVisible({ timeout: 30_000 });

  const knownPagesBeforeConnect = new Set(context.pages());
  await connectTrigger.click();
  await page.getByTestId('wallet-connect-leather').click({ timeout: 20_000 });
  await approveLeatherConnect(knownPagesBeforeConnect, 60_000);
  await page.bringToFront();

  const paymentAddress = await readPaymentAddress(page);
  console.log(`[notice-leather] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  // ─── 2. Seed a REAL inscribed coin as the ONLY funding candidate ──────
  const inscribed = await seedInscribedCoin({
    address: paymentAddress,
    postageSats: INSCRIBED_POSTAGE_SATS,
  });
  const inscribedOutpoint = `${inscribed.txid}:${inscribed.vout}`;
  console.log(`[notice-leather] inscribed coin ${inscribedOutpoint} value=${inscribed.value} id=${inscribed.inscriptionId}`);
  expect(inscribed.value).toBe(INSCRIBED_POSTAGE_SATS);

  // ─── 3. THE PREMISE GUARD: the pool is dirty-ONLY ─────────────────────
  // The asset-notice status only means something if NO clean coin covers. On a
  // fresh leather address the seeded coin must be the ONLY coin; assert that
  // BEFORE the page reads anything, so a stray clean coin fails here at setup
  // (naming the trap) instead of silently turning asset-notice into auto and
  // making the notice assertions vacuous. This is the notice path's equivalent
  // of the matrices' assertDirtyCoinIsBestFit.
  const pool = await getUtxos(paymentAddress);
  expect(pool.length, `dirty-only premise: leather payment addr must hold ONLY the seeded coin, holds ${JSON.stringify(pool.map((u) => `${u.txid}:${u.vout}=${u.value}`))}`).toBe(1);
  expect(`${pool[0].txid}:${pool[0].vout}`).toBe(inscribedOutpoint);

  // ─── 4. Reload so the orchestrator re-fetches + scans ─────────────────
  const knownPagesBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await approveLeatherConnect(knownPagesBeforeReload, 8_000, { optional: true });
  await page.bringToFront();

  const feeRateInput = page.locator('[data-testid="cat21-fee-rate"]').first();
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');

  // ─── 5. THE NOTICE: asset-notice on a separate-address wallet ─────────
  // Dirty-only pool + separate payment address = asset-notice: the notice NAMES
  // what the coin carries and the Mint button stays ENABLED (informed, not
  // blocked). The notice naming the inscription is the load-bearing proof.
  const noticeAlert = page.locator('.alert.alert-warning', {
    hasText: /we'll fund this mint from a coin that carries an asset/i,
  }).first();
  await expect(noticeAlert).toBeVisible({ timeout: 90_000 });
  await expect(noticeAlert).toContainText(inscribed.inscriptionId);

  const mintButton = page.getByTestId('mint-cat-button');
  await expect(mintButton).toBeVisible({ timeout: 30_000 });
  await expect(mintButton).toBeEnabled();
  // The notice and the enabled CTA must be readable together (FAMILY_UX rule).
  await mintButton.scrollIntoViewIfNeeded();
  await expect(noticeAlert).toBeInViewport();
  await expect(mintButton).toBeInViewport();
  await shot(page, '01-notice-enabled-viewport');
  await shot(page, '02-notice-enabled-fullpage');

  // ─── 6. Prove the coin is genuinely the dirty one (picker) ────────────
  const pickerSummary = page.locator('details > summary', { hasText: /choose a different funding source/i }).first();
  await expect(pickerSummary).toBeVisible({ timeout: 30_000 });
  await pickerSummary.click();
  const assetRow = page.locator('.utxo-row-assets').filter({ hasText: inscribedOutpoint }).first();
  await expect(assetRow).toBeVisible({ timeout: 30_000 });
  await expect(assetRow.locator('.badge.bg-danger', { hasText: /asset found/i })).toBeVisible();
  const detail = assetRow.locator('.utxo-assets-detail');
  await expect(detail).toContainText('Inscription');
  await expect(detail).toContainText(inscribed.inscriptionId);
  await shot(page, '03-picker-open-dirty-proof');

  // Deliberately NOT minting: asset-notice proceeds only with the user's
  // informed consent, and clicking Mint here would spend the inscription. The
  // proof is the notice + enabled CTA, not the spend.
});
