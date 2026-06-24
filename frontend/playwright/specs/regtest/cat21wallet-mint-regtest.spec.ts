/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { Cat21ParserService, DigitalArtifactType } from 'ordpool-parser';

import {
  getUtxos,
  waitForElectrsSync,
  rpc,
  mineBlocks,
  getTx,
} from './sdk-lib/regtest-helpers';
import { waitForApprovalPopup } from './sdk-lib/approval-popup';

/**
 * E2E (regtest mint) — ordpool /cat21-mint via CAT-21 wallet
 *
 * Mirrors the Xverse mint-regtest spec for the new CAT-21 wallet
 * connector that landed in the SDK at commit 59aa430. CAT-21 wallet
 * is OUR own Leather fork; its CAT-21 mint flow differs from Xverse's
 * in two material ways the test pins:
 *
 *   1. RBF policy: CAT-21 wallet IS allowed to signal RBF
 *      (`sequence === 0xfffffffd`). Xverse and every other third-
 *      party wallet pin `sequence >= 0xfffffffe`. The rule lives in
 *      `ordpool-sdk/src/cat21-mint/cat21.service.helper.ts`; the wallet
 *      contract is HARD RULE #1 in `cat21-wallet/CLAUDE.md` (its
 *      mempool-acceleration UI guarantees `nLockTime=21` is preserved
 *      on any RBF replacement). See the workspace CLAUDE.md table for
 *      the per-wallet rationale.
 *
 *   2. Onboarding: BIP-39 mnemonic restore from a fresh extension
 *      load, not a cloned seed user-data-dir. The cat21-wallet
 *      onboarding sequence (sign-in-link → 12 inputs → password →
 *      dashboard) lives in `ordpool-sdk/e2e/playwright/specs/
 *      cat21wallet-onboard.spec.ts`; this spec embeds it inline as
 *      the beforeAll primer so the round-trip is self-contained.
 *
 * Scope of THIS iteration: confirm cat21-wallet is wired into the
 * frontend picker AND the connect approval flow round-trips end to
 * end. The full mint round-trip (PSBT build → signPsbt → broadcast)
 * has a known regtest-address-derivation gap — cat21-wallet returns
 * MAINNET bc1q from `getAddresses` regardless of the dapp's network
 * request, while the orchestrator-built PSBT is keyed to bcrt1q on
 * regtest. The SDK's own `cat21wallet-mint-roundtrip.spec.ts` works
 * around this by deriving bcrt1q/bcrt1p from the same pubkey via a
 * custom harness (`deriveRegtestAddresses`) — wiring that into the
 * consumer-driven flow is a separate piece of work tracked alongside
 * this spec.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4200';
const MINT_PATH = '/cat21-mint';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// CAT-21 wallet's password-strength meter (zxcvbn) rates the shared
// `TestPassword123!` as "Poor" and refuses to enable Continue. Use a
// longer high-entropy passphrase per the SDK onboard spec.
const TEST_PASSWORD = 'correct-horse-battery-staple-Tr0ub4dor-9876';

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;
// Hoisted state shared across `test()` blocks in this file. The
// persistent context's localStorage remembers the connected wallet,
// so test 2+ open a fresh page and auto-reconnect to the same
// payment address.
let sharedPaymentAddress: string | undefined;

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21wallet-mint-regtest-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

async function onboardCat21Wallet(page: Page): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/index.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sign-in-link')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('sign-in-link').click();

  // The restore screen renders 12 text inputs in order; fill each
  // with the matching mnemonic word.
  const inputs = page.locator('input[type="text"], input[type="password"]');
  await expect(inputs.first()).toBeVisible({ timeout: 15_000 });
  const words = TEST_MNEMONIC.split(' ');
  for (let i = 0; i < 12; i++) {
    await inputs.nth(i).fill(words[i]);
  }
  await page.getByRole('button', { name: /continue|sign in|restore|confirm/i }).first().click();

  // Set password screen — testid `set-or-enter-password-input` per
  // OnboardingSelectors enum in the bundle.
  const pwInput = page.getByTestId('set-or-enter-password-input');
  await expect(pwInput).toBeVisible({ timeout: 15_000 });
  await pwInput.click();
  await pwInput.pressSequentially(TEST_PASSWORD, { delay: 15 });
  await page.getByTestId('set-password-btn').click();

  // Dashboard rendered when these strings show up.
  await page.waitForFunction(() => {
    const t = (document.body.innerText || '').toLowerCase();
    return t.includes('send') || t.includes('receive') || t.includes('balance') || t.includes('bitcoin');
  }, undefined, { timeout: 30_000, polling: 250 });
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(
      `CAT-21 wallet extension not unpacked at ${EXT_PATH}. The workflow should ` +
      'have run the SDK\'s playwright-bootstrap.sh cat21wallet step.',
    );
  }

  context = await chromium.launchPersistentContext('', {
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
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  extensionId = worker.url().split('/')[2];

  // Onboard inline — no cloned seed user-data-dir.
  //
  // Keep the onboarded page open for the duration of the suite. The
  // SDK's matching `cat21wallet-mint-roundtrip.spec.ts` (which passes
  // in SDK CI) follows the same pattern. Closing the only extension
  // page after onboarding lets the wallet's service worker suspend
  // and lose the in-memory vault state; subsequent
  // `Cat21Provider.request('getAddresses', …)` calls from the dapp
  // then hang because the wallet's background never reaches
  // `triggerRequestPopupWindowOpen` (the connect approval popup
  // never spawns and the spec times out at 60 s waiting for the
  // chrome-extension://… approval window). Run 28111780727 traced
  // the click reaching `connectWallet`, the button becoming
  // disabled, and zero new chrome-extension pages being created
  // for the next 60 s — the wallet binary itself doesn't open the
  // popup when there's no other extension page to anchor the SW
  // session.
  const primer = await context.newPage();
  await onboardCat21Wallet(primer);
  await shot(primer, '00-onboarded');
});

test.afterAll(async () => {
  await context?.close();
});

test('cat21-wallet appears in the picker and the connect approval round-trips', async () => {
  test.setTimeout(180_000);

  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, '01-page-loaded');

  // CRITICAL ordering — snapshot existing pages BEFORE the connect
  // click. The Xverse spec hit this race three times before the fix
  // (workspace CLAUDE.md note on commit 49c9285). CAT-21 wallet's
  // approval popup likewise spawns synchronously from
  // sats-connect/getAddresses, so the same precaution applies.
  const knownPagesBeforeConnect = new Set(context.pages());

  // ordpool's connect link reads "connect your wallet" in the empty-
  // wallet state.
  const connectLink = page.getByRole('link', { name: /connect your wallet/i }).first();
  await expect(connectLink).toBeVisible({ timeout: 30_000 });
  await connectLink.click();

  // Picker modal — CAT-21 wallet sits in the "installed" section at
  // the top of the modal. The wallet card isn't a `<button>` — it's
  // a clickable container — so `getByRole('button', …)` doesn't find
  // it (the cat21-indexer cat21wallet artifact at run 27501072445
  // confirmed this). Match the visible label text instead; the
  // label wraps across two lines in the modal layout, so use `\s+`.
  // The ordpool picker renders the wallet name inline with its
  // description on a single line ("CAT-21 wallet Our own — hot wallet
  // for active cat trading…"), so the `$`-anchored regex misses
  // (run 27501318048 screenshot confirmed). Match by substring.
  const cat21Picker = page.getByText(/CAT-21\s+wallet/i).first();
  await expect(cat21Picker).toBeVisible({ timeout: 20_000 });
  await cat21Picker.click({ timeout: 20_000 });
  await shot(page, '02-picker-clicked');

  // Connect approval popup uses testid `get-addresses-approve-button`
  // (lifted from the SDK cat21wallet-mint-roundtrip spec).
  const approvalConnect = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeConnect,
    timeoutMs: 60_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByTestId('get-addresses-approve-button')
        .waitFor({ state: 'visible', timeout: 60_000 });
      return true;
    },
  });
  await shot(approvalConnect, '03-connect-approval');
  await approvalConnect.getByTestId('get-addresses-approve-button').click();
  // DO NOT explicitly `.close()` the popup. cat21-wallet's
  // `userApprovesGetAddresses` runs a multi-step animation
  // (contentDisappears 400 ms + originLogoAnimation) BEFORE
  // actually `chrome.tabs.sendMessage`-ing the addresses back to
  // the dapp. Closing the page mid-animation kills the message
  // dispatch and the connectedWallet$ signal never fires — the
  // page stays at "please connect your wallet" forever (observed
  // on run 27502017653 trace.zip: click at 20039 ms, manual close
  // at 20083 ms = 44 ms gap, far inside the 400 ms animation).
  // Wait for the popup to close itself.
  await approvalConnect.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);

  // Mint form renders only when `x.connectedWallet` is non-null —
  // pinning the form's presence pins that the connect callback
  // resolved cleanly.
  await page.waitForFunction(
    () => !document.body.innerText.toLowerCase().includes('please') ||
          !document.body.innerText.toLowerCase().includes('connect your wallet'),
    undefined,
    { timeout: 30_000, polling: 500 },
  );
  await shot(page, '04-connected');

  // ─── Path-1 proof: payment address is REGTEST bcrt1q ──────────
  // CAT-21 wallet's `getAddresses` now honors the `network` param
  // (SDK connector change at commit 8d91a5c: Network.Regtest →
  // 'devnet', forwarded as RPC param). The mint page's empty-state
  // hint renders the connected payment address inside
  // `<code class="bitcoin">…</code>`. Before this change it was a
  // `bc1q…` mainnet address (incompatible with the regtest electrs
  // funding path); now it must start with `bcrt1q…`. Pinning this
  // surfaces a connector regression immediately rather than
  // waiting for a downstream mint to mysteriously fail.
  const paymentCode = page.locator('code.bitcoin', { hasText: /^bcrt1q/ }).first();
  await expect(paymentCode).toBeVisible({ timeout: 60_000 });
  const paymentAddr = (await paymentCode.textContent())!.trim();
  console.log(`[cat21wallet] regtest payment address = ${paymentAddr}`);
  expect(paymentAddr).toMatch(/^bcrt1q/);
  sharedPaymentAddress = paymentAddr;

  // ─── Full mint round-trip ─────────────────────────────────────
  // Now that the wallet hands us a regtest bcrt1q address, the
  // funding + orchestrator + sign + broadcast path works the same
  // way as the Xverse flow. The wallet-side differences vs Xverse:
  //   - sign popup matches by role+name on Confirm/Sign/Approve
  //     (no stable testid yet, per the SDK's own mint-roundtrip
  //     spec)
  //   - input sequence is exactly 0xfffffffd (CAT-21 wallet RBF
  //     policy — the ONE wallet that signals RBF safely because
  //     its mempool-acceleration UI contract preserves
  //     nLockTime=21 on replacement)
  const FUND_AMOUNT_BTC = 0.001;
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddr, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[cat21wallet] funded ${paymentAddr} +${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
  const fundedTip = mineBlocks(1);
  await waitForElectrsSync(fundedTip);
  const fundUtxos = await getUtxos(paymentAddr);
  expect(fundUtxos.length).toBeGreaterThan(0);

  // Reload so the orchestrator picks up the new UTXO.
  const knownBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeReload,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }
  await shot(page, '05-after-fund-reload');

  // Set fee rate, wait for Mint button enabled.
  const feeRateInput = page.locator(
    '.input-group:has(.input-group-text:text-is("Fee rate")) input[type="number"]',
  ).first();
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  const mintButton = page.getByRole('button', { name: /mint my cat/i }).first();
  await expect(mintButton).toBeEnabled({ timeout: 60_000 });
  await shot(page, '06-ready-to-mint');

  // Click Mint, approve sign popup.
  const knownBeforeSign = new Set(context.pages());
  await mintButton.click();
  const approvalSign = await waitForApprovalPopup({
    context,
    knownPages: knownBeforeSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await shot(approvalSign, '07-sign-approval');
  await approvalSign.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
    .click({ timeout: 30_000 });
  await approvalSign.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);

  // Wait for success alert, extract broadcast txid.
  const successAlert = page.locator('.alert.alert-success').first();
  await expect(successAlert).toBeVisible({ timeout: 90_000 });
  await shot(page, '08-success');
  const successHref = await successAlert.locator('a').first().getAttribute('href');
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];
  console.log(`[cat21wallet] mint txid = ${broadcastTxid}`);

  // Mine confirmation block, verify on-chain.
  const confirmedTip = mineBlocks(1);
  await waitForElectrsSync(confirmedTip);
  const esploraTx = await getTx(broadcastTxid);
  expect(esploraTx.locktime).toBe(21);
  expect(esploraTx.status.block_hash).toBeTruthy();
  // Output 0 = cat sat at exactly 546.
  expect(esploraTx.vout.length).toBeGreaterThanOrEqual(1);
  expect(esploraTx.vout[0].value).toBe(546);
  // CAT-21 wallet RBF policy: input sequence == 0xfffffffd.
  // ONE exception to the Xverse spec's ≥0xfffffffe rule. See
  // `ordpool-sdk/src/cat21-mint/cat21.service.helper.ts` and HARD
  // RULE #1 in `cat21-wallet/CLAUDE.md` for the rationale.
  expect(esploraTx.vin.length).toBeGreaterThan(0);
  for (const vin of esploraTx.vin) {
    expect(vin.sequence).toBe(0xfffffffd);
  }
  // Parser confirms well-formed CAT-21.
  const parsed = Cat21ParserService.parse(esploraTx);
  expect(parsed).not.toBeNull();
  expect(parsed!.type).toBe(DigitalArtifactType.Cat21);
  expect(parsed!.transactionId).toBe(broadcastTxid);
  expect(parsed!.getImage()).toMatch(/^<svg/);
});

// ─── Shared mint helper ─────────────────────────────────────────
// Wraps the test-1 mint mechanic into a single call so the manual-
// override scenarios (purple-cat at 100 sat/vB, hot-mempool typing 1)
// and the asset-scanner burn-confirm path can share it.

const HIGH_FEES_PRESET = {
  fastestFee: 100,
  halfHourFee: 60,
  hourFee: 30,
  economyFee: 20,
  minimumFee: 10,
};

async function cat21walletMintAtRate(opts: {
  rate: number;
  scenarioLabel: string;
  mockFeesAsHigh?: boolean;
}): Promise<{ broadcastTxid: string; fee: number; vsize: number; rate: number; tx: { vin: { sequence: number }[]; vout: { value: number }[]; locktime: number } }> {
  if (!sharedPaymentAddress) throw new Error('first test must have set sharedPaymentAddress');

  if (opts.mockFeesAsHigh) {
    const res = await fetch('http://localhost:8999/admin/fees', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(HIGH_FEES_PRESET),
    });
    if (!res.ok) {
      throw new Error(`stub /admin/fees rejected: ${res.status} ${await res.text()}`);
    }
  }

  try {
    const FUND_BTC = 0.001;
    const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, String(FUND_BTC)).trim();
    console.log(`[${opts.scenarioLabel}] funded ${sharedPaymentAddress} +${FUND_BTC} BTC tx=${fundTxid}`);
    const tip = mineBlocks(1);
    await waitForElectrsSync(tip);

    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
    const knownBeforeReconnect = new Set(context.pages());
    const reapprove = await waitForApprovalPopup({
      context,
      knownPages: knownBeforeReconnect,
      timeoutMs: 6_000,
      isApproval: async (p) => p.url().startsWith('chrome-extension://'),
    }).catch(() => null);
    if (reapprove) {
      await reapprove.getByTestId('get-addresses-approve-button')
        .click({ timeout: 10_000 }).catch(() => undefined);
      await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
    }
    await shot(page, `mr-${opts.scenarioLabel}-01-loaded`);

    // Sanity-check the picker if we mocked fees.
    if (opts.mockFeesAsHigh) {
      const tiles = page.locator('.fee-estimation-container .item a');
      await expect(tiles).toHaveCount(4, { timeout: 30_000 });
      await expect(tiles.nth(3)).toContainText('100', { timeout: 10_000 });
    }

    const feeRateInput = page.locator(
      '.input-group:has(.input-group-text:text-is("Fee rate")) input[type="number"]',
    ).first();
    await feeRateInput.fill(String(opts.rate));
    await feeRateInput.press('Tab');
    await shot(page, `mr-${opts.scenarioLabel}-02-rate-typed`);

    const mintBtn = page.getByRole('button', { name: /mint my cat/i }).first();
    await expect(mintBtn).toBeEnabled({ timeout: 60_000 });

    const knownBeforeSign = new Set(context.pages());
    await mintBtn.click();
    const approvalSign = await waitForApprovalPopup({
      context,
      knownPages: knownBeforeSign,
      timeoutMs: 120_000,
      isApproval: async (p) => {
        if (!p.url().startsWith('chrome-extension://')) return false;
        await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
          .waitFor({ state: 'visible', timeout: 120_000 });
        return true;
      },
    });
    await shot(approvalSign, `mr-${opts.scenarioLabel}-03-sign`);
    await approvalSign.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
      .click({ timeout: 30_000 });
    await approvalSign.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);

    const successAlert = page.locator('.alert.alert-success').first();
    await expect(successAlert).toBeVisible({ timeout: 90_000 });
    await shot(page, `mr-${opts.scenarioLabel}-04-success`);
    const successHref = await successAlert.locator('a').first().getAttribute('href');
    const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
    expect(txidMatch).not.toBeNull();
    const broadcastTxid = txidMatch![1];

    const confTip = mineBlocks(1);
    await waitForElectrsSync(confTip);
    const tx = await getTx(broadcastTxid);
    expect(tx.locktime).toBe(21);
    expect(tx.vout.length).toBeGreaterThanOrEqual(1);
    expect(tx.vout[0].value).toBe(546);
    for (const vin of tx.vin) {
      expect(vin.sequence).toBe(0xfffffffd);
    }
    const parsed = Cat21ParserService.parse(tx);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe(DigitalArtifactType.Cat21);
    const vsize = Math.ceil(tx.weight / 4);
    const rate = tx.fee / vsize;
    console.log(`[${opts.scenarioLabel}] fee=${tx.fee} sat, vsize=${vsize} vB, rate=${rate.toFixed(3)} sat/vB (target ${opts.rate})`);

    await page.close().catch(() => undefined);
    return { broadcastTxid, fee: tx.fee, vsize, rate, tx };
  } finally {
    if (opts.mockFeesAsHigh) {
      await fetch('http://localhost:8999/admin/fees/reset', { method: 'POST' })
        .catch(() => undefined);
    }
  }
}

/**
 * Asset-scanner → burn-confirm via CAT-21 wallet.
 *
 * Same mechanic as the Xverse burn-confirm: fund a small UTXO,
 * mock `/output/<outpoint>` with `cats: [0]` so the auto-scanner
 * marks the row as `assets`, click "Use anyway", complete the mint.
 * Verify the cat-mocked outpoint is spent as input on-chain.
 */
