/* eslint-disable no-console */
import { test, expect, errors, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { InscriptionParserService } from 'ordpool-parser';

import {
  waitForUtxoAt,
  waitForElectrsSync,
  waitForOrdSync,
  waitForOrdStockSync,
  waitForTxConfirmed,
  rpc,
  mineBlocks,
  getTx,
  waitForApprovalPopup,
  onboardOkx,
  isVisibleWithin,
  waitForOptionalApprovalPopup,
  clickApprovalAndRequireClose,
} from 'ordpool-sdk/e2e';
import { readPaymentAddress } from './payment-address';

/**
 * E2E (regtest inscribe) - ordpool /inscribe via OKX.
 *
 * OKX is a NON-NATIVE regtest wallet: mainnet HRP from `getAddresses`,
 * rewritten to `bcrt1…` by the SDK connector's `toRegtestWalletInfo`
 * shim. OKX's onboarding is the most involved of the .crx wallets
 * (multi-page, multi-iframe, CDP mouse events to defeat anti-bot; the
 * context must launch with `--disable-blink-features=AutomationControlled`).
 * Onboarding uses the shared SDK `onboardOkx` helper;
 * connect anchors on the "Connect account" header, and OKX REUSES its
 * extension page for the sign popup (poll all pages for "Signature
 * request" / "Confirm Trade"). CI-only.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/inscribe';

const FUND_AMOUNT_BTC = 0.001;
const FUND_AMOUNT_SATS = Math.round(FUND_AMOUNT_BTC * 1e8);

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/inscribe-probe.svg');
const EXPECTED_CONTENT_TYPE = 'image/svg+xml';
const EXPECTED_BODY = fs.readFileSync(FIXTURE_PATH);

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.OKX_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/okx');

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;
let onboardPage: Page | undefined;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  if (p.isClosed()) return;
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `inscribe-okx-regtest-${name}.png`),
    fullPage: true,
  });
}

// OKX connect popup anchors on the "Connect account" header.
/** Approve the connect popup. Required unless `optional`: a first connect always asks, a reload may not. */
async function approveOkxConnect(knownPages: Set<Page>, timeoutMs: number, opts: { optional?: boolean } = {}): Promise<void> {
  const wait = opts.optional ? waitForOptionalApprovalPopup : waitForApprovalPopup;
  const approval = await wait({
    context,
    knownPages,
    timeoutMs,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByText('Connect account').first().waitFor({ state: 'visible', timeout: timeoutMs });
      return true;
    },
  });
  if (!approval) return;
  await clickApprovalAndRequireClose(approval.getByRole('button', { name: /^connect$/i }).first(), approval, { closeTimeoutMs: 30_000, label: 'OKX connect popup' });
}

// OKX reuses its extension page for the sign approval - poll all pages
// for the "Signature request" body, dismiss a promo overlay if present,
// then click Confirm.
async function approveOkxSign(): Promise<void> {
  // OKX reuses its already-open extension page for the sign step, and
  // waitForApprovalPopup checks open pages as well as new ones.
  const approval = await waitForApprovalPopup({
    context,
    knownPages: new Set(),
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByText(/Signature request|Confirm Trade|Asset transfer pending/i).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await shot(approval, '05-sign-popup');

  const promo = approval.getByText('Asset transfer pending');
  if (await isVisibleWithin(promo, 2_000)) {
    const closeBtn = approval.locator('button:has(svg), [aria-label="close" i], [aria-label="Close" i]').first();
    if (await isVisibleWithin(closeBtn, 2_000)) {
      await closeBtn.click({ force: true });
    }
    await expect(promo).toBeHidden({ timeout: 10_000 });
  }
  await approval.getByText('Confirm', { exact: true }).first().click();
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(
      `OKX extension not unpacked at ${EXT_PATH}. The workflow should ` +
      'have run the SDK\'s playwright-bootstrap.sh okx step.',
    );
  }
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(`inscription fixture missing at ${FIXTURE_PATH}`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). regtest-bootstrap.sh should have mined past maturity.`);
  }

  // Empty '' profile (fresh in-memory) + AutomationControlled off so the
  // OKX welcome-screen click isn't absorbed by anti-bot. Reuse OKX's
  // auto-opened onboarding tab.
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
    viewport: { width: 1280, height: 900 },
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  extensionId = worker.url().split('/')[2];

  try {
    onboardPage = await context.waitForEvent('page', {
      predicate: (p) => p.url().startsWith(`chrome-extension://${extensionId}`),
      timeout: 15_000,
    });
  } catch (e) {
    // OKX did not open its onboarding tab by itself; a fresh page is used instead.
    if (!(e instanceof errors.TimeoutError)) throw e;
  }
  if (!onboardPage) onboardPage = await context.newPage();
  await onboardOkx(onboardPage, extensionId);
  await shot(onboardPage, '00-onboarded');
  // Do NOT close onboardPage - OKX reuses its extension page for sign.
});

