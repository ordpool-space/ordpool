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
  onboardUnisat,
  waitForOptionalApprovalPopup,
  clickApprovalAndRequireClose,
} from 'ordpool-sdk/e2e';
import { readPaymentAddress } from './payment-address';

/**
 * E2E (regtest mint) - ordpool /cat21-mint via Unisat.
 *
 * The cat21-mint counterpart of inscribe-mint-unisat-regtest.spec.ts: the same
 * non-native wallet (Unisat returns mainnet bc1q; the connector's shim rewrites
 * to bcrt1), the same mock-free real-ord funding scan (stock ord :8081 for
 * inscriptions, cat21-ord :8080 for cats), but drives the /cat21-mint page to a
 * real CAT-21 mint instead of an inscription. Asserts the on-chain tx is a
 * well-formed cat: nLockTime=21, RBF-safe input sequence, 546-sat cat output,
 * and parses through Cat21ParserService.
 *
 * Wallet-specific parts (onboarding, connect popup, sign popup) are lifted
 * verbatim from the Unisat inscribe spec; the action (fee + Mint + on-chain cat
 * assertions) from the Xverse cat21-mint spec.
 *
 * CI-only (unverified .crx). See `playwright.regtest.config.ts`.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/cat21-mint';

const FUND_AMOUNT_BTC = 0.001;
const FUND_AMOUNT_SATS = Math.round(FUND_AMOUNT_BTC * 1e8);

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.UNISAT_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/unisat');
const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  if (p.isClosed()) return;
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21-mint-unisat-regtest-${name}.png`),
    fullPage: true,
  });
}

// Unisat renders its connect + sign approvals at notification.html#/approval.
/** Approve the connect popup. Required unless `optional`: a first connect always asks, a reload may not. */
async function approveUnisatConnect(knownPages: Set<Page>, timeoutMs: number, opts: { optional?: boolean } = {}): Promise<void> {
  const wait = opts.optional ? waitForOptionalApprovalPopup : waitForApprovalPopup;
  const popup = await wait({
    context,
    knownPages,
    timeoutMs,
    isApproval: async (p) => {
      await p.waitForURL(/notification\.html#\/approval/, { timeout: timeoutMs });
      return true;
    },
  });
  if (!popup) return;
  // Unisat renders Connect as a styled <div>, not a <button> - match by text.
  await clickApprovalAndRequireClose(popup.getByText(/^Connect$/).first(), popup, { closeTimeoutMs: 30_000, label: 'Unisat connect popup' });
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`Unisat extension not unpacked at ${EXT_PATH}.`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). regtest-bootstrap.sh should have mined past maturity.`);
  }

  const workingDir = path.resolve(RESULTS_DIR, `unisat-cat21mint-user-data-dir-${process.pid}-${Date.now()}`);
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

test('cat21 mint round-trip on regtest via the Angular /cat21-mint page + Unisat', async () => {
  test.setTimeout(420_000);

  // ─── 1. Open /cat21-mint, connect Unisat ───────────────────────
  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });

  const connectTrigger = page.getByTestId('connect-wallet-trigger').first();
  await expect(connectTrigger).toBeVisible({ timeout: 30_000 });

  const knownPagesBeforeConnect = new Set(context.pages());
  await connectTrigger.click();
  await page.getByTestId('wallet-connect-unisat').click({ timeout: 20_000 });
  await approveUnisatConnect(knownPagesBeforeConnect, 60_000);
  await page.bringToFront();

  // ─── 2. Read the payment address (connector shim → bcrt1) ──────
  const paymentAddress = await readPaymentAddress(page);
  console.log(`[cat21-mint-unisat] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  // ─── 3. Fund, mine, wait for electrs + BOTH ords ───────────────
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddress, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[cat21-mint-unisat] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
  const fundedTip = mineBlocks(1);
  await waitForElectrsSync(fundedTip);
  await waitForUtxoAt(paymentAddress, FUND_AMOUNT_SATS);
  // The mock-free funding scan reads /output on both real ords; they must have
  // indexed the funding block before the scan runs.
  await waitForOrdStockSync(fundedTip);
  await waitForOrdSync(fundedTip);

  // ─── 4. Reload so the orchestrator re-fetches UTXOs ────────────
  const knownPagesBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await approveUnisatConnect(knownPagesBeforeReload, 8_000, { optional: true });
  await page.bringToFront();

  // ─── 5. Pin the fee, wait for the Mint button ──────────────────
  // The ~100k funding coin is over AUTO_SCAN_MAX_VALUE_SAT (50k), so the scanner
  // leaves it `unscanned` - and the orchestrator's fundingRecommendation
  // auto-spends a large unscanned UTXO (a deliberate-payment shape), which sets
  // the selected funding source and enables the Mint button without a manual
  // pick. (Proven: this spec passes mock-free against the real ords with no
  // picker interaction.)
  const feeRateInput = page.locator('[data-testid="cat21-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  const mintBtn = page.getByTestId('mint-cat-button');
  await expect(mintBtn).toBeEnabled({ timeout: 60_000 });
  await shot(page, '01-ready-to-mint');

  // ─── 6. Click Mint, approve the Unisat sign popup ──────────────
  const knownPagesBeforeSign = new Set(context.pages());
  await mintBtn.click();
  const signPopup = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      await p.getByTestId('sign-psbt-button').waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await shot(signPopup, '02-sign-approval');
  await clickApprovalAndRequireClose(signPopup.getByTestId('sign-psbt-button'), signPopup, { closeTimeoutMs: 30_000, label: 'Unisat sign popup' });
  await page.bringToFront();

  // ─── 7. Success card → broadcast txid ──────────────────────────
  const successAlert = page.locator('.alert.alert-success').first();
  await expect(successAlert).toBeVisible({ timeout: 120_000 });
  const successHref = await successAlert.locator('a').first().getAttribute('href');
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];
  console.log(`[cat21-mint-unisat] mint txid=${broadcastTxid}`);

  // ─── 8. Mine, confirm, assert a well-formed CAT-21 on-chain ────
  await waitForElectrsSync(mineBlocks(1));
  const esploraTx = await waitForTxConfirmed(broadcastTxid);
  expect(esploraTx.locktime).toBe(21);
  expect(esploraTx.status.block_hash).toBeTruthy();
  // RBF prevention: every input sequence >= 0xfffffffe (an RBF-replaceable mint
  // could be accelerated with a locktime!=21 replacement, silently killing the
  // cat - the 2024 Xverse-Accelerate incident).
  expect(esploraTx.vin.length).toBeGreaterThan(0);
  for (const vin of esploraTx.vin) {
    expect(vin.sequence).toBeGreaterThanOrEqual(0xfffffffe);
  }
  // The cat sat lives on the first sat of output 0, fixed at 546 sat.
  expect(esploraTx.vout.length).toBeGreaterThanOrEqual(1);
  expect(esploraTx.vout[0].value).toBe(546);

  const parsed = Cat21ParserService.parse(esploraTx);
  expect(parsed).not.toBeNull();
  expect(parsed!.type).toBe(DigitalArtifactType.Cat21);
  expect(parsed!.transactionId).toBe(broadcastTxid);
  expect(parsed!.getImage()).toMatch(/^<svg/);
});