test('asset scanner: warned cat-bearing UTXO can be burned via "Use anyway"', async () => {
  test.setTimeout(420_000);
  if (!sharedPaymentAddress) throw new Error('first test must have set sharedPaymentAddress');

  const SMALL_FUND_SATS = 15_000;
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, '0.00015').trim();
  await waitForElectrsSync(mineBlocks(1));
  let small: { txid: string; vout: number; value: number } | undefined;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    small = (await getUtxos(sharedPaymentAddress)).find(
      (u) => u.value === SMALL_FUND_SATS && u.txid === fundTxid,
    );
    if (small) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!small) throw new Error('could not find the small-funding UTXO');
  const catOutpoint = `${small.txid}:${small.vout}`;
  console.log(`[as] cat-bearing outpoint = ${catOutpoint}`);

  const page = await context.newPage();
  await page.route('**/output/*', async (route) => {
    const url = route.request().url();
    const isCatTarget = url.includes(catOutpoint);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(
        isCatTarget
          ? { inscriptions: [], runes: {}, cats: [0], sat_ranges: [[1_000_000, 1_000_001]] }
          : { inscriptions: [], runes: {}, cats: [] },
      ),
    });
  });
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const knownReconnect = new Set(context.pages());
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownReconnect,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }

  // Open the picker.
  const pickerSummary = page.locator('details > summary', { hasText: /choose a different funding source/i }).first();
  await expect(pickerSummary).toBeVisible({ timeout: 60_000 });
  await pickerSummary.click();

  // Nudge the orchestrator to re-emit so the post-scan bucket renders.
  // (The Xverse spec confirmed this is needed because the cat21-mint
  // component reads scanStates via combineLatest now — but it's a
  // cheap belt-and-braces.)
  const feeRateInput = page.locator(
    '.input-group:has(.input-group-text:text-is("Fee rate")) input[type="number"]',
  ).first();
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');

  // Asset-found badge appears.
  const assetBadge = page.locator('.badge.bg-danger', { hasText: /asset found/i }).first();
  await expect(assetBadge).toBeVisible({ timeout: 30_000 });
  await shot(page, 'as-asset-badge');

  const assetRow = page.locator('.utxo-row-assets').filter({ hasText: catOutpoint }).first();
  const overrideBtn = assetRow.getByRole('button', { name: /use anyway/i });
  await overrideBtn.click();
  const mintBtn = page.getByRole('button', { name: /mint my cat/i }).first();
  await expect(mintBtn).toBeEnabled({ timeout: 30_000 });

  const knownSign = new Set(context.pages());
  await mintBtn.click();
  const sign = await waitForApprovalPopup({
    context,
    knownPages: knownSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await sign.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
    .click({ timeout: 30_000 });
  await sign.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);

  const successAlert = page.locator('.alert.alert-success').first();
  await expect(successAlert).toBeVisible({ timeout: 90_000 });
  const successHref = await successAlert.locator('a').first().getAttribute('href');
  const broadcastTxid = successHref!.match(/\/tx\/([0-9a-f]{64})/)![1];
  await waitForElectrsSync(mineBlocks(1));
  const tx = await getTx(broadcastTxid);
  expect(tx.locktime).toBe(21);
  expect(tx.vout[0].value).toBe(546);
  for (const vin of tx.vin) {
    expect(vin.sequence).toBe(0xfffffffd);
  }
  const spentCat = tx.vin.some(
    (v: { txid: string; vout: number }) => `${v.txid}:${v.vout}` === catOutpoint,
  );
  expect(spentCat).toBe(true);
});

