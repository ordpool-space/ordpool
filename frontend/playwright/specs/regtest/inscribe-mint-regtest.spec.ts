/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { InscriptionParserService } from 'ordpool-parser';

// Shared regtest helpers + approval-popup machinery, single-sourced from
// the SDK's compiled `ordpool-sdk/e2e` barrel.
import {
  waitForUtxoAt,
  waitForElectrsSync,
  waitForTxConfirmed,
  rpc,
  mineBlocks,
  getTx,
  waitForApprovalPopup,
} from 'ordpool-sdk/e2e';

/**
 * E2E (regtest inscribe) - ordpool /inscribe
 *
 * Drives the real Angular `/inscribe` page through a complete single-file
 * inscription round-trip with the real Xverse extension:
 *
 *   1. Launch Chromium headed under xvfb with the cached Xverse `.crx`
 *      loaded (seed `user-data-dir` from the SDK's global-setup, already
 *      switched to Bitcoin Regtest against the local electrs URL).
 *   2. Unlock the vault with the SDK's TEST_PASSWORD.
 *   3. Navigate to /inscribe, click "connect your wallet", approve the
 *      Xverse connect popup, read the payment address from the rendered
 *      "could not find enough funds" hint.
 *   4. Fund the payment address, mine, wait for electrs, reload so the
 *      orchestrator re-fetches UTXOs.
 *   5. Drop the fixture file on the dropzone (a tiny SVG), pin the fee
 *      rate, wait for the "Inscribe my file" button to enable.
 *   6. Click it, approve the ONE Xverse sign popup (only the commit
 *      funding input is wallet-signed - the reveal is finalized inside
 *      the orchestrator with an ephemeral key it then zeroes). The page
 *      broadcasts commit + reveal sequentially via POST /api/tx.
 *   7. Read the reveal txid off the success panel, mine, confirm, and
 *      assert the on-chain reveal is a well-formed inscription: parses
 *      through `InscriptionParserService`, carries a `content_encoding`
 *      tag (`br` or `gzip` - the page compresses by default and picks the
 *      smaller; the SVG clears the 5% margin), the on-chain body is real
 *      compressed bytes (smaller than the fixture) that DECODE back
 *      byte-identically to the fixture, has the right content-type, and
 *      (the CAT-21 side-effect the wallet convention adds) carries
 *      locktime=21 on both commit and reveal.
 *
 * The compress-on-the-page → decode-off-chain roundtrip is the acceptance
 * criterion. Because an inscription is immutable, a compressor that didn't
 * decode back would corrupt it forever, so we verify the decode explicitly.
 *
 * Intentionally CI-only (the workflow downloads the unverified Xverse
 * .crx into a runner that gets torn down). The config refuses to run it
 * locally - see `playwright.regtest.config.ts`.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/inscribe';
const TEST_PASSWORD = 'TestPassword123!';

// In regtest, 1 BTC = 100M sats. 0.001 BTC (100,000 sats) is plenty for
// the two 546-sat inscription outputs + commit/reveal miner fees at any
// reasonable rate, and large enough that auto-pick lands on it as the
// only viable row.
const FUND_AMOUNT_BTC = 0.001;
const FUND_AMOUNT_SATS = Math.round(FUND_AMOUNT_BTC * 1e8);

// The inscription fixture: a tiny SVG. detectMimeType() sniffs the
// `<svg` prefix and reports image/svg+xml, so that is the content-type
// the envelope carries and the parser must recover. Byte-identical
// recovery of these exact bytes is the acceptance criterion.
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/inscribe-probe.svg');
const EXPECTED_CONTENT_TYPE = 'image/svg+xml';
const EXPECTED_BODY = fs.readFileSync(FIXTURE_PATH);

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.XVERSE_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/xverse');
const SEED_USER_DATA_DIR =
  process.env.XVERSE_SEED_USER_DATA_DIR
  ?? path.resolve(__dirname, '../../../test-results/xverse-seed-user-data-dir');

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;

// File-scope serial mode: the single round-trip below owns its connected
// wallet + funded UTXO on regtest. Serial mode keeps behaviour identical
// to the sibling cat21-mint spec.
test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `inscribe-mint-regtest-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(
      `Xverse extension not unpacked at ${EXT_PATH}. The workflow should ` +
      'have run the SDK\'s playwright-bootstrap.sh to populate it.',
    );
  }
  if (!fs.existsSync(path.join(SEED_USER_DATA_DIR, 'Default'))) {
    throw new Error(
      `Xverse seed user-data-dir missing at ${SEED_USER_DATA_DIR}. The SDK's ` +
      'global-setup should have produced it before this spec ran.',
    );
  }
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(`inscription fixture missing at ${FIXTURE_PATH}`);
  }

  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(
      `regtest tip is ${tip} (<101). The SDK's regtest-bootstrap.sh should ` +
      'have mined past coinbase maturity before this spec ran.',
    );
  }

  // Clone the seed user-data-dir so we don't mutate the original - the
  // suite may retry, and a partially-onboarded vault from a prior run
  // would poison the unlock step.
  const workingDir = `${SEED_USER_DATA_DIR}.inscribepage-${process.pid}-${Date.now()}`;
  fs.cpSync(SEED_USER_DATA_DIR, workingDir, { recursive: true });
  for (const stale of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    fs.rmSync(path.join(workingDir, stale), { force: true });
  }

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
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  extensionId = worker.url().split('/')[2];
});

test.afterAll(async () => {
  await context?.close();
});

test('inscribe round-trip on regtest via the Angular /inscribe page + Xverse', async () => {
  test.setTimeout(420_000); // 7 min - wallet popups + commit/reveal + blocks

  // ─── 1. Unlock the vault ───────────────────────────────────────
  const primer = await context.newPage();
  await primer.setViewportSize({ width: 400, height: 800 });
  await primer.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await primer.waitForFunction(() => {
    const t = (document.body.innerText || '').toLowerCase();
    return t.includes('unlock') || t.includes('account 1');
  }, undefined, { timeout: 30_000, polling: 250 });
  if (/unlock/i.test(await primer.locator('body').innerText())) {
    await primer.locator('input[type="password"]').first().fill(TEST_PASSWORD);
    await primer.getByRole('button', { name: /^unlock$/i }).first().click();
    await primer.waitForFunction(() => {
      const t = (document.body.innerText || '').toLowerCase();
      return t.includes('account 1') || t.includes('not now') || t.includes('zest') || t.includes('send');
    }, undefined, { timeout: 30_000, polling: 250 });
  }
  const notNow = primer.getByText('Not now', { exact: true }).first();
  if (await notNow.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await notNow.click({ force: true }).catch(() => undefined);
  }
  await shot(primer, '01-unlocked');
  await primer.close();

  // ─── 2. Open /inscribe, click Connect, approve in Xverse ───────
  const page = await context.newPage();
  // Funding-safety force-scan (the SDK orchestrator's fundingRecommendation$)
  // probes ord `/output/<outpoint>` for every covering candidate, regardless of
  // size. On regtest those outpoints don't exist at the prod ord hosts baked into
  // the frontend, so without a mock they 404 -> the funding coin lands in the
  // `failed` bucket -> the SDK refuses to safe-auto-fund and the Inscribe button
  // stays disabled. The regtest funding coin is a plain payment, so classify every
  // outpoint clean. `**/output/*` matches both ord URLs (ord.ordpool.space +
  // ord.cat21.space) the SDK queries in parallel.
  await page.route('**/output/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ inscriptions: [], runes: {}, cats: [] }),
    });
  });
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, '02-page-loaded');

  // The pre-connect prompt renders a "connect your wallet" link that
  // calls WalletService.requestWalletConnect() → the ngb-modal picker.
  const connectLink = page.getByRole('link', { name: /connect your wallet/i }).first();
  await expect(connectLink).toBeVisible({ timeout: 30_000 });

  const knownPagesBeforeConnect = new Set(context.pages());
  await connectLink.click();
  // Picker: pick Xverse via the per-wallet Connect button's stable testid.
  await page.getByTestId('wallet-connect-xverse')
    .click({ timeout: 20_000 });
  await shot(page, '03-picker-clicked');

  const approvalConnect = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeConnect,
    timeoutMs: 60_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.waitForFunction(() => {
        const t = (document.body.innerText || '').toLowerCase();
        return ['connect', 'approve', 'confirm', 'allow'].some((s) => t.includes(s));
      }, undefined, { timeout: 60_000, polling: 500 });
      return true;
    },
  });
  await shot(approvalConnect, '04-connect-approval');
  await approvalConnect.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
    .first().click();
  // Closing the connect popup forces Xverse to open a FRESH tab for the
  // sign step later - same dance the cat21-mint + SDK roundtrip specs use.
  await approvalConnect.close().catch(() => undefined);

  // ─── 3. Read the payment address from the empty-state hint ─────
  // With no funds yet, the form renders the "We could not find enough
  // funds … Fund <code class="bitcoin">…</code>" hint. Read the address
  // verbatim - no SDK testHooks required.
  const paymentCode = page.locator('code.bitcoin', { hasText: /^(bcrt1q|bcrt1p|3|tb1q|2)/ }).first();
  await expect(paymentCode).toBeVisible({ timeout: 60_000 });
  const paymentAddress = (await paymentCode.textContent())!.trim();
  console.log(`[inscribe-page] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1q/);

  // ─── 4. Fund the payment address, mine, wait for electrs ──────
  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddress, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[inscribe-page] funded ${paymentAddress} with ${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
  await waitForElectrsSync(mineBlocks(1));

  // Poll the address→utxo index until the funding UTXO is visible.
  // waitForElectrsSync only confirms the block HEIGHT; electrs indexes
  // the address→utxo mapping a tick later, so an immediate getUtxos can
  // miss the fresh output.
  await waitForUtxoAt(paymentAddress, FUND_AMOUNT_SATS);

  // ─── 4b. Reload so the orchestrator re-fetches UTXOs ───────────
  // getUtxos fires once on connect - funding AFTER connect doesn't
  // trigger a re-fetch. A reload forces a fresh utxos$ pipeline. If
  // Xverse pops a permission-renewal popup we approve it.
  const knownPagesBeforeReload = new Set(context.pages());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reapprove = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeReload,
    timeoutMs: 8_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.waitForFunction(() => {
        const t = (document.body.innerText || '').toLowerCase();
        return ['connect', 'approve', 'confirm', 'allow'].some((s) => t.includes(s));
      }, undefined, { timeout: 8_000, polling: 250 });
      return true;
    },
  }).catch(() => null);
  if (reapprove) {
    await reapprove.getByRole('button', { name: /^(connect|approve|confirm|allow)$/i })
      .first().click();
    await reapprove.close().catch(() => undefined);
  }
  await shot(page, '04b-reloaded');

  // ─── 5. Drop the fixture file on the dropzone ──────────────────
  // The dropzone's hidden <input type="file"> owns onPick → handleFile,
  // which reads the bytes, runs detectMimeType, and calls
  // orchestrator.setContent. setInputFiles works on hidden inputs.
  // (Re-pick AFTER the reload: reload clears the component's picked-file
  // state.)
  await page.setInputFiles('[data-testid="inscribe-file-input"]', FIXTURE_PATH);
  await expect(page.locator('[data-testid="inscribe-file-name"]')).toContainText('inscribe-probe.svg', { timeout: 10_000 });
  await expect(page.locator('[data-testid="inscribe-detected-type"]')).toHaveText(EXPECTED_CONTENT_TYPE, { timeout: 10_000 });
  await shot(page, '05-file-picked');

  // ─── 6. Pin the fee rate + wait for the Inscribe button ────────
  const feeRateInput = page.locator('[data-testid="inscribe-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');

  const inscribeButton = page.locator('[data-testid="inscribe-btn"]');
  // Enabled only when form valid + a viable UTXO auto-picked + a file is
  // set - all three now hold.
  await expect(inscribeButton).toBeEnabled({ timeout: 60_000 });
  await shot(page, '06-ready-to-inscribe');

  // ─── 7. Click Inscribe, approve the ONE sign popup ─────────────
  const knownPagesBeforeSign = new Set(context.pages());
  await inscribeButton.click();

  const approvalSign = await waitForApprovalPopup({
    context,
    knownPages: knownPagesBeforeSign,
    timeoutMs: 120_000,
    isApproval: async (p) => {
      if (!p.url().startsWith('chrome-extension://')) return false;
      await p.getByText(/review transaction/i).first()
        .waitFor({ state: 'visible', timeout: 120_000 });
      return true;
    },
  });
  await shot(approvalSign, '07-sign-approval');

  await approvalSign.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.some((b) => {
      if (!/^confirm$/i.test(b.textContent?.trim() ?? '')) return false;
      if (b.hasAttribute('disabled')) return false;
      const style = getComputedStyle(b);
      return style.pointerEvents !== 'none' && style.visibility !== 'hidden';
    });
  }, undefined, { timeout: 30_000, polling: 250 });
  await expect(approvalSign.getByRole('button', { name: /^confirm$/i }).first()).toBeEnabled({ timeout: 30_000 });

  // Retry the Confirm click - Xverse occasionally swallows the first
  // click during the React onClick attach.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (approvalSign.isClosed()) break;
    await approvalSign.getByRole('button', { name: /^confirm$/i }).first()
      .click({ force: true })
      .catch(() => undefined);
    const closed = new Promise<void>((res) => approvalSign.once('close', () => res()));
    await Promise.race([
      closed,
      expect(approvalSign.getByRole('button', { name: /^confirm$/i }).first())
        .toBeHidden({ timeout: 30_000 }),
    ]).catch(() => undefined);
    if (approvalSign.isClosed()) break;
  }

  // ─── 8. Wait for success panel + read commit/reveal txids ──────
  const successPanel = page.locator('[data-testid="inscribe-success"]');
  await expect(successPanel).toBeVisible({ timeout: 120_000 });
  await shot(page, '08-success');

  const commitTxId = (await page.locator('[data-testid="inscribe-commit-txid"]').textContent())!.trim();
  const revealTxId = (await page.locator('[data-testid="inscribe-reveal-txid"]').textContent())!.trim();
  console.log(`[inscribe-page] commit=${commitTxId} reveal=${revealTxId}`);
  expect(commitTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).not.toBe(commitTxId);

  // ─── 9. Confirm both txs, verify the inscription on-chain ──────
  // Commit + reveal are already in the mempool (broadcast sequentially
  // by the page). One block confirms both - bitcoind packs the reveal
  // in the same block as its unconfirmed commit parent.
  await waitForElectrsSync(mineBlocks(1));
  const commitTx = await waitForTxConfirmed(commitTxId);
  const revealTx = await waitForTxConfirmed(revealTxId);
  console.log(`[inscribe-page] commit locktime=${commitTx.locktime} reveal locktime=${revealTx.locktime}`);

  // The cat21-wallet / SDK builder convention sets nLockTime=21 on every
  // cat-touching tx it builds - here both the commit and the reveal -
  // so each also mints a bonus CAT-21 cat. Regression guard on the SDK
  // builder invariant (a third-party wallet with locktime=0 would still
  // deliver the inscription; the SDK is the builder here, so we pin it).
  expect(commitTx.locktime).toBe(21);
  expect(revealTx.locktime).toBe(21);
  expect(revealTx.status.block_hash).toBeTruthy();

  // ─── 9a. Parse the reveal as an inscription via ordpool-parser ─
  // getTx returns EsploraTx with vin typed as unknown[]; the witness
  // items live at vin[0].witness (a hex string[]). Same cast the SDK's
  // xverse-inscribe-roundtrip spec uses.
  const revealFull = await getTx(revealTxId);
  const witnessHex = (revealFull as unknown as {
    vin: { witness: string[] }[];
  }).vin[0].witness;
  const parsed = InscriptionParserService.parse({
    txid: revealTxId,
    vin: [{ witness: witnessHex }],
  });
  expect(parsed.length).toBe(1);
  expect(parsed[0].contentType).toBe(EXPECTED_CONTENT_TYPE);

  // The page compresses by default and inscribes the smaller of gzip / brotli
  // (the SVG fixture clears assessCompression's 5% margin). In CI's headed
  // Chromium the hosted wasm makes brotli available and it wins, but assert
  // codec-agnostically so the test holds on any engine. The decode-back is the
  // immutability-safety criterion: a compressor that didn't decode back would
  // corrupt the inscription forever.
  const enc = parsed[0].getContentEncoding();
  expect(['br', 'gzip']).toContain(enc);                     // a real codec fired
  const onChain = Buffer.from(parsed[0].getDataRaw());
  expect(onChain.length).toBeLessThan(EXPECTED_BODY.length); // actually compressed
  const decoded = Buffer.from(await parsed[0].getData(), 'base64');
  expect(decoded.equals(EXPECTED_BODY)).toBe(true);          // clean decode to original
});
