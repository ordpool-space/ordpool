/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  seedDirtyCoin,
  assertDirtyCoinIsBestFit,
  fundCommonSats,
  getUtxos,
  waitForElectrsSync,
  waitForOrdSync,
  waitForOrdStockSync,
  rpc,
  mineBlocks,
  waitForTxConfirmed,
  waitForApprovalPopup,
} from 'ordpool-sdk/e2e';
import { calculateRecommendedFundingSats } from 'ordpool-sdk';

/**
 * E2E (regtest) — the mint auto-picks a CLEAN coin and the dirty (rare-sat)
 * coin SURVIVES. This is one cell of the dirty-coin protection matrix
 * (mint × {inscription, cat, rune, rareSat}); this file is rareSat.
 *
 * WHY SURVIVAL IS THE MUTATION TARGET HERE (and selection is only confirmation):
 * ordpool's mint gates its button on `hasFundingSource()` = `selectedUtxo ||
 * fundingStatus() === 'auto'`, with NO UI bucket-gate, and `mintCat21()` calls
 * `orchestrator.mint()` with no bucket re-check. So under the funding-safety
 * mutation the dirty coin becomes best-fit, `recommendFunding` returns `auto`,
 * the button ENABLES, the cost renders, and the mint SPENDS the dirty coin — its
 * outpoint is gone. The selection assertions (button enabled, cost shown) pass
 * under the mutation too, so they are green-path CONFIRMATION, not the target.
 * (cat21-indexer's frontend renders its funding row only for a clean-bucket coin,
 * so THERE the mutation never reaches a spend and selection is the target — same
 * flow, opposite target, because of the frontend layer. See the HQ E2E doc.)
 *
 * GREEN PATH (this spec, in CI): seed a CLEAN covering coin WELL above the mint
 * requirement and a dirty rare-sat coin JUST above it (≤ AUTO_SCAN_MAX so it is
 * scanned and bucketed). `assertDirtyCoinIsBestFit` proves the dirty coin is the
 * one an unguarded best-fit would take, so the mutation genuinely exercises the
 * guard. The real ords (:8081 stock `--index-sats`, :8080 cat21-ord) report the
 * rare sat, the guard classifies the dirty coin `assets`, and it auto-selects the
 * clean coin. The mint spends the clean coin; the dirty outpoint SURVIVES.
 *
 * THE MUTATION CHECK (out of band, not in CI — the SDK owns the pinned point):
 * neutralise the clean filter in `ordpool-sdk`'s `funding-safety.ts` line 128,
 * `covering.filter((c) => c.bucket === 'clean')` → `covering.filter(() => true)`.
 * The dirty coin then becomes best-fit and is spent, and the SURVIVAL assertion
 * at the end goes RED. Red count for this cell: 1.
 *
 * No `/output` mock, by necessity: survival is an on-chain property (does the
 * outpoint still exist), and a mocked output has no outpoint to survive. A real
 * rare-sat coin, real ords reporting it, real detection.
 *
 * CI-only (unverified Xverse .crx). See `playwright.regtest.config.ts`.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/cat21-mint';
const TEST_PASSWORD = 'TestPassword123!';

// Placement (see assertDirtyCoinIsBestFit): the dirty coin is sized JUST above
// the MEASURED mint requirement (requirement + DIRTY_MARGIN_SATS), never a round
// number. "Just above" is what makes it the smallest covering coin in almost any
// pool: this spec shares the seeded Xverse payment address with the base mint
// spec, which leaves ~13k-30k covering coins on it, and a dirty coin sized at
// requirement-plus-a-little (~a few thousand) lands well under those, so it is
// the smallest covering candidate without any address isolation. The margin has
// a FLOOR — the requirement itself — so this is not a race to the bottom; if a
// foreign leftover ever lands below the requirement, assertDirtyCoinIsBestFit
// says so at setup and the answer then is a distinct address, not a smaller coin.
// The clean coin is WELL above and larger than the dirty coin. Across the matrix
// the margins STRICTLY DECREASE so a coin surviving from an earlier cell (same
// vault → same address → same chain) can never be the best-fit for a later cell.
const DIRTY_MARGIN_SATS = 2_000;
const CLEAN_FUND_BTC = 0.001; // 100_000 sat, well above the mint requirement and > the dirty coin

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
    path: path.resolve(RESULTS_DIR, `mint-dirty-raresat-${name}.png`),
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

  const workingDir = `${SEED_USER_DATA_DIR}.mint-dirty-raresat-${process.pid}-${Date.now()}`;
  fs.cpSync(SEED_USER_DATA_DIR, workingDir, { recursive: true });
  for (const stale of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    fs.rmSync(path.join(workingDir, stale), { force: true });
  }

  // No /output mock: the funding scan hits the real local ords (stock :8081 for
  // inscriptions/runes/sat_ranges, cat21-ord :8080 for cats) that the workflow
  // wired into environment.ts. A mock would defeat the survival proof — there is
  // no real outpoint behind a mocked coin.
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

test('mint auto-picks the clean coin; the rare-sat coin survives', async () => {
  test.setTimeout(360_000);

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
  console.log(`[mint-dirty-raresat] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1q/);

  // ─── 3. Measure the mint's funding requirement (do not guess) ──────
  // assertDirtyCoinIsBestFit needs the real requirement to know which placement
  // trap it is in; a guessed number silently moves the trap.
  const requirementSats = calculateRecommendedFundingSats(1);
  const dirtyValueSats = requirementSats + DIRTY_MARGIN_SATS;
  console.log(`[mint-dirty-raresat] requirement at 1 sat/vB = ${requirementSats} sat; dirty = ${dirtyValueSats} sat`);
  expect(dirtyValueSats).toBeGreaterThan(requirementSats); // covers
  expect(dirtyValueSats).toBeLessThanOrEqual(50_000);      // scanned, not left unscanned/scanning

  // ─── 4. Seed a CLEAN covering coin, then the dirty rare-sat coin ──
  // Clean first (fundCommonSats routes the coinbase's leading uncommon sat into
  // the change output, so the payment output is common — a real clean coin, not
  // an accidental rare sat). Then the dirty coin. Both land on the payment
  // address; both helpers mine and wait for electrs + both ords to index.
  await fundCommonSats(paymentAddress, CLEAN_FUND_BTC);
  const dirty = await seedDirtyCoin({ asset: 'rareSat', address: paymentAddress, valueSats: dirtyValueSats });
  console.log(`[mint-dirty-raresat] dirty rare-sat coin ${dirty.outpoint} value=${dirty.value}`);
  expect(dirty.value).toBe(dirtyValueSats);

  const tip = mineBlocks(1);
  await waitForElectrsSync(tip);
  await waitForOrdStockSync(tip);
  await waitForOrdSync(tip);

  // ─── 5. Placement guard: the dirty coin is the best-fit an unguarded ──
  // selection would take. Throws (naming the trap) if the dirty coin is not in
  // the pool, does not cover, is not the smallest covering coin, or there is no
  // clean alternative — any of which would make the mutation prove nothing.
  const pool = (await getUtxos(paymentAddress)).map((u) => ({ txid: u.txid, vout: u.vout, value: u.value }));
  console.log(`[mint-dirty-raresat] pool = ${JSON.stringify(pool)}`);
  assertDirtyCoinIsBestFit(pool, dirty.outpoint, requirementSats);

  // ─── 6. Reload so the orchestrator re-fetches UTXOs and scans ─────
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
  await shot(page, '01-after-seed-reload');

  // ─── 7. GREEN-PATH CONFIRMATION (not the mutation target): the mint ──
  // auto-picks the clean coin, so the button enables without a picker choice.
  const feeRateInput = page.locator('[data-testid="cat21-fee-rate"]').first();
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  const mintButton = page.getByTestId('mint-cat-button');
  await expect(mintButton).toBeEnabled({ timeout: 60_000 });
  await shot(page, '02-ready-to-mint');

  // ─── 8. Mint, approve the Xverse sign popup ──────────────────────
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
  await shot(approvalSign, '03-sign-approval');
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
      .click({ force: true }).catch(() => undefined);
    const closed = new Promise<void>((res) => approvalSign.once('close', () => res()));
    await Promise.race([
      closed,
      expect(approvalSign.getByRole('button', { name: /^confirm$/i }).first()).toBeHidden({ timeout: 30_000 }),
    ]).catch(() => undefined);
    if (approvalSign.isClosed()) break;
  }

  // ─── 9. Wait for success, extract the broadcast txid, confirm it ─
  const successAlert = page.locator('.alert.alert-success').first();
  await expect(successAlert).toBeVisible({ timeout: 90_000 });
  await shot(page, '04-success');
  const successHref = await successAlert.locator('a').first().getAttribute('href');
  const broadcastTxid = successHref?.match(/\/tx\/([0-9a-f]{64})/)?.[1];
  expect(broadcastTxid).toBeTruthy();
  console.log(`[mint-dirty-raresat] mint txid = ${broadcastTxid}`);

  const confirmedTip = mineBlocks(1);
  await waitForElectrsSync(confirmedTip);
  const mintTx = await waitForTxConfirmed(broadcastTxid!);
  expect(mintTx.locktime).toBe(21);

  // ─── 10. THE MUTATION TARGET — the rare-sat coin SURVIVED ─────────
  // The mint spent the CLEAN coin (the guard steered auto-funding away from the
  // asset), so the dirty outpoint is still unspent on-chain. Under the
  // clean-filter mutation the dirty coin would have been best-fit and spent, and
  // this assertion would go RED (red count: 1).
  const survivors = await getUtxos(paymentAddress);
  const dirtySurvives = survivors.some((u) => u.txid === dirty.txid && u.vout === dirty.vout);
  console.log(`[mint-dirty-raresat] dirty ${dirty.outpoint} survives=${dirtySurvives}`);
  expect(dirtySurvives).toBe(true);

  // And the mint did NOT spend the dirty coin as a fee: the confirmed mint tx
  // has no input referencing the dirty outpoint. (Belt-and-braces over the UTXO
  // check: proves the survival is because the guard avoided it, not because a
  // later tx happened to re-create it.)
  const mintVins = mintTx.vin as Array<{ txid: string; vout: number }>;
  const spentDirty = mintVins.some((v) => v.txid === dirty.txid && v.vout === dirty.vout);
  expect(spentDirty).toBe(false);
});
