/**
 * @test-kind e2e
 * Real:   the frontend built with `ng build` (environment.ts patched to localhost URLs, Network.Regtest) and served statically, bitcoind + ordpool-electrs (SDK consumer-environment), cat21-ord :8080, ord-stock :8081, OKX 4.1.0 (.crx, onboarded by onboardOkx)
 * Faked:  OKX's welcome page -> installOkxOfflineRoutes (ordpool-sdk); ordpool-backend and the cat21-indexer backend: the SDK's e2e/regtest/fees-electrs-stub.mjs on :8999 stands in for both (hand-set fees with /admin/fees presets, a one-frame /api/v1/ws snapshot, empty /api/status and /api/cats, /api/* proxied to electrs)
 * Proves: the /inscribe page inscribes an SVG through OKX: commit and reveal confirm with locktime 21 and the on-chain body is br/gzip-compressed and decodes byte-identical to the fixture
 */
/* eslint-disable no-console */
import { test, expect, BrowserContext, Page } from '@playwright/test';
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
  waitForApprovalByConfirmButton,
  onboardOkx,
  extensionOnboardingPage,
  dismissOkxAssetTransferPromo,
  installOkxOfflineRoutes,
  raceApprovalPopup,
  approveOkxConnectPopup,
  isOkxConnectApproval,
  clickApprovalAndRequireClose,
  installContextErrorGuard,
  launchWalletContext,
} from 'ordpool-sdk/e2e';
import { connectedWalletButton, readPaymentAddress } from './payment-address';

/**
 * E2E (regtest inscribe) - ordpool /inscribe via OKX.
 *
 * OKX is a NON-NATIVE regtest wallet: mainnet HRP from `getAddresses`,
 * rewritten to `bcrt1…` by the SDK connector's `toRegtestWalletInfo`
 * shim. OKX's onboarding is the most involved of the .crx wallets
 * (multi-page, multi-iframe, CDP mouse events to defeat anti-bot; the
 * launch switches it needs come with `launchWalletContext({ wallet: 'okx' })`).
 * Onboarding uses the shared SDK `onboardOkx` helper;
 * connect goes through the SDK's `approveOkxConnectPopup`, and OKX REUSES its
 * extension page for the sign popup (poll all pages for "Signature
 * request" / "Confirm Trade"). CI-only.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/inscribe';

const FUND_AMOUNT_BTC = 0.001;

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/inscribe-probe.svg');
const EXPECTED_CONTENT_TYPE = 'image/svg+xml';
const EXPECTED_BODY = fs.readFileSync(FIXTURE_PATH);

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.OKX_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/okx');

const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;
let extensionId: string;
let onboardPage: Page;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  if (p.isClosed()) return;
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `inscribe-okx-regtest-${name}.png`),
    fullPage: true,
  });
}

/**
 * After a reload the app restores the wallet from storage and shows it as
 * connected without asking OKX; approve OKX's connect request only if it shows
 * one anyway. OKX may show it in a page that was already open (it reuses its
 * popup window), so the search covers every page and the URL decides.
 */
async function reconnectOkx(page: Page): Promise<void> {
  const race = await raceApprovalPopup({
    context,
    knownPages: new Set(),
    isApproval: isOkxConnectApproval,
    noPopupState: connectedWalletButton(page),
  });
  if (race.outcome === 'popup') await approveOkxConnectPopup({ context });
}

// OKX may serve the sign approval from an extension page that is already
// open, so the search is by its Confirm button across every page. A promo
// overlay OKX may layer over it is dismissed first; OKX closes the popup the
// moment it accepts the click, so the close is the proof the click landed.
async function approveOkxSign(): Promise<void> {
  const approval = await waitForApprovalByConfirmButton({ context });
  await shot(approval, '05-sign-popup');
  await dismissOkxAssetTransferPromo(approval);
  await clickApprovalAndRequireClose(approval.getByText('Confirm', { exact: true }).first(), approval, { label: 'OKX sign popup' });
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

  // Fresh temporary profile; `wallet: 'okx'` adds the switch that keeps OKX's
  // welcome-screen click from being absorbed by anti-bot. Reuse OKX's
  // auto-opened onboarding tab.
  context = await launchWalletContext({
    wallet: 'okx',
    extensionPath: EXT_PATH,
  });
  await installOkxOfflineRoutes(context);
  errorGuard = installContextErrorGuard(context);
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  extensionId = worker.url().split('/')[2];

  onboardPage = await extensionOnboardingPage(context, extensionId);
  await onboardOkx(onboardPage, extensionId);
  await shot(onboardPage, '00-onboarded');
  // Do NOT close onboardPage - OKX reuses its extension page for sign.
});

test.afterAll(async () => {
  await context?.close();
});

test('inscribe round-trip on regtest via the Angular /inscribe page + OKX', async () => {
  const page = await context.newPage();
  // No /output mock. The funding-safety scan probes the REAL local ords the
  // workflow wired into environment.ts: stock ord (:8081) for inscriptions/
  // runes/sat_ranges and cat21-ord (:8080) for cats. A clean regtest payment
  // coin returns empty from both, so it classifies usable for real. The sync
  // waits after funding ensure both ords have indexed the funding block first.
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, '01-page-loaded');

  const connectTrigger = page.getByTestId('connect-wallet-trigger').first();
  await expect(connectTrigger).toBeVisible();

  await connectTrigger.click();
  await page.getByTestId('wallet-connect-okx').click();
  await shot(page, '02-picker-clicked');
  await approveOkxConnectPopup({ context });
  await page.bringToFront();

  const paymentAddress = await readPaymentAddress(page);
  console.log(`[inscribe-okx] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  // A coin on common sats: the funding-safety scan reads /output on both real
  // ords, and a plain sendtoaddress can hand this wallet the coinbase's uncommon
  // first sat. fundCommonSats mines it and waits for electrs and both ords.
  await fundCommonSats(paymentAddress, FUND_AMOUNT_BTC);
  console.log(`[inscribe-okx] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC on common sats`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await reconnectOkx(page);
  await page.bringToFront();
  await shot(page, '03-reloaded');

  await page.setInputFiles('[data-testid="inscribe-file-input"]', FIXTURE_PATH);
  await expect(page.locator('[data-testid="inscribe-detected-type"]')).toHaveText(EXPECTED_CONTENT_TYPE);
  const feeRateInput = page.locator('[data-testid="inscribe-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');

  const inscribeButton = page.locator('[data-testid="inscribe-btn"]');
  await expect(inscribeButton).toBeEnabled();
  await shot(page, '04-ready-to-inscribe');

  await inscribeButton.click();
  await approveOkxSign();
  await page.bringToFront();

  const successPanel = page.locator('[data-testid="inscribe-success"]');
  await expect(successPanel).toBeVisible();
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
