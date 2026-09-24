/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
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
  onboardCat21Wallet,
} from 'ordpool-sdk/e2e';

/**
 * E2E (regtest inscribe) - ordpool /inscribe via CAT-21 wallet.
 *
 * CAT-21 wallet is OUR Leather fork, a non-native regtest wallet: mainnet HRP from
 * `getAddresses`, rewritten to `bcrt1…` by the SDK connector's
 * `toRegtestWalletInfo` shim. Sibling of the Xverse/Unisat/Wizz inscribe
 * specs; onboarding + the connect (`get-addresses-approve-button`) and
 * sign (confirm/sign/approve, self-closing popup) choreography lifted
 * from cubes-frontend's proven `leather-cube-mint-roundtrip.spec.ts`.
 * CI-only.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/inscribe';

const FUND_AMOUNT_BTC = 0.001;
const FUND_AMOUNT_SATS = Math.round(FUND_AMOUNT_BTC * 1e8);

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/inscribe-probe.svg');
const EXPECTED_CONTENT_TYPE = 'image/svg+xml';
const EXPECTED_BODY = fs.readFileSync(FIXTURE_PATH);

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21wallet-inscribe-user-data-dir.png`),
    fullPage: true,
  }).catch(() => undefined);
}

// CAT-21 wallet (Leather fork) connect approval: get-addresses-approve-button.
async function approveCat21WalletConnect(knownPages: Set<Page>, timeoutMs: number): Promise<Page | null> {
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

// CAT-21 wallet closes its own popup on sign completion; noWaitAfter dodges
// the post-click stability wait racing the teardown.
async function clickCat21WalletApproval(popup: Page): Promise<void> {
  const btn = popup.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click({ noWaitAfter: true, timeout: 30_000 });
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(
      `CAT-21 wallet extension not unpacked at ${EXT_PATH}. The workflow should ` +
      'have run the SDK\'s playwright-bootstrap.sh cat21wallet step.',
    );
  }
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(`inscription fixture missing at ${FIXTURE_PATH}`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). regtest-bootstrap.sh should have mined past maturity.`);
  }

  const workingDir = path.resolve(RESULTS_DIR, `cat21wallet-inscribe-user-data-dir-${process.pid}-${Date.now()}`);
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
  await onboardCat21Wallet(primer, extensionId);
  await shot(primer, '00-onboarded');
  await primer.close();
});

test.afterAll(async () => {
  await context?.close();
});

test('inscribe round-trip on regtest via the Angular /inscribe page + CAT-21 wallet', async () => {
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
  await page.getByTestId('wallet-connect-cat21wallet').click({ timeout: 20_000 });
  await shot(page, '02-picker-clicked');
  await approveCat21WalletConnect(knownPagesBeforeConnect, 60_000);
  await page.bringToFront();

  const paymentCode = page.locator('[data-testid="fund-payment-address"]').first();
  await expect(paymentCode).toBeVisible({ timeout: 60_000 });
  const paymentAddress = (await paymentCode.textContent())!.replace(/\s+/g, '');
  console.log(`[inscribe-cat21wallet] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddress, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[inscribe-cat21wallet] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
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
  await approveCat21WalletConnect(knownPagesBeforeReload, 8_000);
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

  const knownPagesBeforeSign = new Set(context.pages());
  await inscribeButton.click();
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
  await shot(signPopup, '05-sign-popup');
  await clickCat21WalletApproval(signPopup);
  await page.bringToFront();

  const successPanel = page.locator('[data-testid="inscribe-success"]');
  await expect(successPanel).toBeVisible({ timeout: 120_000 });
  await shot(page, '06-success');

  const commitTxId = (await page.locator('[data-testid="inscribe-commit-txid"]').textContent())!.trim();
  const revealTxId = (await page.locator('[data-testid="inscribe-reveal-txid"]').textContent())!.trim();
  console.log(`[inscribe-cat21wallet] commit=${commitTxId} reveal=${revealTxId}`);
  expect(commitTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).not.toBe(commitTxId);

  await waitForElectrsSync(mineBlocks(1));
  const commitTx = await waitForTxConfirmed(commitTxId);
  const revealTx = await waitForTxConfirmed(revealTxId);
  console.log(`[inscribe-cat21wallet] commit locktime=${commitTx.locktime} reveal locktime=${revealTx.locktime}`);
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
