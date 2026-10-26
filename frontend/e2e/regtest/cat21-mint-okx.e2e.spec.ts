/**
 * @test-kind e2e
 * Real:   the frontend built with `ng build` (environment.ts patched to localhost URLs, Network.Regtest) and served statically, bitcoind + ordpool-electrs (SDK consumer-environment), cat21-ord, ord-stock, OKX 4.1.0 (.crx, onboarded by onboardOkx)
 * Faked:  OKX's welcome page -> installOkxOfflineRoutes (ordpool-sdk); ordpool-backend and the cat21-indexer backend: the SDK's e2e/regtest/fees-electrs-stub.mjs stands in for both (hand-set fees with /admin/fees presets, a one-frame /api/v1/ws snapshot, empty /api/status and /api/cats, /api/* proxied to electrs)
 * Proves: the /cat21-mint page mints a CAT-21 through OKX (locktime 21, every input sequence >= 0xfffffffe, output 0 at 546 sat, parses as a cat)
 */
/* eslint-disable no-console */
import { test, expect, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { Cat21ParserService, DigitalArtifactType } from 'ordpool-parser';

import {
  fundCommonSats,
  waitForElectrsSync,
  waitForTxConfirmed,
  rpc,
  mineBlocks,
  waitForApprovalByConfirmButton,
  raceApprovalPopup,
  approveOkxConnectPopup,
  isOkxConnectApproval,
  onboardOkx,
  extensionOnboardingPage,
  dismissOkxAssetTransferPromo,
  clickApprovalAndRequireClose,
  installContextErrorGuard,
  installOkxOfflineRoutes,
  launchWalletContext,
  regtestServiceUrls,
} from 'ordpool-sdk/e2e';
import { connectedWalletButton, readPaymentAddress } from './payment-address';

/**
 * E2E (regtest mint) - ordpool /cat21-mint via OKX.
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

const FRONTEND_URL = regtestServiceUrls().app;
const MINT_PATH = '/cat21-mint';

const FUND_AMOUNT_BTC = 0.001;


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
    path: path.resolve(RESULTS_DIR, `cat21-mint-okx-regtest-${name}.png`),
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

test('cat21 mint round-trip on regtest via the Angular /cat21-mint page + OKX', async () => {

  const page = await context.newPage();
  // No /output mock. The funding-safety scan probes the REAL local ords the
  // workflow wired into environment.ts: stock ord for inscriptions/
  // runes/sat_ranges and cat21-ord for cats. A clean regtest payment
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
  console.log(`[cat21-mint-okx] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  // A coin on common sats: the funding-safety scan reads /output on both real
  // ords, and a plain sendtoaddress can hand this wallet the coinbase's uncommon
  // first sat. fundCommonSats mines it and waits for electrs and both ords.
  await fundCommonSats(paymentAddress, FUND_AMOUNT_BTC);
  console.log(`[cat21-mint-okx] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC on common sats`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await reconnectOkx(page);
  await page.bringToFront();
  await shot(page, '03-reloaded');

  // ─── 5. Pin the fee, wait for the Mint button ──────────────────
  // The large (>50k) funding coin is auto-picked by the orchestrator's
  // fundingRecommendation, so Mint enables without a manual pick.
  const feeRateInput = page.locator('[data-testid="cat21-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  const mintBtn = page.getByTestId('mint-cat-button');
  await expect(mintBtn).toBeEnabled();
  await shot(page, '01-ready-to-mint');

  // ─── 6. Click Mint, approve the OKX sign popup ─────────────────
  await mintBtn.click();
  await approveOkxSign();
  await page.bringToFront();

  // ─── 7. Success card → broadcast txid ──────────────────────────
  const successAlert = page.locator('.alert.alert-success').first();
  await expect(successAlert).toBeVisible();
  const successHref = await successAlert.locator('a').first().getAttribute('href');
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];
  console.log(`[cat21-mint-okx] mint txid=${broadcastTxid}`);

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