test('manual override: typing 100 mints a "purple cat" via CAT-21 wallet', async () => {
  test.setTimeout(420_000);
  const { rate } = await cat21walletMintAtRate({ rate: 100, scenarioLabel: 'purple' });
  expect(Math.abs(rate - 100)).toBeLessThan(1);
});

test('manual override: typing 1 while the picker suggests 100 — low rate wins on CAT-21 wallet', async () => {
  test.setTimeout(420_000);
  const { rate } = await cat21walletMintAtRate({ rate: 1, scenarioLabel: 'hot-mempool', mockFeesAsHigh: true });
  expect(Math.abs(rate - 1)).toBeLessThan(1);
});

test('sign-popup cancel keeps state coherent on CAT-21 wallet', async () => {
  test.setTimeout(180_000);
  if (!sharedPaymentAddress) throw new Error('first test must have set sharedPaymentAddress');
  rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, '0.0003');
  await waitForElectrsSync(mineBlocks(1));

  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const knownReconnect = new Set(context.pages());
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownReconnect,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }

  const feeRateInput = page.locator(
    '.input-group:has(.input-group-text:text-is("Fee rate")) input[type="number"]',
  ).first();
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  const mintBtn = page.getByRole('button', { name: /mint my cat/i }).first();
  await expect(mintBtn).toBeEnabled({ timeout: 60_000 });

  const knownSign = new Set(context.pages());
  await mintBtn.click();
  const sign = await waitForApprovalPopup({
    context,
    knownPages: knownSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  // Click Deny/Cancel/Reject — CAT-21 wallet's Leather-fork sign
  // popup ships a "Deny"-labelled outline button next to the
  // primary Confirm. Match permissively. Catch any "page closed"
  // race — the popup may self-close from the click before
  // Playwright's click action completes (observed on
  // run 27509961259), which throws but doesn't actually mean the
  // click was ineffective. What matters is the post-condition:
  // success alert must NOT appear.
  await sign.getByRole('button', { name: /^(deny|cancel|reject)$/i }).first()
    .click({ timeout: 10_000 }).catch(() => undefined);
  await sign.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);

  await page.waitForTimeout(2_000);
  await expect(page.locator('.alert.alert-success')).toHaveCount(0);
});

