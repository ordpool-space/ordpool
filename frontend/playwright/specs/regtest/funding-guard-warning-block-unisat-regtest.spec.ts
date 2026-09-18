/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  seedInscribedCoin,
  rpc,
  waitForApprovalPopup,
  onboardUnisat,
} from 'ordpool-sdk/e2e';

/**
 * E2E (regtest) — the ONE-ADDRESS WARNING + under-block proof, and the family's
 * one-address funding-panel screenshot.
 *
 * The Xverse funding-guard spec proves the guard NAMES an inscribed coin; this
 * proves the other half of the funding-safety rule: on a wallet that keeps ONE
 * address for everything (payment === ordinals), a dirty-only funding pool is a
 * WARNING that BLOCKS. Unisat is that wallet (its connector reports a single
 * address, so `isOneAddressWallet` holds and the SDK returns `expert-required`,
 * not `asset-notice`).
 *
 * The setup is funding-guard's: the ONLY funding candidate on the payment
 * address is a real inscription-bearing UTXO (`seedInscribedCoin`, 2M sat so it
 * is a covering candidate the scan actually considers). The stock ord (:8081)
 * reports its inscription; cat21-ord (:8080) its cats; the funding-safety scan
 * reads both and classifies the coin unsafe. On a one-address wallet that
 * produces `expert-required`, so:
 *   - the Mint button is DISABLED (the block — the user must decide in the
 *     picker; nothing can be broadcast until they do),
 *   - the WARNING alert is shown (naming the asset class), and
 *   - the picker is OFFERED ("Choose a different funding source").
 *
 * THE SCREENSHOT the maintainer's family set is missing: the warning, the
 * disabled CTA and the picker offer in ONE viewport, taken with the picker
 * COLLAPSED (opening it for the dirty-proof below pushes the button out of the
 * viewport). Caveat: this is ordpool's /cat21-mint layout, not cat21.space's.
 *
 * THE UNDER-BLOCK PROOF (same run): the CTA is disabled AND no success alert
 * ever appears — nothing is broadcast because the user cannot proceed. Then the
 * picker is opened to prove the blocking coin is genuinely the dirty one (the
 * "asset found" badge + the inscription named by id), so the block is a real
 * asset refusal, not an incidental disable.
 *
 * CI-only (unverified .crx). See `playwright.regtest.config.ts`.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/cat21-mint';

// Big enough to be a covering candidate for a mint, so the funding-safety scan
// considers it and the guard is genuinely asked (funding-guard's fixture size).
const INSCRIBED_POSTAGE_SATS = 2_000_000;

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.UNISAT_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/unisat');
const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string, fullPage = true): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `funding-guard-warning-block-unisat-${name}.png`),
    fullPage,
  }).catch(() => undefined);
}

// Unisat renders its connect approval at notification.html#/approval.
async function approveUnisatConnect(knownPages: Set<Page>, timeoutMs: number): Promise<Page | null> {
  const popup = await waitForApprovalPopup({
    context,
    knownPages,
    timeoutMs,
    isApproval: async (p) => {
      await p.waitForURL(/notification\.html#\/approval/, { timeout: timeoutMs });
      return true;
    },
  }).catch(() => null);
  if (popup) {
    await popup.getByText(/^Connect$/).first().click();
    await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }
  return popup;
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`Unisat extension not unpacked at ${EXT_PATH}.`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). bootstrap should have mined past maturity.`);
  }

  const workingDir = path.resolve(RESULTS_DIR, `unisat-warning-block-user-data-dir-${process.pid}-${Date.now()}`);
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
  await onboardUnisat(primer, extensionId, { password: 'correct-horse-battery-staple-Tr0ub4dor-9876' });
  await primer.close();
});

test.afterAll(async () => {
  await context?.close();
});

test('one-address wallet: a dirty-only pool WARNS and BLOCKS the mint (unisat, real ord)', async () => {
  test.setTimeout(300_000);

  // ─── 1. Open /cat21-mint, connect Unisat (one address for everything) ──
  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const connectTrigger = page.getByTestId('connect-wallet-trigger').first();
  await expect(connectTrigger).toBeVisible({ timeout: 30_000 });

  const knownPagesBeforeConnect = new Set(context.pages());
  await connectTrigger.click();
  await page.getByTestId('wallet-connect-unisat').click({ timeout: 20_000 });
  await approveUnisatConnect(knownPagesBeforeConnect, 60_000);
  await page.bringToFront();

  const paymentCode = page.locator('[data-testid="fund-payment-address"]').first();
  await expect(paymentCode).toBeVisible({ timeout: 60_000 });
  const paymentAddress = (await paymentCode.textContent())!.replace(/\s+/g, '');
  console.log(`[warning-block-unisat] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  // ─── 2. Seed a REAL inscribed coin as the ONLY funding candidate ──────
  // seedInscribedCoin inscribes through the regtest ord wallet, sends the
  // inscription-bearing output here, mines, and blocks until the stock ord
  // reports it under /output.inscriptions, so this spec cannot silently run
  // against a clean coin. No clean coin is ever funded, so the dirty coin is
  // the only covering candidate.
  const inscribed = await seedInscribedCoin({
    address: paymentAddress,
    postageSats: INSCRIBED_POSTAGE_SATS,
  });
  const inscribedOutpoint = `${inscribed.txid}:${inscribed.vout}`;
  console.log(`[warning-block-unisat] inscribed coin ${inscribedOutpoint} value=${inscribed.value} id=${inscribed.inscriptionId}`);
  expect(inscribed.value).toBe(INSCRIBED_POSTAGE_SATS);

  // ─── 3. Reload so the orchestrator re-fetches UTXOs and scans ─────────
  const knownPagesBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await approveUnisatConnect(knownPagesBeforeReload, 8_000);
  await page.bringToFront();

  // Pin a fee so the recommendation resolves against a concrete requirement.
  const feeRateInput = page.locator('[data-testid="cat21-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');

  // ─── 4. THE WARNING + BLOCK (picker still COLLAPSED, for the screenshot) ─
  // On a one-address wallet the dirty-only pool is `expert-required`: the SDK
  // returns the block, the component's fundingCta maps it to `warning`, so the
  // warning alert shows and the Mint button is disabled.
  const warningAlert = page.locator('.alert.alert-warning', {
    hasText: /every coin big enough to cover the fee also carries an asset/i,
  }).first();
  await expect(warningAlert).toBeVisible({ timeout: 90_000 });

  const mintButton = page.getByTestId('mint-cat-button');
  await expect(mintButton).toBeVisible({ timeout: 30_000 });
  await expect(mintButton).toBeDisabled();

  // The picker is OFFERED (collapsed): the summary is present without expanding.
  const pickerSummary = page.locator('details > summary', { hasText: /choose a different funding source/i }).first();
  await expect(pickerSummary).toBeVisible({ timeout: 30_000 });

  // THE SCREENSHOT: warning + disabled CTA + picker offer, picker collapsed.
  // Scroll the disabled button into view so the viewport frames it together with
  // the warning above it, then capture the viewport (not fullPage) to honour the
  // "same viewport" requirement.
  await mintButton.scrollIntoViewIfNeeded();
  await expect(warningAlert).toBeInViewport();
  await expect(mintButton).toBeInViewport();
  await shot(page, '01-warning-block-viewport', false);
  await shot(page, '02-warning-block-fullpage', true);

  // ─── 5. UNDER-BLOCK PROOF: nothing was or can be broadcast ────────────
  // The CTA is disabled, so the user cannot proceed; assert no success alert
  // exists (nothing broadcast). A disabled submit button cannot fire, so this is
  // the block holding, not a race.
  await expect(mintButton).toBeDisabled();
  await expect(page.locator('.alert.alert-success')).toHaveCount(0);

  // ─── 6. Prove the blocking coin is genuinely the dirty one ────────────
  // Open the picker and assert the "asset found" badge + the inscription named
  // by id, so the block is a real asset refusal on this coin, not an incidental
  // disable. (This expands the column, which is why the screenshot was taken
  // first, with the picker collapsed.)
  await pickerSummary.click();
  const assetRow = page.locator('.utxo-row-assets').filter({ hasText: inscribedOutpoint }).first();
  await expect(assetRow).toBeVisible({ timeout: 30_000 });
  await expect(assetRow.locator('.badge.bg-danger', { hasText: /asset found/i })).toBeVisible();
  await expect(assetRow.getByRole('button', { name: /use anyway/i })).toBeVisible();
  const detail = assetRow.locator('.utxo-assets-detail');
  await expect(detail).toContainText('Inscription');
  await expect(detail).toContainText(inscribed.inscriptionId);
  await shot(page, '03-picker-open-dirty-proof', true);

  // The button stays disabled with the picker open too: the block is not lifted
  // by merely viewing the coin, only by an explicit "Use anyway" override (not
  // exercised here — the point of this spec is the block).
  await expect(mintButton).toBeDisabled();
});
