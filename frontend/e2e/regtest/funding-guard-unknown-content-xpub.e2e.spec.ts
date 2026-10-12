/**
 * @test-kind e2e
 * Real:   the frontend built with `ng build` (environment.ts patched to localhost URLs, Network.Regtest) and served statically, bitcoind + ordpool-electrs (SDK consumer-environment), cat21-ord, ord-stock, no extension: a watch-only tpub from makeWatchOnlyTestAccount (ordpool-sdk)
 * Faked:  ordpool-backend and the cat21-indexer backend: the SDK's e2e/regtest/fees-electrs-stub.mjs stands in for both (hand-set fees with /admin/fees presets, a one-frame /api/v1/ws snapshot, empty /api/status and /api/cats, /api/* proxied to electrs)
 * Proves: a funding coin no ord has indexed yet blocks the mint with the unknown-content warning and no recommended badge, and the warning's Retry scan re-reads both ords once the coin confirms
 */
/* eslint-disable no-console */
import { test, expect, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';

import {
  makeWatchOnlyTestAccount,
  getUtxos,
  waitForUtxoMatching,
  waitForElectrsSync,
  waitForOrdSync,
  waitForOrdStockSync,
  rpc,
  mineBlocks,
  installContextErrorGuard,
  launchOfflineContext,
  regtestServiceUrls,
} from 'ordpool-sdk/e2e';

/**
 * E2E (regtest) - the UNKNOWN-CONTENT cell of the funding guard.
 *
 * A coin whose content nobody could check is never auto-spent, on any wallet
 * topology, and the warning says that the scan got no answer rather than that
 * the coin carries an asset. Regtest produces that state without stopping any
 * service: an UNCONFIRMED coin. electrs lists it at once, while both ords
 * answer its `/output` with `indexed: false` and `sat_ranges: null`, which the
 * SDK's scanner reads as not indexed (scan failed). Mining the block then
 * makes the same coin scannable, which is what the warning's Retry scan is for.
 *
 * The wallet is a watch-only tpub on its OWN account path, so its receive #0
 * is not the address the xpub mint and inscribe specs fund (`m/86'/1'/7'`).
 * The premise guard asserts the pool is exactly the one unconfirmed coin
 * before the page reads anything: a stray clean coin would turn the state
 * into `auto` and the warning assertions would test nothing.
 */

const FRONTEND_URL = regtestServiceUrls().app;
const MINT_PATH = '/cat21-mint';

/** Its own account, so the funded receive address is fresh on every lane. */
const ACCOUNT_PATH = "m/86'/1'/21'";
const FUND_AMOUNT_BTC = '0.001';
const FUND_AMOUNT_SATS = 100_000;

/** The bitcoind wallet the SDK's bootstrap creates and its helpers spend from. */
const RPC_WALLET_ARG = `-rpcwallet=${process.env.REGTEST_WALLET ?? 'ordpool-e2e'}`;

const RESULTS_DIR = path.resolve(__dirname, '../../test-results');

let context: BrowserContext;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  if (p.isClosed()) return;
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `funding-guard-unknown-content-xpub-${name}.png`),
    fullPage: true,
  });
}

// Fails the test on any console.error or uncaught exception of an app page.
let errorGuard: ReturnType<typeof installContextErrorGuard> | undefined;

test.afterEach(() => {
  if (!errorGuard) throw new Error('browser-error guard was never installed');
  errorGuard.assertClean();
});

test.beforeAll(async () => {
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). The SDK's bootstrap should have mined past coinbase maturity.`);
  }
  context = await launchOfflineContext({ name: 'xpub-unknown-content', headless: false, options: { viewport: { width: 1280, height: 900 } } });
  errorGuard = installContextErrorGuard(context);
});

test.afterAll(async () => {
  await context?.close();
});

test('an unconfirmed funding coin blocks with the unknown-content warning, and Retry scan re-reads it once confirmed (watch-only xpub)', async () => {
  // ─── 1. Fund a fresh watch-only address with an UNCONFIRMED coin ─────
  const account = makeWatchOnlyTestAccount({ accountPath: ACCOUNT_PATH });
  const paymentAddress = account.addressAt(0);
  expect(paymentAddress).toMatch(/^bcrt1p/);
  expect(await getUtxos(paymentAddress), 'the fresh account address must start empty').toEqual([]);

  const fundingTxid = rpc(RPC_WALLET_ARG, 'sendtoaddress', paymentAddress, FUND_AMOUNT_BTC);
  const coin = await waitForUtxoMatching(
    paymentAddress,
    (u) => u.txid === fundingTxid && !u.status.confirmed,
    `unconfirmed txid=${fundingTxid}`,
  );
  expect(coin.value).toBe(FUND_AMOUNT_SATS);
  const pool = await getUtxos(paymentAddress);
  expect(pool.map((u) => `${u.txid}:${u.vout}`), 'unknown-content premise: the only coin is the unconfirmed one').toEqual([`${coin.txid}:${coin.vout}`]);
  console.log(`[unknown-content] unconfirmed coin ${coin.txid}:${coin.vout} at ${paymentAddress}`);

  // ─── 2. Open /cat21-mint, connect the watch-only (xpub) wallet ───────
  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const connectTrigger = page.getByTestId('connect-wallet-trigger').first();
  await expect(connectTrigger).toBeVisible();
  await connectTrigger.click();
  await page.getByTestId('wallet-connect-xpub').click();
  await page.getByTestId('xpub-connect-input').fill(account.accountExtendedPublicKey);
  await page.getByTestId('xpub-connect-scan').click();
  const scriptType = page.getByTestId('xpub-script-type');
  await expect(scriptType).toBeVisible();
  await scriptType.selectOption({ label: 'Taproot (P2TR), recommended for cats' });
  await page.getByTestId('xpub-connect-scan').click();
  const confirmXpub = page.getByTestId('xpub-connect-confirm');
  await expect(confirmXpub).toBeVisible();
  await confirmXpub.click();

  const feeRateInput = page.getByTestId('cat21-fee-rate');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');

  // ─── 3. Unknown content: warning says why, CTA disabled, no badge ────
  const warning = page.getByTestId('funding-warning');
  await expect(warning).toHaveAttribute('data-cause', 'unknown-content');
  await expect(warning).toContainText("we couldn't check what the coins big enough to cover the fee are carrying, because the scan got no answer");
  await expect(page.getByTestId('mint-cat-button')).toBeDisabled();
  await page.locator('summary', { hasText: 'Choose a different funding source' }).click();
  const row = page.locator('.shape-border', { hasText: `${coin.txid}:${coin.vout}` });
  await expect(row.locator('.utxo-bucket-badge')).toHaveText('scan failed');
  await expect(page.getByTestId('utxo-recommended')).toHaveCount(0);
  await shot(page, '01-unknown-content');

  // ─── 4. Confirm the coin, then Retry scan from the warning ───────────
  const tip = mineBlocks(1);
  await waitForElectrsSync(tip);
  await waitForOrdStockSync(tip);
  await waitForOrdSync(tip);
  await page.getByTestId('funding-warning-retry').click();

  // The scan now answers. Which verdict depends on the sat bitcoind's send
  // handed this coin (a block's first sat is a rare sat), not on the page,
  // so the assertion is that the coin left `scan failed` for a scan verdict.
  await expect(row.locator('.utxo-bucket-badge')).toHaveText(/^(✓ safe|⚠ asset found)$/);
  await expect(page.getByTestId('funding-warning').and(page.locator('[data-cause="unknown-content"]'))).toHaveCount(0);
  await shot(page, '02-after-retry');
});
