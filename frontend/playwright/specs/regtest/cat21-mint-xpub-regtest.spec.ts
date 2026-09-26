/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';

import { Cat21ParserService, DigitalArtifactType } from 'ordpool-parser';

import {
  makeWatchOnlyTestAccount,
  fundCommonSats,
  waitForElectrsSync,
  waitForTxConfirmed,
  rpc,
  mineBlocks,
} from 'ordpool-sdk/e2e';

/**
 * E2E (regtest cat21-mint) - ordpool /cat21-mint with a WATCH-ONLY (xpub) wallet.
 *
 * The watch-only sibling of the cat21-mint wallet matrix, and the second cell
 * proving the in-page PSBT export/paste bridge (the first is the xpub /inscribe
 * spec). No browser extension: the wallet is a pasted account extended public
 * key, signed OUTSIDE the browser and pasted back.
 *
 *   1. Derive the watch-only account; fund its receive #0, sync electrs + ords.
 *   2. Open /cat21-mint, connect via the paste-an-xpub picker (tpub is
 *      script-type-ambiguous, so scan once, pick Taproot by label, scan again).
 *      Assert the derived ordinals address IS receive #0 - the helper is the
 *      oracle for "the right script type was selected". Confirm -> connect.
 *   3. Pin the fee, wait for Mint (the >50k funding coin is auto-picked).
 *   4. Click Mint. The page builds the mint PSBT and opens the export dialog
 *      instead of an extension popup. Sign the exported PSBT with the offline
 *      account key, paste it back, finalize & broadcast.
 *   5. Mine, confirm, assert a well-formed CAT-21 on-chain: nLockTime=21,
 *      RBF-safe input sequence (>= 0xfffffffe, third-party sequence - xpub is
 *      not cat21wallet), 546-sat cat output, and parses through
 *      Cat21ParserService.
 *
 * The node is the oracle: a PSBT signed with the wrong child key finalizes and
 * yields an unspendable tx, so bitcoind accepting the broadcast and the cat
 * confirming proves the signature is real.
 *
 * Intentionally CI-only (the config refuses to run it locally). Needs NO wallet
 * .crx - just the regtest stack + the in-page export/paste bridge.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/cat21-mint';

// >50k sats: over AUTO_SCAN_MAX_VALUE_SAT, so the orchestrator treats the coin
// as unscanned and auto-picks it, enabling Mint without a manual UTXO pick.
const FUND_AMOUNT_BTC = 0.001;

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  if (p.isClosed()) return;
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21-mint-xpub-regtest-${name}.png`),
    fullPage: true,
  });
}

test.beforeAll(async () => {
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(
      `regtest tip is ${tip} (<101). The SDK's regtest-bootstrap should have ` +
      'mined past coinbase maturity before this spec ran.',
    );
  }
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    viewport: { width: 1280, height: 900 },
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('cat21-mint round-trip on regtest via the Angular /cat21-mint page + watch-only xpub', async () => {
  test.setTimeout(420_000);

  // ─── 1. Derive the watch-only account + fund receive #0 ────────
  const account = makeWatchOnlyTestAccount();
  const accountTpub = account.accountExtendedPublicKey;
  const paymentAddress = account.addressAt(0);
  console.log(`[cat21-mint-xpub] account tpub=${accountTpub.slice(0, 12)}... payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1p/);

  // Fund on COMMON (mid-block) sats via the SDK harness faucet, NOT a raw
  // sendtoaddress: with --index-sats the coinbase boundary sat is an uncommon
  // rare sat, so a plain send can hand this ONE-ADDRESS (xpub) wallet a coin the
  // funding-safety scan correctly flags as asset-bearing, which disables the CTA
  // (expert-required) and makes this lane roll dice run to run. fundCommonSats
  // spends one mature input with the boundary sat absorbed into vout-0 change so
  // the payment inherits common sats, then mines and waits for electrs + BOTH ord
  // instances to index the funding block.
  console.log(`[cat21-mint-xpub] funding ${paymentAddress} with ${FUND_AMOUNT_BTC} BTC on common sats`);
  await fundCommonSats(paymentAddress, FUND_AMOUNT_BTC);

  // ─── 2. Open /cat21-mint, connect the watch-only (xpub) wallet ─
  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, '01-page-loaded');

  const connectTrigger = page.getByTestId('connect-wallet-trigger').first();
  await expect(connectTrigger).toBeVisible({ timeout: 30_000 });
  await connectTrigger.click();

  await page.getByTestId('wallet-connect-xpub').click({ timeout: 20_000 });
  await page.getByTestId('xpub-connect-input').fill(accountTpub);
  await shot(page, '02-xpub-pasted');

  // tpub is script-type-ambiguous: the first scan reveals the selector. Pick
  // Taproot by LABEL (not position: a reorder would silently pick a different
  // script type deriving a different address family), then scan again.
  await page.getByTestId('xpub-connect-scan').click();
  const scriptType = page.getByTestId('xpub-script-type');
  await expect(scriptType).toBeVisible({ timeout: 20_000 });
  await scriptType.selectOption({ label: 'Taproot (P2TR), recommended for cats' });
  await page.getByTestId('xpub-connect-scan').click();
  await shot(page, '03-scanned');

  const confirmXpub = page.getByTestId('xpub-connect-confirm');
  await expect(confirmXpub).toBeVisible({ timeout: 30_000 });

  // Positive assertion at the point of the selection mistake: the derived
  // ordinals address must be the account's receive #0. The expected value is a
  // LITERAL a human transcribed and verified against makeWatchOnlyTestAccount
  // (fixed seed, m/86'/1'/7', keypath-only p2tr), NOT re-derived from the SDK:
  // comparing the page's SDK-derived address against the SDK's own addressAt(0)
  // is the derivation checked against itself, and a bug in it agrees on both
  // sides. Against a typed literal the page's derivation has an independent
  // oracle (drifts loudly if the helper's seed/path changes). shortenString:14
  // renders first7...last7 - assert the HEAD (bcrt1p vs bcrt1q, the family
  // discriminator a wrong script type flips) and the TAIL (exact identity).
  const EXPECTED_ORDINALS_ADDRESS = 'bcrt1pkh944sywa9czctjzzet5f29v97p4pgrr2p0sp6xcktf3k5ryxxwq9an3c0';
  const shownOrdinals = (await page.getByTestId('xpub-ordinals-address').textContent()) ?? '';
  expect(shownOrdinals).toContain(EXPECTED_ORDINALS_ADDRESS.slice(0, 7));
  expect(shownOrdinals).toContain(EXPECTED_ORDINALS_ADDRESS.slice(-7));

  await confirmXpub.click();
  await shot(page, '04-connected');

  // ─── 3. Pin the fee, wait for Mint ─────────────────────────────
  // getUtxos fired on connect and already sees the pre-funded coin.
  const feeRateInput = page.locator('[data-testid="cat21-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  const mintBtn = page.getByTestId('mint-cat-button');
  await expect(mintBtn).toBeEnabled({ timeout: 60_000 });
  await shot(page, '05-ready-to-mint');

  // ─── 4. Mint -> export dialog -> offline-sign -> paste ─────────
  await mintBtn.click();

  const unsignedField = page.locator('[data-testid="psbt-export-unsigned"]');
  await expect(unsignedField).toBeVisible({ timeout: 60_000 });
  const unsignedBase64 = (await unsignedField.inputValue()).trim();
  expect(unsignedBase64.length).toBeGreaterThan(0);
  console.log(`[cat21-mint-xpub] exported unsigned PSBT (${unsignedBase64.length} b64 chars)`);
  await shot(page, '06-export-dialog');

  const signedBase64 = account.signExportedPsbt(unsignedBase64);
  await page.locator('[data-testid="psbt-export-signed"]').fill(signedBase64);
  await page.locator('[data-testid="psbt-export-submit"]').click();
  await shot(page, '07-signed-submitted');

  // ─── 5. Success card -> broadcast txid ─────────────────────────
  const successAlert = page.locator('.alert.alert-success').first();
  await expect(successAlert).toBeVisible({ timeout: 120_000 });
  const successHref = await successAlert.locator('a').first().getAttribute('href');
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];
  console.log(`[cat21-mint-xpub] mint txid=${broadcastTxid}`);
  await shot(page, '08-success');

  // ─── 6. Mine, confirm, assert a well-formed CAT-21 on-chain ────
  await waitForElectrsSync(mineBlocks(1));
  const esploraTx = await waitForTxConfirmed(broadcastTxid);
  expect(esploraTx.locktime).toBe(21);
  expect(esploraTx.status.block_hash).toBeTruthy();
  // RBF prevention: every input sequence >= 0xfffffffe (third-party sequence;
  // xpub is not cat21wallet, so it gets 0xfffffffe, not 0xfffffffd).
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
