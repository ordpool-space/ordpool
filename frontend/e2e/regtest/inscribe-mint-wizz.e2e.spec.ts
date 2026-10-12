/**
 * @test-kind e2e
 * Real:   the frontend built with `ng build` (environment.ts patched to localhost URLs, Network.Regtest) and served statically, bitcoind + ordpool-electrs (SDK consumer-environment), cat21-ord, ord-stock, Wizz 2.13.4 (.crx, onboarded by onboardWizz)
 * Faked:  Wizz's wallet API -> installWizzOfflineRoutes (ordpool-sdk, captured); ordpool-backend and the cat21-indexer backend: the SDK's e2e/regtest/fees-electrs-stub.mjs stands in for both (hand-set fees with /admin/fees presets, a one-frame /api/v1/ws snapshot, empty /api/status and /api/cats, /api/* proxied to electrs); Wizz's vendor backends (ep.wizz.cash, ordx.wizz.cash, wallet-api.unisat.io, api.rgbpp.io) -> installWizzOfflineRoutes (ordpool-sdk)
 * Proves: the /inscribe page inscribes an SVG through Wizz: commit and reveal confirm with locktime 21 and the on-chain body is br/gzip-compressed and decodes byte-identical to the fixture
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
  waitForApprovalPopup,
  installWizzOfflineRoutes,
  approveWizzSignPopup,
  onboardWizz,
  raceApprovalPopup,
  approvalGate,
  clickApprovalAndRequireClose,
  installContextErrorGuard,
  launchWalletContext,
  regtestServiceUrls,
} from 'ordpool-sdk/e2e';
import { connectedWalletButton, readPaymentAddress } from './payment-address';

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

const FRONTEND_URL = regtestServiceUrls().app;
const MINT_PATH = '/inscribe';

const FUND_AMOUNT_BTC = 0.001;

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/inscribe-probe.svg');
const EXPECTED_CONTENT_TYPE = 'image/svg+xml';
const EXPECTED_BODY = fs.readFileSync(FIXTURE_PATH);

const SDK_E2E_DIR = path.resolve(__dirname, '../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.WIZZ_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/wizz');

const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;
let extensionId: string;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  if (p.isClosed()) return;
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `inscribe-wizz-regtest-${name}.png`),
    fullPage: true,
  });
}

// Wizz inherits Unisat's connect-approval: a styled "Connect" div at
// notification.html#/approval.
/** The wallet's connect popup, recognised by its approve control. */
const connectApproval = approvalGate({
  url: /notification\.html#\/approval/,
  control: (p) => p.getByText(/^Connect$/).first(),
});

/**
 * Approve the wallet's connect popup. With `reloadedPage`, the app restores the
 * wallet from storage after a reload and shows it as connected without asking
 * the wallet, so the popup is approved only if the wallet opens one anyway.
 */
async function approveWizzConnect(knownPages: Set<Page>, opts: { reloadedPage?: Page } = {}): Promise<void> {
  const search = { context, knownPages, isApproval: connectApproval };
  let approval: Page;
  if (opts.reloadedPage) {
    const race = await raceApprovalPopup({ ...search, noPopupState: connectedWalletButton(opts.reloadedPage) });
    if (race.outcome === 'no-popup') return;
    approval = race.page;
  } else {
    approval = await waitForApprovalPopup(search);
  }
  await clickApprovalAndRequireClose(approval.getByText(/^Connect$/).first(), approval, { label: 'Wizz connect popup' });
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
      `Wizz extension not unpacked at ${EXT_PATH}. The workflow should ` +
      'have run the SDK\'s playwright-bootstrap.sh wizz step.',
    );
  }
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(`inscription fixture missing at ${FIXTURE_PATH}`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). regtest-bootstrap.sh should have mined past maturity.`);
  }

  const workingDir = path.resolve(RESULTS_DIR, `wizz-inscribe-user-data-dir-${process.pid}-${Date.now()}`);
  fs.mkdirSync(workingDir, { recursive: true });

  context = await launchWalletContext({
    wallet: 'wizz',
    extensionPath: EXT_PATH,
    userDataDir: workingDir,
  });
  errorGuard = installContextErrorGuard(context);
  // Hermetic Wizz: stub the wallet's third-party balance/asset backends
  // (ep.wizz.cash / ordx.wizz.cash / wallet-api.unisat.io / api.rgbpp.io)
  // so the sign popup can enable Sign without Wizz server uptime — the
  // same canonical helper the SDK + cubes wizz specs use. Without it the
  // popup shows "Failed to load balance" and Sign stays disabled.
  await installWizzOfflineRoutes(context);

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  extensionId = worker.url().split('/')[2];

  const primer = await context.newPage();
  await onboardWizz(primer, extensionId);
  await shot(primer, '00-onboarded');
  await primer.close();
});

test.afterAll(async () => {
  await context?.close();
});

test('inscribe round-trip on regtest via the Angular /inscribe page + Wizz', async () => {
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

  const knownPagesBeforeConnect = new Set(context.pages());
  await connectTrigger.click();
  await page.getByTestId('wallet-connect-wizz').click();
  await shot(page, '02-picker-clicked');
  await approveWizzConnect(knownPagesBeforeConnect);
  await page.bringToFront();

  const paymentAddress = await readPaymentAddress(page);
  console.log(`[inscribe-wizz] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  // A coin on common sats: the funding-safety scan reads /output on both real
  // ords, and a plain sendtoaddress can hand this wallet the coinbase's uncommon
  // first sat. fundCommonSats mines it and waits for electrs and both ords.
  await fundCommonSats(paymentAddress, FUND_AMOUNT_BTC);
  console.log(`[inscribe-wizz] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC on common sats`);

  const knownPagesBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await approveWizzConnect(knownPagesBeforeReload, { reloadedPage: page });
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

  const knownPagesBeforeSign = new Set(context.pages());
  await inscribeButton.click();
  await approveWizzSignPopup({ context, knownPages: knownPagesBeforeSign, onScreenshot: shot });
  await page.bringToFront();

  const successPanel = page.locator('[data-testid="inscribe-success"]');
  await expect(successPanel).toBeVisible();
  await shot(page, '06-success');

  const commitTxId = (await page.locator('[data-testid="inscribe-commit-txid"]').textContent())!.trim();
  const revealTxId = (await page.locator('[data-testid="inscribe-reveal-txid"]').textContent())!.trim();
  console.log(`[inscribe-wizz] commit=${commitTxId} reveal=${revealTxId}`);
  expect(commitTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).not.toBe(commitTxId);

  await waitForElectrsSync(mineBlocks(1));
  const commitTx = await waitForTxConfirmed(commitTxId);
  const revealTx = await waitForTxConfirmed(revealTxId);
  console.log(`[inscribe-wizz] commit locktime=${commitTx.locktime} reveal locktime=${revealTx.locktime}`);
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
