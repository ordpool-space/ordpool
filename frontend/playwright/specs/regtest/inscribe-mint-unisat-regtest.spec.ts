/**
 * @test-kind e2e
 * Real:   the frontend built with `ng build` (environment.ts patched to localhost URLs, Network.Regtest) and served statically, bitcoind + ordpool-electrs (SDK consumer-environment), cat21-ord :8080, ord-stock :8081, Unisat 1.7.15 (.crx, onboarded by onboardUnisat)
 * Faked:  ordpool-backend and the cat21-indexer backend: the SDK's e2e/regtest/fees-electrs-stub.mjs on :8999 stands in for both (hand-set fees with /admin/fees presets, a one-frame /api/v1/ws snapshot, empty /api/status and /api/cats, /api/* proxied to electrs)
 * Proves: the /inscribe page inscribes an SVG through Unisat: commit and reveal confirm with locktime 21 and the on-chain body is br/gzip-compressed and decodes byte-identical to the fixture
 */
/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { InscriptionParserService } from 'ordpool-parser';

import {
  fundCommonSats,
  waitForElectrsSync,
  waitForTxConfirmed,
  rpc,
  mineBlocks,
  getTx,
  waitForApprovalPopup,
  onboardUnisat,
  waitForOptionalApprovalPopup,
  clickApprovalAndRequireClose,
  installContextErrorGuard,
} from 'ordpool-sdk/e2e';
import { readPaymentAddress } from './payment-address';

/**
 * E2E (regtest inscribe) - ordpool /inscribe via Unisat.
 *
 * Unisat is a NON-NATIVE regtest wallet: its `getAddresses` returns
 * mainnet `bc1q…` regardless of the requested network. The SDK's
 * connector-side `toRegtestWalletInfo` shim rewrites those to `bcrt1…`
 * (same pubkey, HRP-swapped scriptPubKey), and the signer-side companion
 * passes `network: 'mainnet'` so the wallet unlocks its mainnet-derived
 * key. Because the shim lives in the CONNECTOR (not the test harness),
 * the page-driven flow works end to end - this spec proves it against
 * the real `/inscribe` page.
 *
 * Sibling of `inscribe-mint-regtest.spec.ts` (Xverse); the only wallet-
 * specific parts are the onboarding (import a known mnemonic), the
 * connect popup (`notification.html#/approval` → "Connect"), and the
 * sign popup (`sign-psbt-button`). Onboarding choreography lifted from
 * cubes-frontend's proven `unisat-cube-mint-roundtrip.spec.ts`.
 *
 * CI-only (unverified .crx). See `playwright.regtest.config.ts`.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/inscribe';

const FUND_AMOUNT_BTC = 0.001;

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/inscribe-probe.svg');
const EXPECTED_CONTENT_TYPE = 'image/svg+xml';
const EXPECTED_BODY = fs.readFileSync(FIXTURE_PATH);

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.UNISAT_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/unisat');

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  if (p.isClosed()) return;
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `inscribe-unisat-regtest-${name}.png`),
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

// Fails the test on any console.error or uncaught exception of an app page;
// wallet-extension pages are outside the guard (installContextErrorGuard).
let errorGuard: ReturnType<typeof installContextErrorGuard> | undefined;

test.afterEach(() => {
  if (!errorGuard) throw new Error('browser-error guard was never installed');
  errorGuard.assertClean();
});

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(
      `Unisat extension not unpacked at ${EXT_PATH}. The workflow should ` +
      'have run the SDK\'s playwright-bootstrap.sh unisat step.',
    );
  }
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(`inscription fixture missing at ${FIXTURE_PATH}`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). regtest-bootstrap.sh should have mined past maturity.`);
  }

  const workingDir = path.resolve(RESULTS_DIR, `unisat-inscribe-user-data-dir-${process.pid}-${Date.now()}`);
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
  errorGuard = installContextErrorGuard(context);
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  extensionId = worker.url().split('/')[2];

  const primer = await context.newPage();
  await onboardUnisat(primer, extensionId);
  await shot(primer, '00-onboarded');
  await primer.close();
});

test.afterAll(async () => {
  await context?.close();
});

test('inscribe round-trip on regtest via the Angular /inscribe page + Unisat', async () => {
  test.setTimeout(420_000);

  // ─── 1. Open /inscribe, connect Unisat via the picker ──────────
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
  await page.getByTestId('wallet-connect-unisat').click({ timeout: 20_000 });
  await shot(page, '02-picker-clicked');

  await approveUnisatConnect(knownPagesBeforeConnect, 60_000);
  await page.bringToFront();

  // ─── 2. Read the payment address (connector shim → bcrt1) ──────
  const paymentAddress = await readPaymentAddress(page);
  console.log(`[inscribe-unisat] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  // ─── 3. Fund, mine, wait for electrs ───────────────────────────
  // A coin on common sats: the funding-safety scan reads /output on both real
  // ords, and a plain sendtoaddress can hand this wallet the coinbase's uncommon
  // first sat. fundCommonSats mines it and waits for electrs and both ords.
  await fundCommonSats(paymentAddress, FUND_AMOUNT_BTC);
  console.log(`[inscribe-unisat] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC on common sats`);

  // ─── 4. Reload so the orchestrator re-fetches UTXOs ────────────
  const knownPagesBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await approveUnisatConnect(knownPagesBeforeReload, 8_000, { optional: true });
  await page.bringToFront();
  await shot(page, '03-reloaded');

  // ─── 5. Drop the fixture, pin the fee ──────────────────────────
  await page.setInputFiles('[data-testid="inscribe-file-input"]', FIXTURE_PATH);
  await expect(page.locator('[data-testid="inscribe-detected-type"]')).toHaveText(EXPECTED_CONTENT_TYPE, { timeout: 10_000 });
  const feeRateInput = page.locator('[data-testid="inscribe-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');

  const inscribeButton = page.locator('[data-testid="inscribe-btn"]');
  await expect(inscribeButton).toBeEnabled({ timeout: 60_000 });
  await shot(page, '04-ready-to-inscribe');

  // ─── 6. Click Inscribe, approve the Unisat sign popup ──────────
  const knownPagesBeforeSign = new Set(context.pages());
  await inscribeButton.click();
  const signPopup = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      await p.getByTestId('sign-psbt-button').waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await shot(signPopup, '05-sign-approval');
  await clickApprovalAndRequireClose(signPopup.getByTestId('sign-psbt-button'), signPopup, { closeTimeoutMs: 30_000, label: 'Unisat sign popup' });
  await page.bringToFront();

  // ─── 7. Success panel → commit/reveal txids ────────────────────
  const successPanel = page.locator('[data-testid="inscribe-success"]');
  await expect(successPanel).toBeVisible({ timeout: 120_000 });
  await shot(page, '06-success');

  const commitTxId = (await page.locator('[data-testid="inscribe-commit-txid"]').textContent())!.trim();
  const revealTxId = (await page.locator('[data-testid="inscribe-reveal-txid"]').textContent())!.trim();
  console.log(`[inscribe-unisat] commit=${commitTxId} reveal=${revealTxId}`);
  expect(commitTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).not.toBe(commitTxId);

  // ─── 8. Confirm + verify the inscription on-chain ──────────────
  await waitForElectrsSync(mineBlocks(1));
  const commitTx = await waitForTxConfirmed(commitTxId);
  const revealTx = await waitForTxConfirmed(revealTxId);
  console.log(`[inscribe-unisat] commit locktime=${commitTx.locktime} reveal locktime=${revealTx.locktime}`);
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
