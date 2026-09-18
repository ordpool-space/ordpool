/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  seedInscribedCoin,
  rpc,
  waitForApprovalPopup,
} from 'ordpool-sdk/e2e';

/**
 * E2E (regtest) — the SEPARATE-ADDRESS NOTICE cell: the funding-safety guard
 * NAMES an inscribed coin and PROCEEDS with a notice.
 *
 * Xverse keeps a separate payment address, so a dirty-only funding pool is
 * `asset-notice`, not a block: the SDK does not refuse the coin, it steers the
 * user with a notice and leaves them in charge. The one-address BLOCK (the same
 * coin risk on a wallet that keeps ONE address for everything, where the CTA is
 * DISABLED) is the mirror of this spec and is proven in
 * `funding-guard-warning-block-unisat-regtest.spec.ts`. Neither spec asserts the
 * other's button state.
 *
 * This is the proof the rest of the mint/inscribe suite could not give. Those
 * specs fund a plain payment coin and let the scan classify it clean, which
 * exercises the scan but never asks the guard the one question that matters:
 * when the only coin that can pay for a mint carries an inscription, is the user
 * told what it holds before spending it?
 *
 * Here the ONLY funding candidate on the wallet's payment address is a real
 * inscription-bearing UTXO, seeded through the regtest ord wallet by the SDK's
 * `seedInscribedCoin` fixture at 2,000,000 sat (large enough to be a covering
 * candidate — at 546 the scan would never consider it and the guard would never
 * be asked). The stock ord (:8081) reports it under `inscriptions`, cat21-ord
 * (:8080) reports its cats; the scan reads both. On a separate-address wallet the
 * coin lands in `asset-notice`, so the spec asserts BOTH halves of that state:
 *   - the NOTICE alert is shown and NAMES the inscription by id, and the Mint
 *     button stays ENABLED (notice-and-proceed, the user is informed not blocked),
 *   - the picker flags the coin: the "asset found" danger badge, a "Use anyway"
 *     override in place of "Use this UTXO", and the asset detail naming the real
 *     inscription by id.
 * The proof that isolates the INSCRIPTION half is the inscription id, which is
 * populated only from the stock ord's `inscriptions` field.
 *
 * THE MUTATION CHECK (run on a throwaway branch, not in CI): point `ordBaseUrls`
 * at :8080 instead of :8081. cat21-ord has no `inscriptions` field, so the
 * inscription becomes invisible and the "Inscription: <id>" line never renders,
 * turning the `toContainText(inscriptionId)` assertions RED. The generic "asset
 * found" badge and "Use anyway" override do NOT flip, because this coin also
 * carries a rare sat and both ords run --index-sats, which is exactly why the
 * inscription-id assertions, not the badge, are the load-bearing proof. A guard
 * spec that passed under both wirings would not be reading the inscription
 * verdict. Verified: at :8081 GREEN, at :8080 RED on the inscription-id lines.
 * No mock: a real inscribed coin, real stock ord reporting it, real detection.
 *
 * CI-only (unverified Xverse .crx). See `playwright.regtest.config.ts`.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/cat21-mint';
const TEST_PASSWORD = 'TestPassword123!';

// Big enough to be a covering candidate for a mint, so the funding-safety
// scan actually considers it and the guard is genuinely asked. This is the
// SDK fixture's default; named here for the assertion's sake.
const INSCRIBED_POSTAGE_SATS = 2_000_000;

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.XVERSE_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/xverse');
const SEED_USER_DATA_DIR =
  process.env.XVERSE_SEED_USER_DATA_DIR
  ?? path.resolve(__dirname, '../../../test-results/xverse-seed-user-data-dir');
const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `funding-guard-refusal-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`Xverse extension not unpacked at ${EXT_PATH}.`);
  }
  if (!fs.existsSync(path.join(SEED_USER_DATA_DIR, 'Default'))) {
    throw new Error(`Xverse seed user-data-dir missing at ${SEED_USER_DATA_DIR}.`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). regtest-bootstrap.sh should have mined past maturity.`);
  }

  const workingDir = `${SEED_USER_DATA_DIR}.guard-refusal-${process.pid}-${Date.now()}`;
  fs.cpSync(SEED_USER_DATA_DIR, workingDir, { recursive: true });
  for (const stale of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    fs.rmSync(path.join(workingDir, stale), { force: true });
  }

  // No /output mock. The scan hits the real local ords (stock :8081 for
  // inscriptions, cat21-ord :8080 for cats) that the workflow wired into
  // environment.ts — which is the whole point of this spec.
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
});

test.afterAll(async () => {
  await context?.close();
});

test('separate-address wallet: the guard names an inscribed coin and proceeds with a notice (real ord, no mock)', async () => {
  test.setTimeout(300_000);

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
      return t.includes('account 1') || t.includes('not now') || t.includes('send');
    }, undefined, { timeout: 30_000, polling: 250 });
  }
  const notNow = primer.getByText('Not now', { exact: true }).first();
  if (await notNow.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await notNow.click({ force: true }).catch(() => undefined);
  }
  await primer.close();

  // ─── 2. Open /cat21-mint, connect Xverse, read the payment address ─
  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const connectTrigger = page.getByTestId('connect-wallet-trigger').first();
  await expect(connectTrigger).toBeVisible({ timeout: 30_000 });

  const knownPagesBeforeConnect = new Set(context.pages());
  await connectTrigger.click();
  await page.getByTestId('wallet-connect-xverse').click({ timeout: 20_000 });

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
  await approvalConnect.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
    .first().click();
  await approvalConnect.close().catch(() => undefined);

  const paymentCode = page.locator('[data-testid="fund-payment-address"]').first();
  await expect(paymentCode).toBeVisible({ timeout: 60_000 });
  const paymentAddress = (await paymentCode.textContent())!.replace(/\s+/g, '');
  console.log(`[guard-refusal] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1q/);

  // ─── 3. Seed a REAL inscribed coin as the ONLY funding candidate ──
  // seedInscribedCoin inscribes through the regtest ord wallet, sends the
  // inscription-bearing output to this payment address, mines, and waits
  // until the stock ord reports it under /output.inscriptions before
  // returning. It refuses to return a coin the stock ord does not actually
  // report as inscribed, so this spec cannot silently run against a clean
  // coin. Container names are overridden to the consumer-environment's in
  // the workflow env (REGTEST_ORD_STOCK_CONTAINER etc.).
  const inscribed = await seedInscribedCoin({
    address: paymentAddress,
    postageSats: INSCRIBED_POSTAGE_SATS,
  });
  const inscribedOutpoint = `${inscribed.txid}:${inscribed.vout}`;
  console.log(`[guard-refusal] inscribed coin ${inscribedOutpoint} value=${inscribed.value} id=${inscribed.inscriptionId}`);
  expect(inscribed.value).toBe(INSCRIBED_POSTAGE_SATS);

  // ─── 4. Reload so the orchestrator re-fetches UTXOs and scans ─────
  const knownPagesBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeReload,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
      .first().click().catch(() => undefined);
    await reapprove.close().catch(() => undefined);
  }
  await page.bringToFront();
  await shot(page, '01-after-seed-reload');

  // ─── 5a. THE NOTICE: asset-notice on a separate-address wallet ───
  // The inscribed coin is the only covering candidate. On Xverse (separate
  // payment address) that is asset-notice, not a block: the notice NAMES what
  // the coin carries and the Mint button stays ENABLED, so the user is informed
  // and stays in charge (the one-address BLOCK is the unisat mirror spec). Pin a
  // fee first so the form is valid and the button's only remaining gate is the
  // funding decision.
  const feeRateInput = page.locator('[data-testid="cat21-fee-rate"]').first();
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');

  const noticeAlert = page.locator('.alert.alert-warning', {
    hasText: /we'll fund this mint from a coin that carries an asset/i,
  }).first();
  await expect(noticeAlert).toBeVisible({ timeout: 90_000 });
  // The notice must NAME the inscription (a notice that doesn't say what the coin
  // carries is not a notice). This is the same load-bearing inscription-id proof
  // as the picker detail below, and the same line the :8080 mutation turns red.
  await expect(noticeAlert).toContainText(inscribed.inscriptionId);

  const mintButton = page.getByTestId('mint-cat-button');
  await expect(mintButton).toBeVisible({ timeout: 30_000 });
  await expect(mintButton).toBeEnabled();
  await shot(page, '01b-notice-enabled');

  // ─── 5b. THE PICKER flags the coin ───────────────────────────────
  // Open the funding-source picker so its rows (and the badge) are in the DOM.
  const pickerSummary = page.locator('details > summary', { hasText: /choose a different funding source/i }).first();
  if (await pickerSummary.isVisible({ timeout: 30_000 }).catch(() => false)) {
    await pickerSummary.click();
    await shot(page, '02-picker-open');
  }

  // Necessary but NOT sufficient: the coin is flagged unsafe (the "asset found"
  // danger badge, the row offers "Use anyway" not "Use this UTXO"). These fire
  // for ANY asset and persist at :8080, because this 2M coin also carries a rare
  // sat and both ords run --index-sats. They show the guard flags the coin; they
  // do not, alone, prove the inscription half. The inscription-specific proof is
  // the detail assertion further down.
  const assetBadge = page.locator('.badge.bg-danger', { hasText: /asset found/i }).first();
  await expect(assetBadge).toBeVisible({ timeout: 60_000 });
  await shot(page, '03-asset-found');

  const assetRow = page.locator('.utxo-row-assets').filter({ hasText: inscribedOutpoint }).first();
  await expect(assetRow).toBeVisible();
  await expect(assetRow.getByRole('button', { name: /use anyway/i })).toBeVisible();
  await expect(assetRow.getByRole('button', { name: /^use this utxo$/i })).toHaveCount(0);

  // THE inscription-specific proof, and the only assertion the mutation check
  // turns red. The asset detail names the REAL inscription by id (the template
  // renders "Inscription: <id>" from scan.content.inscriptionIds, which is
  // populated ONLY from the stock ord's inscriptions field). Under the :8080
  // mutation (ordBaseUrls -> cat21-ord, which has no inscriptions field)
  // inscriptionIds is empty, the "Inscription" line never renders, and this
  // flips RED. That isolates the inscription guard from the coin's incidental
  // rare sat: both ords run --index-sats, so the generic "asset found" badge
  // and the "Use anyway" override above persist even at :8080 and cannot, on
  // their own, prove the inscription half of the guard.
  const detail = assetRow.locator('.utxo-assets-detail');
  await expect(detail).toContainText('Inscription');
  await expect(detail).toContainText(inscribed.inscriptionId);
  await shot(page, '04-inscription-named');

  // On a separate-address wallet the guard is notice-and-proceed, not a block:
  // it names the coin and steers auto-funding, but leaves the Mint button enabled
  // (asserted above), so the user stays in charge and may consciously override
  // with "Use anyway". The block — same coin risk, CTA disabled — is the
  // one-address mirror in funding-guard-warning-block-unisat-regtest.spec.ts.
});
