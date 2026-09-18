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
  DirtyCoinAsset,
  SeededDirtyCoin,
} from 'ordpool-sdk/e2e';
import { calculateRecommendedFundingSats } from 'ordpool-sdk';

/**
 * E2E (regtest) — dirty-coin protection matrix for the MINT flow, all four asset
 * classes (rare sat, rune, cat, inscription). Each cell seeds a CLEAN covering
 * coin plus one dirty coin, mints, and asserts the dirty coin SURVIVES.
 *
 * SURVIVAL IS THE MUTATION TARGET for ordpool's mint (Scenario A: a clean coin
 * covers, so topology is never consulted and the target is survival on either
 * wallet). The mint gates only on hasFundingSource (no UI bucket-gate) and
 * mintCat21 calls orchestrator.mint() with no re-check, so under the SDK
 * clean-filter mutation the dirty coin becomes best-fit and is spent — each
 * cell's survival assertion goes RED. Selection (button enabled, cost shown) is
 * green-path CONFIRMATION, not the target. Proven on the standalone rare-sat cell
 * (green: survives=true; mutation at funding-safety.ts:50 -> survives=false at the
 * survival assertion, one own-assertion red).
 *
 * SIZING: the dirty coin is seeded JUST above the MEASURED mint requirement
 * (requirement + a per-cell margin), never a round number, so it is the smallest
 * covering coin in the pool the spec actually runs against — which shares the
 * seeded Xverse address with the base mint spec and its ~13k-30k leftovers.
 * assertDirtyCoinIsBestFit proves that at setup and throws (naming the trap) if a
 * leftover ever undercuts it.
 *
 * ACCUMULATION: Scenario A does NOT spend the dirty coin, so every cell's coin
 * SURVIVES into the next cell's pool. The margins STRICTLY DECREASE across cells
 * (by more than the noise) so each cell's coin is the global smallest covering and
 * there are no ties — a tie would let best-fit take an EARLIER cell's coin under
 * the mutation, spending a different asset while this cell's survival assertion
 * passes (an invisible burn). To catch that anyway, every cell asserts not only
 * ITS coin survives but that EVERY previously-seeded dirty coin still survives.
 *
 * No serial mode: the config is already workers:1 + fullyParallel:false, so tests
 * run sequentially and share module state; adding `serial` would only hide reds
 * behind skips when the mutation is run. No /output mock: survival is on-chain, and
 * the real ords (:8081 --index-sats --index-runes, :8080 cat21-ord) report the
 * seeded assets.
 *
 * CI-only (unverified Xverse .crx). See `playwright.regtest.config.ts`.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/cat21-mint';
const TEST_PASSWORD = 'TestPassword123!';

const CLEAN_FUND_BTC = 0.001; // 100_000 sat, well above the mint requirement and > every dirty coin

// Per-cell margins ABOVE the measured requirement, STRICTLY DECREASING by 500 sat
// (well over the noise) so each cell's dirty coin is the global smallest covering
// and no two ever tie. All land far under the base spec's ~13k-30k leftovers.
const CELLS: { asset: DirtyCoinAsset; marginSats: number; label: string }[] = [
  { asset: 'rareSat', marginSats: 2_000, label: 'rare sat' },
  { asset: 'rune', marginSats: 1_500, label: 'rune' },
  { asset: 'cat', marginSats: 1_000, label: 'cat' },
  { asset: 'inscription', marginSats: 500, label: 'inscription' },
];

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.XVERSE_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/xverse');
const SEED_USER_DATA_DIR =
  process.env.XVERSE_SEED_USER_DATA_DIR
  ?? path.resolve(__dirname, '../../../test-results/xverse-seed-user-data-dir');
const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;
let page: Page;
let paymentAddress: string;
// Every dirty coin seeded so far, so each cell can assert none of them was spent.
const seededDirty: SeededDirtyCoin[] = [];

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `mint-dirty-matrix-${name}.png`),
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
    throw new Error(`regtest tip is ${tip} (<101). bootstrap should have mined past maturity.`);
  }

  const workingDir = `${SEED_USER_DATA_DIR}.mint-dirty-matrix-${process.pid}-${Date.now()}`;
  fs.cpSync(SEED_USER_DATA_DIR, workingDir, { recursive: true });
  for (const stale of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    fs.rmSync(path.join(workingDir, stale), { force: true });
  }

  // No /output mock: real ords report the seeded assets (survival needs a real coin).
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

  // ─── Unlock the vault ──────────────────────────────────────────
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

  // ─── Open /cat21-mint, connect Xverse, read the payment address ─
  page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const connectTrigger = page.getByTestId('connect-wallet-trigger').first();
  await expect(connectTrigger).toBeVisible({ timeout: 30_000 });
  const knownBeforeConnect = new Set(context.pages());
  await connectTrigger.click();
  await page.getByTestId('wallet-connect-xverse').click({ timeout: 20_000 });
  const approvalConnect = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeConnect,
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
  paymentAddress = (await paymentCode.textContent())!.replace(/\s+/g, '');
  expect(paymentAddress).toMatch(/^bcrt1q/);
  console.log(`[mint-dirty-matrix] payment=${paymentAddress}`);
});

test.afterAll(async () => {
  await context?.close();
});

/**
 * One matrix cell: seed a clean covering coin + one dirty coin sized just above
 * the requirement, prove placement, mint (auto-picks clean), assert this coin AND
 * every earlier dirty coin survive.
 */
