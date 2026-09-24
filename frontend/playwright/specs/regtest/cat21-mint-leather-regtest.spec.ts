/* eslint-disable no-console */
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
  onboardLeather,
} from 'ordpool-sdk/e2e';

/**
 * E2E (regtest mint) - ordpool /cat21-mint via Leather.
 *
 * Leather is a NON-NATIVE regtest wallet: mainnet HRP from
 * `getAddresses`, rewritten to `bcrt1…` by the SDK connector's
 * `toRegtestWalletInfo` shim. Sibling of the Xverse/Unisat/Wizz inscribe
 * specs; onboarding + the connect (`get-addresses-approve-button`) and
 * sign (confirm/sign/approve, self-closing popup) choreography lifted
 * from cubes-frontend's proven `leather-cube-mint-roundtrip.spec.ts`.
 * CI-only.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/cat21-mint';

const FUND_AMOUNT_BTC = 0.001;
const FUND_AMOUNT_SATS = Math.round(FUND_AMOUNT_BTC * 1e8);


const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.LEATHER_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/leather');

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21-mint-leather-regtest-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

// Leather's connect approval uses the get-addresses-approve-button testid.
async function approveLeatherConnect(knownPages: Set<Page>, timeoutMs: number): Promise<Page | null> {
  const popup = await waitForApprovalPopup({
    context,
    knownPages,
    timeoutMs,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByTestId('get-addresses-approve-button').waitFor({ state: 'visible', timeout: timeoutMs });
      return true;
    },
  }).catch(() => null);
  if (popup) {
    await popup.getByTestId('get-addresses-approve-button').click();
    await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }
  return popup;
}

// Leather closes its own popup on sign completion; noWaitAfter dodges
// the post-click stability wait racing the teardown.
async function clickLeatherApproval(popup: Page): Promise<void> {
  const btn = popup.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click({ noWaitAfter: true, timeout: 30_000 });
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(
      `Leather extension not unpacked at ${EXT_PATH}. The workflow should ` +
      'have run the SDK\'s playwright-bootstrap.sh leather step.',
    );
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). regtest-bootstrap.sh should have mined past maturity.`);
  }

  const workingDir = path.resolve(RESULTS_DIR, `leather-inscribe-user-data-dir-${process.pid}-${Date.now()}`);
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
  await shot(primer, '00-onboarded');
  await primer.close();
});

test.afterAll(async () => {
  await context?.close();
});

test('cat21 mint round-trip on regtest via the Angular /cat21-mint page + Leather', async () => {
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
  await page.getByTestId('wallet-connect-leather').click({ timeout: 20_000 });
  await shot(page, '02-picker-clicked');
  await approveLeatherConnect(knownPagesBeforeConnect, 60_000);
  await page.bringToFront();

  const paymentCode = page.locator('[data-testid="fund-payment-address"]').first();
  await expect(paymentCode).toBeVisible({ timeout: 60_000 });
  const paymentAddress = (await paymentCode.textContent())!.replace(/\s+/g, '');
  console.log(`[cat21-mint-leather] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddress, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[cat21-mint-leather] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
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
  await approveLeatherConnect(knownPagesBeforeReload, 8_000);
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

  // ─── 6. Click Mint, approve the Leather sign popup ─────────────
  const knownPagesBeforeSign = new Set(context.pages());
  await mintBtn.click();
  const signPopup = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await shot(signPopup, '02-sign-popup');
  await clickLeatherApproval(signPopup);
  await page.bringToFront();

  // ─── 7. Success card → broadcast txid ──────────────────────────
  const successAlert = page.locator('.alert.alert-success').first();
  await expect(successAlert).toBeVisible({ timeout: 120_000 });
  const successHref = await successAlert.locator('a').first().getAttribute('href');
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];
  console.log(`[cat21-mint-leather] mint txid=${broadcastTxid}`);

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
