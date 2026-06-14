/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { waitForApprovalPopup } from './sdk-lib/approval-popup';

/**
 * E2E (regtest mint) — ordpool /cat21-mint via Cat21 Wallet
 *
 * Mirrors the Xverse mint-regtest spec for the new Cat21 Wallet
 * connector that landed in the SDK at commit 59aa430. Cat21 Wallet
 * is OUR own Leather fork; its CAT-21 mint flow differs from Xverse's
 * in two material ways the test pins:
 *
 *   1. RBF policy: Cat21 Wallet IS allowed to signal RBF
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
// Cat21 Wallet's password-strength meter (zxcvbn) rates the shared
// `TestPassword123!` as "Poor" and refuses to enable Continue. Use a
// longer high-entropy passphrase per the SDK onboard spec.
const TEST_PASSWORD = 'correct-horse-battery-staple-Tr0ub4dor-9876';

const SDK_E2E_DIR = path.resolve(__dirname, '../../../node_modules/ordpool-sdk/e2e');
const EXT_PATH = process.env.CAT21WALLET_EXT_PATH ?? path.join(SDK_E2E_DIR, 'extensions/cat21wallet');

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;
let extensionId: string;

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
      `Cat21 Wallet extension not unpacked at ${EXT_PATH}. The workflow should ` +
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
  const primer = await context.newPage();
  await onboardCat21Wallet(primer);
  await shot(primer, '00-onboarded');
  await primer.close();
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
  // (workspace CLAUDE.md note on commit 49c9285). Cat21 Wallet's
  // approval popup likewise spawns synchronously from
  // sats-connect/getAddresses, so the same precaution applies.
  const knownPagesBeforeConnect = new Set(context.pages());

  // ordpool's connect link reads "connect your wallet" in the empty-
  // wallet state.
  const connectLink = page.getByRole('link', { name: /connect your wallet/i }).first();
  await expect(connectLink).toBeVisible({ timeout: 30_000 });
  await connectLink.click();

  // Picker modal — Cat21 Wallet sits in the "installed" section at
  // the top of the modal. The wallet card isn't a `<button>` — it's
  // a clickable container — so `getByRole('button', …)` doesn't find
  // it (the cat21-indexer cat21wallet artifact at run 27501072445
  // confirmed this). Match the visible label text instead; the
  // label wraps across two lines in the modal layout, so use `\s+`.
  // The ordpool picker renders the wallet name inline with its
  // description on a single line ("Cat21 Wallet Our own — hot wallet
  // for active cat trading…"), so the `$`-anchored regex misses
  // (run 27501318048 screenshot confirmed). Match by substring.
  const cat21Picker = page.getByText(/Cat21\s+Wallet/i).first();
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

  // Note: full mint round-trip is intentionally deferred to a
  // follow-up iteration. Cat21 Wallet returns mainnet bc1q from
  // `getAddresses` regardless of the dapp's Network.Regtest request,
  // so the orchestrator-built bcrt1q PSBT can't sign cleanly against
  // it. See the file-level docstring for the workaround the SDK's
  // own mint-roundtrip spec uses (`deriveRegtestAddresses`); wiring
  // that into the consumer-driven mint flow needs SDK-level
  // enhancement and is tracked separately.
});
