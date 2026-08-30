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

/**
 * E2E (regtest inscribe) - ordpool /inscribe via Alby.
 *
 * Alby is a NATIVE-regtest wallet (returns bcrt1 directly, no address
 * shim). The wrinkle is signing: Alby's signPsbt popup opens a React
 * confirm dialog whose Promise never resolves in headless CI. So this
 * spec keeps an extension-origin `seedPage` alive and fires Alby's own
 * `webbtc/signPsbt` SW route directly (the exact path Alby's popup would
 * call after the user clicks Confirm - no wallet crypto bypassed, only
 * the hung UI Promise). `window.alby.webbtc.signPsbt` on the app page is
 * patched via addInitScript to proxy into that SW call. Onboarding is
 * seeded through the SW (setPassword → addAccount → setMnemonic). The
 * whole SW-bypass machinery is lifted from cubes-frontend's proven
 * `alby-cube-mint-roundtrip.spec.ts`. CI-only.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/inscribe';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_PASSWORD = 'TestPassword123!';

const FUND_AMOUNT_BTC = 0.001;
const FUND_AMOUNT_SATS = Math.round(FUND_AMOUNT_BTC * 1e8);

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/inscribe-probe.svg');
const EXPECTED_CONTENT_TYPE = 'image/svg+xml';
const EXPECTED_BODY = fs.readFileSync(FIXTURE_PATH);

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.ALBY_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/alby');

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;
let seedPage: Page;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `inscribe-alby-regtest-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
}

// Fire Alby's three onboard router messages (setPassword → addAccount →
// setMnemonic) in a single page.evaluate so the React options page
// doesn't self-navigate between calls. Envelope per Alby's common/lib/msg.
async function seedAlbyAccount(page: Page): Promise<string> {
  const result = await page.evaluate(async ({ password, mnemonic }) => {
    const c = (globalThis as unknown as { chrome: { runtime: {
      sendMessage: (msg: unknown) => Promise<unknown>;
    } } }).chrome;
    const send = (action: string, args: Record<string, unknown>) =>
      c.runtime.sendMessage({
        application: 'LBE',
        prompt: true,
        action,
        args,
        origin: { internal: true },
      }) as Promise<{ data?: unknown; error?: string } | null>;

    const setPwResp = await send('setPassword', { password });
    const addAccResp = await send('addAccount', {
      name: 'ordpool-e2e',
      connector: 'lndhub',
      config: { url: 'https://example.invalid', login: 'x', password: 'x' },
      bitcoinNetwork: 'regtest',
    }) as { data?: { accountId: string }; error?: string } | null;
    const accountId = addAccResp?.data?.accountId;
    const setMnemoResp = accountId
      ? await send('setMnemonic', { id: accountId, mnemonic })
      : null;
    return { setPwResp, addAccResp, accountId, setMnemoResp };
  }, { password: TEST_PASSWORD, mnemonic: TEST_MNEMONIC });

  console.log(`[inscribe-alby:seed] addAccount resp = ${JSON.stringify(result.addAccResp).slice(0, 200)}`);
  if (!result.accountId) {
    throw new Error(`Alby addAccount failed: ${JSON.stringify(result.addAccResp)}`);
  }
  return result.accountId;
}

// Fire Alby's webbtc/signPsbt SW route directly from the seed page
// (extension origin). Returns Alby's finalized wire-tx hex.
async function albySignViaSw(psbtHex: string): Promise<string> {
  const resp = await seedPage.evaluate(async (hex) => {
    const c = (globalThis as unknown as { chrome: { runtime: {
      sendMessage: (msg: unknown) => Promise<unknown>;
    } } }).chrome;
    return await c.runtime.sendMessage({
      application: 'LBE',
      prompt: true,
      action: 'webbtc/signPsbt',
      args: { psbt: hex },
      origin: { internal: true },
    }) as { data?: { signed: string }; error?: string };
  }, psbtHex);
  if (resp.error || !resp.data?.signed) {
    throw new Error(`Alby webbtc/signPsbt failed: ${JSON.stringify(resp).slice(0, 400)}`);
  }
  return resp.data.signed;
}

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(
      `Alby extension not unpacked at ${EXT_PATH}. The workflow should ` +
      'have run the SDK\'s playwright-bootstrap.sh alby step.',
    );
  }
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(`inscription fixture missing at ${FIXTURE_PATH}`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(`regtest tip is ${tip} (<101). regtest-bootstrap.sh should have mined past maturity.`);
  }

  const workingDir = path.resolve(RESULTS_DIR, `alby-inscribe-user-data-dir-${process.pid}-${Date.now()}`);
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

  // seedPage: extension-origin page kept alive for SW-message fires.
  // Block window.close + beforeunload so Alby's React onboarding wizard
  // can't self-navigate away between seed and later sign calls.
  seedPage = await context.newPage();
  await seedPage.addInitScript(() => {
    try {
      Object.defineProperty(window, 'close', { value: () => undefined, writable: false, configurable: false });
    } catch { /* ignore */ }
    try {
      const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
      window.addEventListener('beforeunload', stop as unknown as EventListener, true);
    } catch { /* ignore */ }
  });
  await seedPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
  await seedPage.waitForFunction(() => true, undefined, { timeout: 2_000 }).catch(() => undefined);

  await seedAlbyAccount(seedPage);
  await shot(seedPage, '00-after-seed').catch(() => undefined);
  // Keep seedPage OPEN - the test talks to the SW through it.
});

test.afterAll(async () => {
  await context?.close();
});