test.afterAll(async () => {
  await context?.close();
});

test('inscribe round-trip on regtest via the Angular /inscribe page + OKX', async () => {
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
  await page.getByTestId('wallet-connect-okx').click({ timeout: 20_000 });
  await shot(page, '02-picker-clicked');
  await approveOkxConnect(knownPagesBeforeConnect, 60_000);
  await page.bringToFront();

  const paymentAddress = await readPaymentAddress(page);
  console.log(`[inscribe-okx] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddress, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[inscribe-okx] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
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
  await approveOkxConnect(knownPagesBeforeReload, 8_000, { optional: true });
  await page.bringToFront();
  await shot(page, '03-reloaded');

  await page.setInputFiles('[data-testid="inscribe-file-input"]', FIXTURE_PATH);
  await expect(page.locator('[data-testid="inscribe-detected-type"]')).toHaveText(EXPECTED_CONTENT_TYPE, { timeout: 10_000 });
  const feeRateInput = page.locator('[data-testid="inscribe-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');

  const inscribeButton = page.locator('[data-testid="inscribe-btn"]');
  await expect(inscribeButton).toBeEnabled({ timeout: 60_000 });
  await shot(page, '04-ready-to-inscribe');

  await inscribeButton.click();
  await approveOkxSign();
  await page.bringToFront();

  const successPanel = page.locator('[data-testid="inscribe-success"]');
  await expect(successPanel).toBeVisible({ timeout: 120_000 });
  await shot(page, '06-success');

  const commitTxId = (await page.locator('[data-testid="inscribe-commit-txid"]').textContent())!.trim();
  const revealTxId = (await page.locator('[data-testid="inscribe-reveal-txid"]').textContent())!.trim();
  console.log(`[inscribe-okx] commit=${commitTxId} reveal=${revealTxId}`);
  expect(commitTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).not.toBe(commitTxId);

  await waitForElectrsSync(mineBlocks(1));
  const commitTx = await waitForTxConfirmed(commitTxId);
  const revealTx = await waitForTxConfirmed(revealTxId);
  console.log(`[inscribe-okx] commit locktime=${commitTx.locktime} reveal locktime=${revealTx.locktime}`);
  expect(commitTx.locktime).toBe(21);
  expect(revealTx.locktime).toBe(21);
  expect(revealTx.status.block_hash).toBeTruthy();

  const revealFull = await getTx(revealTxId);
  const witnessHex = (revealFull as unknown as { vin: { witness: string[] }[] }).vin[0].witness;
  const parsed = InscriptionParserService.parse({ txid: revealTxId, vin: [{ witness: witnessHex }] });
  expect(parsed.length).toBe(1);
  expect(parsed[0].contentType).toBe(EXPECTED_CONTENT_TYPE);
  // Compression landed on-chain (the SVG fixture clears the 5% margin) and
  // decodes back byte-identically - the immutability-safety acceptance criterion.
  const enc = parsed[0].getContentEncoding();
  expect(['br', 'gzip']).toContain(enc);                     // a real codec fired
  const onChain = Buffer.from(parsed[0].getDataRaw());
  expect(onChain.length).toBeLessThan(EXPECTED_BODY.length); // actually compressed
  const decoded = Buffer.from(await parsed[0].getData(), 'base64');
  expect(decoded.equals(EXPECTED_BODY)).toBe(true);          // clean decode to original
});
