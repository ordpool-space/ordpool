/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { InscriptionParserService } from 'ordpool-parser';

import {
  waitForUtxoAt,
  waitForElectrsSync,
  waitForTxConfirmed,
  rpc,
  mineBlocks,
  getTx,
} from './sdk-lib/regtest-helpers';
import { waitForApprovalPopup } from './sdk-lib/approval-popup';
import { onboardOkx } from './okx-onboard-helper';

/**
 * E2E (regtest inscribe) - ordpool /inscribe via OKX.
 *
 * OKX is a NON-NATIVE regtest wallet: mainnet HRP from `getAddresses`,
 * rewritten to `bcrt1…` by the SDK connector's `toRegtestWalletInfo`
 * shim. OKX's onboarding is the most involved of the .crx wallets
 * (multi-page, multi-iframe, CDP mouse events to defeat anti-bot; the
 * context must launch with `--disable-blink-features=AutomationControlled`).
 * Onboarding is `okx-onboard-helper.ts` (copied from cubes-frontend);
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
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `inscribe-okx-regtest-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

// OKX connect popup anchors on the "Connect account" header.
async function approveOkxConnect(knownPages: Set<Page>, timeoutMs: number): Promise<Page | null> {
  const approval = await waitForApprovalPopup({
    context,
    knownPages,
    timeoutMs,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByText('Connect account').first().waitFor({ state: 'visible', timeout: timeoutMs });
      return true;
    },
  }).catch(() => null);
  if (approval) {
    await approval.getByRole('button', { name: /^connect$/i }).first().click();
    await approval.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }
  return approval;
}

// OKX reuses its extension page for the sign approval - poll all pages
// for the "Signature request" body, dismiss a promo overlay if present,
// then click Confirm.
async function approveOkxSign(): Promise<void> {
  const deadline = Date.now() + 120_000;
  let approval: Page | null = null;
  while (Date.now() < deadline) {
    for (const p of context.pages()) {
      if (!p.url().startsWith('chrome-extension://')) continue;
      const text = await p.locator('body').innerText().catch(() => '');
      if (/Signature request|Confirm Trade|Asset transfer pending/i.test(text)) {
        approval = p;
        break;
      }
    }
    if (approval) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!approval) throw new Error('OKX sign popup never showed Signature request | Confirm Trade within 120s');
  await shot(approval, '05-sign-popup');

  const promo = approval.getByText('Asset transfer pending');
  if (await promo.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const closeBtn = approval.locator('button:has(svg), [aria-label="close" i], [aria-label="Close" i]').first();
    if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await closeBtn.click({ force: true }).catch(() => undefined);
    }
    await promo.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
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
  } catch {
    /* fall through */
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
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, '01-page-loaded');

  const connectLink = page.getByRole('link', { name: /connect your wallet/i }).first();
  await expect(connectLink).toBeVisible({ timeout: 30_000 });

  const knownPagesBeforeConnect = new Set(context.pages());
  await connectLink.click();
  await page.getByTestId('wallet-connect-okx').click({ timeout: 20_000 });
  await shot(page, '02-picker-clicked');
  await approveOkxConnect(knownPagesBeforeConnect, 60_000);
  await page.bringToFront();

  const paymentCode = page.locator('code.bitcoin', { hasText: /^(bcrt1q|bcrt1p|2)/ }).first();
  await expect(paymentCode).toBeVisible({ timeout: 60_000 });
  const paymentAddress = (await paymentCode.textContent())!.trim();
  console.log(`[inscribe-okx] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddress, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[inscribe-okx] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
  await waitForElectrsSync(mineBlocks(1));
  // Poll the address→utxo index until the funding UTXO is visible.
  // waitForElectrsSync only confirms the block HEIGHT; electrs indexes
  // the address→utxo mapping a tick later, so an immediate getUtxos can
  // miss the fresh output (observed flaking here across wallets).
  await waitForUtxoAt(paymentAddress, FUND_AMOUNT_SATS);

  const knownPagesBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await approveOkxConnect(knownPagesBeforeReload, 8_000);
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