test('inscribe round-trip on regtest via the Angular /inscribe page + Alby', async () => {
  test.setTimeout(420_000);

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

  // Auto-click Connect/Allow/Confirm on any Alby permission popup
  // (alby.enable() + webbtc.getAddress() open these on first call).
  let popupCount = 0;
  context.on('page', async (popup) => {
    if (popup === page || popup === seedPage) return;
    const idx = ++popupCount;
    try {
      await popup.waitForLoadState('domcontentloaded', { timeout: 10_000 });
      if (!popup.url().startsWith('chrome-extension://')) return;
      await popup.waitForTimeout(6_000);
      const btn = popup.locator('button', { hasText: /^(connect|allow|confirm|approve|sign)$/i }).first();
      await btn.waitFor({ state: 'visible', timeout: 5_000 });
      await btn.click({ timeout: 5_000 });
      console.log(`[inscribe-alby] auto-clicked popup #${idx}: ${popup.url().slice(0, 80)}`);
    } catch (e) {
      console.log(`[inscribe-alby] popup #${idx} auto-click skipped: ${String(e).slice(0, 200)}`);
    }
  });

  // Expose the SW-bypass to the app page, then patch ONLY
  // window.alby.webbtc.signPsbt to proxy into it - enable() +
  // getAddress() keep using Alby's real inpage API.
  await page.exposeFunction('__albyBypassSignPsbt', async (psbtHex: string) => albySignViaSw(psbtHex));
  await page.addInitScript(() => {
    const win = window as unknown as {
      alby?: { webbtc?: { signPsbt?: (hex: string, opts?: unknown) => Promise<{ signed: string }> } };
      __albyBypassSignPsbt?: (hex: string) => Promise<string>;
    };
    const patch = () => {
      const wb = win.alby?.webbtc;
      if (!wb?.signPsbt) return false;
      const original = wb.signPsbt as unknown as { __ordpoolBypassed?: boolean };
      if (original.__ordpoolBypassed) return true;
      wb.signPsbt = async (hex: string) => {
        if (!win.__albyBypassSignPsbt) throw new Error('__albyBypassSignPsbt not exposed');
        const signed = await win.__albyBypassSignPsbt(hex);
        return { signed };
      };
      (wb.signPsbt as unknown as { __ordpoolBypassed?: boolean }).__ordpoolBypassed = true;
      return true;
    };
    if (patch()) return;
    const id = setInterval(() => { if (patch()) clearInterval(id); }, 50);
    setTimeout(() => clearInterval(id), 30_000);
  });

  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  // Alby's inpage can inject late in CI; wait for it, then reload so a
  // fresh wallets$ subscription catches the already-injected provider.
  await page.waitForFunction(
    () => Boolean((window as unknown as { alby?: unknown }).alby),
    undefined,
    { timeout: 60_000, polling: 250 },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await shot(page, '01-page-loaded');

  const connectLink = page.getByRole('link', { name: /connect your wallet/i }).first();
  await expect(connectLink).toBeVisible({ timeout: 30_000 });
  await connectLink.click();
  await page.getByTestId('wallet-connect-alby').click({ timeout: 20_000 });
  await shot(page, '02-picker-clicked');

  const paymentCode = page.locator('code.bitcoin', { hasText: /^(bcrt1q|bcrt1p|2)/ }).first();
  await expect(paymentCode).toBeVisible({ timeout: 90_000 });
  const paymentAddress = (await paymentCode.textContent())!.trim();
  console.log(`[inscribe-alby] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddress, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[inscribe-alby] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
  await waitForElectrsSync(mineBlocks(1));
  // Poll the address→utxo index until the funding UTXO is visible.
  // waitForElectrsSync only confirms the block HEIGHT; electrs indexes
  // the address→utxo mapping a tick later, so an immediate getUtxos can
  // miss the fresh output (observed flaking here across wallets).
  await waitForUtxoAt(paymentAddress, FUND_AMOUNT_SATS);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean((window as unknown as { alby?: unknown }).alby),
    undefined,
    { timeout: 60_000, polling: 250 },
  );
  await shot(page, '03-reloaded');

  await page.setInputFiles('[data-testid="inscribe-file-input"]', FIXTURE_PATH);
  await expect(page.locator('[data-testid="inscribe-detected-type"]')).toHaveText(EXPECTED_CONTENT_TYPE, { timeout: 10_000 });
  const feeRateInput = page.locator('[data-testid="inscribe-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');

  const inscribeButton = page.locator('[data-testid="inscribe-btn"]');
  await expect(inscribeButton).toBeEnabled({ timeout: 60_000 });
  await shot(page, '04-ready-to-inscribe');

  // The commit is signed through the patched signPsbt → SW-bypass; the
  // reveal is finalized inside the orchestrator with an ephemeral key.
  await inscribeButton.click();

  const successPanel = page.locator('[data-testid="inscribe-success"]');
  await expect(successPanel).toBeVisible({ timeout: 120_000 });
  await shot(page, '06-success');

  const commitTxId = (await page.locator('[data-testid="inscribe-commit-txid"]').textContent())!.trim();
  const revealTxId = (await page.locator('[data-testid="inscribe-reveal-txid"]').textContent())!.trim();
  console.log(`[inscribe-alby] commit=${commitTxId} reveal=${revealTxId}`);
  expect(commitTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).not.toBe(commitTxId);

  await waitForElectrsSync(mineBlocks(1));
  const commitTx = await waitForTxConfirmed(commitTxId);
  const revealTx = await waitForTxConfirmed(revealTxId);
  console.log(`[inscribe-alby] commit locktime=${commitTx.locktime} reveal locktime=${revealTx.locktime}`);
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
