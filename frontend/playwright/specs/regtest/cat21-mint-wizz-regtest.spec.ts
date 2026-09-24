/* eslint-disable no-console */
// Runs LAST in the workflow, after inscribe-wizz. The two wizz specs contend
// when adjacent (a wizz sign popup intermittently stalls past the 60s Sign-wait
// if another wizz context ran just before), so the matrix separates them: this
// one runs after every other spec, with the config's retries:1 covering a
// residual stall. Proven mock-free against the real ords; the unisat cat21-mint
// spec is the template.
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { Cat21ParserService, DigitalArtifactType } from 'ordpool-parser';

import {
  waitForUtxoAt,
  waitForElectrsSync,
  waitForOrdSync,
  waitForOrdStockSync,
  waitForTxConfirmed,
  rpc,
  mineBlocks,
  waitForApprovalPopup,
  installWizzOfflineRoutes,
  onboardWizz,
} from 'ordpool-sdk/e2e';

/**
 * E2E (regtest inscribe) - ordpool /inscribe via Wizz.
 *
 * Wizz is a NON-NATIVE regtest wallet (Unisat-family): mainnet HRP from
 * `getAddresses`, rewritten to `bcrt1…` by the SDK connector's
 * `toRegtestWalletInfo` shim. Proves the page-driven flow works through
 * a second non-native wallet. Sibling of the Xverse/Unisat inscribe
 * specs; onboarding + sign choreography lifted from cubes-frontend's
 * proven `wizz-cube-mint-roundtrip.spec.ts`. CI-only.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/cat21-mint';

const FUND_AMOUNT_BTC = 0.001;
const FUND_AMOUNT_SATS = Math.round(FUND_AMOUNT_BTC * 1e8);


const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.WIZZ_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/wizz');

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21-mint-wizz-regtest-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

// Wizz inherits Unisat's connect-approval: a styled "Connect" div at
// notification.html#/approval.
async function approveWizzConnect(knownPages: Set<Page>, timeoutMs: number): Promise<Page | null> {
  const approval = await waitForApprovalPopup({
    context,
    knownPages,
    timeoutMs,
    isApproval: async (p) => {
      await p.waitForURL(/notification\.html#\/approval/, { timeout: timeoutMs });
      return true;
    },
  }).catch(() => null);
  if (approval) {
    await approval.getByText(/^Connect$/).first().click();
    await approval.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }
  return approval;
}

// Sign button carries a spinner overlay + braille chars in textContent
// while Wizz analyses the PSBT - atomically match + click inside
// page.evaluate to sidestep the pointer-events race.
async function approveWizzSign(knownPages: Set<Page>): Promise<void> {
  const approval = await waitForApprovalPopup({
    context,
    knownPages,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      await p.waitForURL(/notification\.html#\/approval/, { timeout: 120_000 });
      return true;
    },
  });
  await shot(approval, '05-sign-popup');
  await approval.waitForFunction(() => {
    const isSignButton = (el: Element) => {
      const text = (el.textContent || '').trim();
      return /^\s*[⠀-⣿•●]?\s*Sign\s*$/i.test(text);
    };
    const els = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], div'));
    const candidate = els.find(isSignButton);
    if (!candidate) return null;
    const style = getComputedStyle(candidate);
    if (style.pointerEvents === 'none') return null;
    if (parseFloat(style.opacity) < 0.7) return null;
    candidate.click();
    return { text: candidate.textContent };
  }, undefined, { timeout: 60_000, polling: 250 });
  console.log('[cat21-mint-wizz] clicked sign button (popup may have closed)');
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(
      `Wizz extension not unpacked at ${EXT_PATH}. The workflow should ` +
      'have run the SDK\'s playwright-bootstrap.sh wizz step.',
    );
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). regtest-bootstrap.sh should have mined past maturity.`);
  }

  const workingDir = path.resolve(RESULTS_DIR, `wizz-inscribe-user-data-dir-${process.pid}-${Date.now()}`);
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
  // Hermetic Wizz: stub the wallet's third-party balance/asset backends
  // (ep.wizz.cash / ordx.wizz.cash / wallet-api.unisat.io / api.rgbpp.io)
  // so the sign popup can enable Sign without Wizz server uptime — the
  // same canonical helper the SDK + cubes wizz specs use. Without it the
  // popup shows "Failed to load balance" and Sign stays disabled.
  await installWizzOfflineRoutes(context);

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  extensionId = worker.url().split('/')[2];

  const primer = await context.newPage();
  await onboardWizz(primer, extensionId, { password: 'correct-horse-battery-staple-Tr0ub4dor-9876' });
  await shot(primer, '00-onboarded');
  await primer.close();
});

test.afterAll(async () => {
  await context?.close();
});

test('cat21 mint round-trip on regtest via the Angular /cat21-mint page + Wizz', async () => {
  test.setTimeout(420_000);

  const page = await context.newPage();
  // No /output mock. The funding-safety scan probes the REAL local ords the
  // workflow wired into environment.ts: stock ord (:8081) for inscriptions/
  // runes/sat_ranges and cat21-ord (:8080) for cats. A clean regtest payment
  // coin returns empty from both, so it classifies usable for real. The sync
  // waits after funding ensure both ords have indexed the funding block first.
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, '01-page-loaded');

  const connectTrigger = page.getByTestId('connect-wallet-trigger').first();
  await expect(connectTrigger).toBeVisible({ timeout: 30_000 });

  const knownPagesBeforeConnect = new Set(context.pages());
  await connectTrigger.click();
  await page.getByTestId('wallet-connect-wizz').click({ timeout: 20_000 });
  await shot(page, '02-picker-clicked');
  await approveWizzConnect(knownPagesBeforeConnect, 60_000);
  await page.bringToFront();

  const paymentCode = page.locator('[data-testid="fund-payment-address"]').first();
  await expect(paymentCode).toBeVisible({ timeout: 60_000 });
  const paymentAddress = (await paymentCode.textContent())!.replace(/\s+/g, '');
  console.log(`[cat21-mint-wizz] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddress, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[cat21-mint-wizz] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
  const fundedTip = mineBlocks(1);
  await waitForElectrsSync(fundedTip);
  // Poll the address→utxo index until the funding UTXO is visible.
  // waitForElectrsSync only confirms the block HEIGHT; electrs indexes
  // the address→utxo mapping a tick later, so an immediate getUtxos can
  // miss the fresh output (observed flaking here across wallets).
  await waitForUtxoAt(paymentAddress, FUND_AMOUNT_SATS);

  // Both ords must have indexed the funding block before the funding-safety
  // scan reads /output/<outpoint>. Stock ord (:8081) answers the inscription/
  // rune half, cat21-ord (:8080) the cat half. Real endpoints, real empty
  // result for a clean coin.
  await waitForOrdStockSync(fundedTip);
  await waitForOrdSync(fundedTip);

  const knownPagesBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await approveWizzConnect(knownPagesBeforeReload, 8_000);
  await page.bringToFront();
  await shot(page, '03-reloaded');

  // ─── 5. Pin the fee, wait for the Mint button ──────────────────
  // The large (>50k) funding coin is auto-picked by the orchestrator's
  // fundingRecommendation, so Mint enables without a manual pick.
  const feeRateInput = page.locator('[data-testid="cat21-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  const mintBtn = page.getByTestId('mint-cat-button');
  await expect(mintBtn).toBeEnabled({ timeout: 60_000 });
  await shot(page, '01-ready-to-mint');

  // ─── 6. Click Mint, approve the Wizz sign popup ────────────────
  const knownPagesBeforeSign = new Set(context.pages());
  await mintBtn.click();
  await approveWizzSign(knownPagesBeforeSign);
  await page.bringToFront();

  // ─── 7. Success card → broadcast txid ──────────────────────────
  const successAlert = page.locator('.alert.alert-success').first();
  await expect(successAlert).toBeVisible({ timeout: 120_000 });
  const successHref = await successAlert.locator('a').first().getAttribute('href');
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];
  console.log(`[cat21-mint-wizz] mint txid=${broadcastTxid}`);

  // ─── 8. Mine, confirm, assert a well-formed CAT-21 on-chain ────
  await waitForElectrsSync(mineBlocks(1));
  const esploraTx = await waitForTxConfirmed(broadcastTxid);
  expect(esploraTx.locktime).toBe(21);
  expect(esploraTx.status.block_hash).toBeTruthy();
  expect(esploraTx.vin.length).toBeGreaterThan(0);
  for (const vin of esploraTx.vin) {
    expect(vin.sequence).toBeGreaterThanOrEqual(0xfffffffe);
  }
  expect(esploraTx.vout.length).toBeGreaterThanOrEqual(1);
  expect(esploraTx.vout[0].value).toBe(546);
  const parsed = Cat21ParserService.parse(esploraTx);
  expect(parsed).not.toBeNull();
  expect(parsed!.type).toBe(DigitalArtifactType.Cat21);
  expect(parsed!.transactionId).toBe(broadcastTxid);
  expect(parsed!.getImage()).toMatch(/^<svg/);
});
