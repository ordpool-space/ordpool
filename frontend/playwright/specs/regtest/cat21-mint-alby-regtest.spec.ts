/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { Cat21ParserService, DigitalArtifactType } from 'ordpool-parser';

import {
  waitForUtxoAt,
  waitForElectrsSync,
  waitForOrdSync,
  waitForOrdStockSync,
  waitForTxConfirmed,
  rpc,
  mineBlocks,
  seedAlbyAccount,
} from 'ordpool-sdk/e2e';

/**
 * E2E (regtest mint) - ordpool /cat21-mint via Alby.
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
const MINT_PATH = '/cat21-mint';

const FUND_AMOUNT_BTC = 0.001;
const FUND_AMOUNT_SATS = Math.round(FUND_AMOUNT_BTC * 1e8);


const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.ALBY_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/alby');

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;
let seedPage: Page;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `cat21-mint-alby-regtest-${name}.png`),
    fullPage: true,
  }).catch(() => undefined);
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

test('cat21 mint round-trip on regtest via the Angular /cat21-mint page + Alby', async () => {
  test.setTimeout(420_000);

  const page = await context.newPage();
  // No /output mock. The funding-safety scan probes the REAL local ords the
  // workflow wired into environment.ts: stock ord (:8081) for inscriptions/
  // runes/sat_ranges and cat21-ord (:8080) for cats. A clean regtest payment
  // coin returns empty from both, so it classifies usable for real. The sync
  // waits after funding ensure both ords have indexed the funding block first.

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
      console.log(`[cat21-mint-alby] auto-clicked popup #${idx}: ${popup.url().slice(0, 80)}`);
    } catch (e) {
      console.log(`[cat21-mint-alby] popup #${idx} auto-click skipped: ${String(e).slice(0, 200)}`);
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

  const connectTrigger = page.getByTestId('connect-wallet-trigger').first();
  await expect(connectTrigger).toBeVisible({ timeout: 30_000 });
  await connectTrigger.click();
  await page.getByTestId('wallet-connect-alby').click({ timeout: 20_000 });
  await shot(page, '02-picker-clicked');

  const paymentCode = page.locator('[data-testid="fund-payment-address"]').first();
  await expect(paymentCode).toBeVisible({ timeout: 90_000 });
  const paymentAddress = (await paymentCode.textContent())!.replace(/\s+/g, '');
  console.log(`[cat21-mint-alby] payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1[qp]|^2/);

  const fundTxid = rpc('-rpcwallet=ordpool-e2e', 'sendtoaddress', paymentAddress, String(FUND_AMOUNT_BTC)).trim();
  console.log(`[cat21-mint-alby] funded ${paymentAddress} +${FUND_AMOUNT_BTC} BTC tx=${fundTxid}`);
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

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean((window as unknown as { alby?: unknown }).alby),
    undefined,
    { timeout: 60_000, polling: 250 },
  );
  await shot(page, '03-reloaded');

  // ─── 5. Pin the fee, wait for the Mint button ──────────────────
  // The large (>50k) funding coin is auto-picked by the orchestrator's
  // fundingRecommendation, so Mint enables without a manual pick.
  const feeRateInput = page.locator('[data-testid="cat21-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');
  const mintBtn = page.getByTestId('mint-cat-button');
  await expect(mintBtn).toBeEnabled({ timeout: 60_000 });
  await shot(page, '01-ready-to-mint');

  // ─── 6. Click Mint. The mint tx is signed through the patched
  // signPsbt (SW-bypass); Alby's popup auto-approves via the routes
  // installed in beforeAll, so there is no explicit sign click.
  await mintBtn.click();

  // ─── 7. Success card → broadcast txid ──────────────────────────
  const successAlert = page.locator('.alert.alert-success').first();
  await expect(successAlert).toBeVisible({ timeout: 120_000 });
  const successHref = await successAlert.locator('a').first().getAttribute('href');
  const txidMatch = successHref!.match(/\/tx\/([0-9a-f]{64})/);
  expect(txidMatch).not.toBeNull();
  const broadcastTxid = txidMatch![1];
  console.log(`[cat21-mint-alby] mint txid=${broadcastTxid}`);

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