async function runDirtyCoinCell(asset: DirtyCoinAsset, marginSats: number, label: string): Promise<void> {
  // Measure the requirement PER CELL, not once for the matrix: if a cell's fee
  // rate or pool shape ever changed the no-change vsize, a rung reused from the
  // first cell could fall under this cell's real requirement and selection would
  // reach past the dirty coin. It is one pure call and it keeps the ladder honest.
  const requirementSats = calculateRecommendedFundingSats(1);
  const dirtyValueSats = requirementSats + marginSats;
  expect(dirtyValueSats).toBeGreaterThan(requirementSats);
  expect(dirtyValueSats).toBeLessThanOrEqual(50_000);

  // Clean coin first (fundCommonSats routes the coinbase's uncommon sat to change,
  // so the payment output is genuinely common), then the dirty coin. Both land on
  // the payment address; both helpers mine and wait for electrs + both ords.
  await fundCommonSats(paymentAddress, CLEAN_FUND_BTC);
  const dirty = await seedDirtyCoin({ asset, address: paymentAddress, valueSats: dirtyValueSats });
  expect(dirty.value).toBe(dirtyValueSats);
  console.log(`[mint-dirty-matrix] ${label}: dirty ${dirty.outpoint} value=${dirty.value}`);

  const tip = mineBlocks(1);
  await waitForElectrsSync(tip);
  await waitForOrdStockSync(tip);
  await waitForOrdSync(tip);

  // Placement guard: this dirty coin is the best-fit an unguarded selection takes.
  const pool = (await getUtxos(paymentAddress)).map((u) => ({ txid: u.txid, vout: u.vout, value: u.value }));
  assertDirtyCoinIsBestFit(pool, dirty.outpoint, requirementSats);
  seededDirty.push(dirty);

  // Reload so the orchestrator re-fetches + scans (re-approve if Xverse asks).
  const knownBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeReload,
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
    await reapprove.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i }).first().click();
    await reapprove.close().catch(() => undefined);
  }
  await shot(page, `${asset}-01-after-seed`);

  // Green-path confirmation (not the mutation target): the mint auto-picks the
  // clean coin, so the button enables without a picker choice.
  const feeRateInput = page.locator('[data-testid="cat21-fee-rate"]').first();
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  const mintButton = page.getByTestId('mint-cat-button');
  await expect(mintButton).toBeEnabled({ timeout: 60_000 });

  // Mint + approve the Xverse sign popup.
  const knownBeforeSign = new Set(context.pages());
  await mintButton.click();
  const approvalSign = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByText(/review transaction/i).first().waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
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
    await approvalSign.getByRole('button', { name: /^confirm$/i }).first().click({ force: true }).catch(() => undefined);
    const closed = new Promise<void>((res) => approvalSign.once('close', () => res()));
    await Promise.race([
      closed,
      expect(approvalSign.getByRole('button', { name: /^confirm$/i }).first()).toBeHidden({ timeout: 30_000 }),
    ]).catch(() => undefined);
    if (approvalSign.isClosed()) break;
  }

  const successAlert = page.locator('.alert.alert-success').first();
  await expect(successAlert).toBeVisible({ timeout: 90_000 });
  const successHref = await successAlert.locator('a').first().getAttribute('href');
  const broadcastTxid = successHref?.match(/\/tx\/([0-9a-f]{64})/)?.[1];
  expect(broadcastTxid).toBeTruthy();

  const confirmedTip = mineBlocks(1);
  await waitForElectrsSync(confirmedTip);
  const mintTx = await waitForTxConfirmed(broadcastTxid!);
  expect(mintTx.locktime).toBe(21);
  await shot(page, `${asset}-02-minted`);

  // THE MUTATION TARGET — the dirty coins survive. The mint spent the clean coin,
  // so this cell's coin AND every earlier cell's coin are still unspent.
  const survivors = await getUtxos(paymentAddress);
  const mintVins = mintTx.vin as Array<{ txid: string; vout: number }>;
  const alive = (d: SeededDirtyCoin) => survivors.some((u) => u.txid === d.txid && u.vout === d.vout);
  const notSpentBy = (d: SeededDirtyCoin) => !mintVins.some((v) => v.txid === d.txid && v.vout === d.vout);

  // OWN coin FIRST. Under the clean-filter mutation, best-fit spends the smallest
  // covering coin, which by the strictly-decreasing sizing is THIS cell's coin, so
  // the cell reds on its OWN survival assertion and the prior checks below never
  // run — one own-assertion red per cell, zero consequence reds. A consequence red
  // would mean a ladder collision (two sizes tied, a rung under its requirement, a
  // stray leftover between rungs), not this cell's class.
  console.log(`[mint-dirty-matrix] after ${label} mint: own ${asset} ${dirty.outpoint} survives=${alive(dirty)}`);
  expect(alive(dirty), `own dirty ${asset} coin ${dirty.outpoint} must survive its own mint`).toBe(true);
  expect(notSpentBy(dirty), `${label} mint must not spend its own dirty coin as a fee`).toBe(true);

  // Then every EARLIER coin. In the GREEN run a failure here is a real cross-cell
  // burn (an earlier cell's asset spent by this mint) — a ladder bug this catches
  // and names. Under the mutation the own assertion above has already failed, so
  // these do not run, keeping the red count clean.
  for (const d of seededDirty) {
    if (d.outpoint === dirty.outpoint) continue;
    console.log(`[mint-dirty-matrix] after ${label} mint: prior ${d.asset} ${d.outpoint} survives=${alive(d)}`);
    expect(alive(d), `earlier dirty ${d.asset} coin ${d.outpoint} must still survive the ${label} mint`).toBe(true);
    expect(notSpentBy(d), `${label} mint must not spend the earlier ${d.asset} coin as a fee`).toBe(true);
  }
}

for (const cell of CELLS) {
  test(`mint auto-picks clean; the ${cell.label} coin (and all prior) survive`, async () => {
    test.setTimeout(360_000);
    await runDirtyCoinCell(cell.asset, cell.marginSats, cell.label);
  });
}