test('broadcast failure surfaces as an error on CAT-21 wallet (not a fake success)', async () => {
  test.setTimeout(240_000);
  if (!sharedPaymentAddress) throw new Error('first test must have set sharedPaymentAddress');
  rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', sharedPaymentAddress, '0.0003');
  await waitForElectrsSync(mineBlocks(1));

  const page = await context.newPage();
  await page.route('**/api/tx', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 400,
        contentType: 'text/plain',
        headers: { 'access-control-allow-origin': '*' },
        body: 'test-induced broadcast rejection: bad-txns-inputs-missingorspent',
      });
      return;
    }
    await route.continue();
  });
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  const knownReconnect = new Set(context.pages());
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownReconnect,
    timeoutMs: 6_000,
    isApproval: async (p) => p.url().startsWith('chrome-extension://'),
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByTestId('get-addresses-approve-button')
      .click({ timeout: 10_000 }).catch(() => undefined);
    await reapprove.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);
  }

  const feeRateInput = page.locator(
    '.input-group:has(.input-group-text:text-is("Fee rate")) input[type="number"]',
  ).first();
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  const mintBtn = page.getByRole('button', { name: /mint my cat/i }).first();
  await expect(mintBtn).toBeEnabled({ timeout: 60_000 });

  const knownSign = new Set(context.pages());
  await mintBtn.click();
  const sign = await waitForApprovalPopup({
    context,
    knownPages: knownSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await sign.getByRole('button', { name: /^(confirm|sign|approve)$/i }).first()
    .click({ timeout: 30_000 });
  await sign.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);

  const errorAlert = page.locator('.alert.alert-danger, .alert-danger').first();
  await expect(errorAlert).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.alert.alert-success')).toHaveCount(0);
});
