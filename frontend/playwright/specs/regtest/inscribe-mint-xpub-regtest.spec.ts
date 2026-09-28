/* eslint-disable no-console */
import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { InscriptionParserService } from 'ordpool-parser';

// Shared regtest helpers + the watch-only test account, single-sourced from
// the SDK's compiled `ordpool-sdk/e2e` barrel.
import {
  makeWatchOnlyTestAccount,
  fundCommonSats,
  waitForElectrsSync,
  waitForTxConfirmed,
  rpc,
  mineBlocks,
  getTx,
} from 'ordpool-sdk/e2e';

/**
 * E2E (regtest inscribe) - ordpool /inscribe with a WATCH-ONLY (xpub) wallet.
 *
 * This is the ONE matrix cell with no browser extension: the watch-only
 * wallet is a pasted account extended public key. The SDK sees only the
 * public key; signing happens OUTSIDE the browser (Sparrow / Electrum /
 * Coldcard in production) and the signed PSBT is pasted back. So instead of
 * approving an extension popup, the page opens the in-document PSBT
 * export/paste dialog, and the test signs the exported PSBT with the offline
 * half of the same account (the SDK's `makeWatchOnlyTestAccount`, deterministic
 * from a fixed seed, BIP-86 taproot account m/86'/1'/7', keypath-only p2tr).
 *
 *   1. Derive the watch-only account; fund its receive address #0 on regtest,
 *      mine, wait for electrs + both ords to index the funding block.
 *   2. Open /inscribe, open the connect picker, choose "watch-only (xpub)",
 *      paste the account tpub. A plain tpub is script-type-ambiguous, so the
 *      first scan reveals the account-type selector; pick Taproot and scan
 *      again. Confirm the auto-picked funding address (receive #0) -> connect.
 *   3. Drop the fixture SVG, pin the fee rate, wait for "Inscribe" to enable
 *      (the >50k funding coin is auto-picked by the orchestrator).
 *   4. Click Inscribe. The page builds the commit PSBT and opens the export
 *      dialog. Read the unsigned base64, sign it with the offline account key,
 *      paste it back, Finalize & broadcast. The reveal is finalized inside the
 *      orchestrator with an ephemeral key (no second prompt); the page
 *      broadcasts commit + reveal sequentially.
 *   5. Read the reveal txid off the success panel, mine, confirm, and assert
 *      the on-chain reveal is a well-formed inscription: parses through
 *      `InscriptionParserService`, real compressed bytes that DECODE back
 *      byte-identically to the fixture, right content-type, and (the CAT-21
 *      side-effect) locktime=21 on both commit and reveal.
 *
 * The offline-sign -> paste -> finalize bridge is what this cell proves the
 * page wires correctly. The node is the oracle: a PSBT signed with the wrong
 * child key finalises and yields an unspendable tx, so requiring bitcoind to
 * accept the broadcast and the inscription to confirm proves the signature is
 * real.
 *
 * Intentionally CI-only (the config refuses to run it locally). Unlike the
 * extension specs it needs NO wallet .crx - just the regtest stack + the page.
 */

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4242';
const MINT_PATH = '/inscribe';

// >50k sats: the orchestrator's funding-safety scan treats a coin above
// AUTO_SCAN_MAX_VALUE_SAT as unscanned (skips the per-outpoint asset probe)
// and auto-picks it, so Inscribe enables without a manual UTXO pick. Plenty
// for two 546-sat inscription outputs + commit/reveal miner fees.
const FUND_AMOUNT_BTC = 0.001;

// The inscription fixture: a tiny SVG. detectMimeType() sniffs the `<svg`
// prefix and reports image/svg+xml. Byte-identical recovery of these exact
// bytes (after the page's compress-on-mint) is the acceptance criterion.
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/inscribe-probe.svg');
const EXPECTED_CONTENT_TYPE = 'image/svg+xml';
const EXPECTED_BODY = fs.readFileSync(FIXTURE_PATH);

const RESULTS_DIR = path.resolve(__dirname, '../../../test-results');

let context: BrowserContext;

test.describe.configure({ mode: 'serial' });

async function shot(p: Page, name: string): Promise<void> {
  if (p.isClosed()) return;
  await p.screenshot({
    path: path.resolve(RESULTS_DIR, `inscribe-mint-xpub-regtest-${name}.png`),
    fullPage: true,
  });
}

test.beforeAll(async () => {
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(`inscription fixture missing at ${FIXTURE_PATH}`);
  }
  const tip = Number(rpc('getblockcount').trim());
  if (tip < 101) {
    throw new Error(
      `regtest tip is ${tip} (<101). The SDK's regtest-bootstrap should have ` +
      'mined past coinbase maturity before this spec ran.',
    );
  }

  // No extension: a plain headed Chromium under xvfb. No .crx, no seeded
  // user-data-dir - the watch-only wallet is a pasted key, not an extension.
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    viewport: { width: 1280, height: 900 },
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('inscribe round-trip on regtest via the Angular /inscribe page + watch-only xpub', async () => {
  test.setTimeout(420_000);

  // ─── 1. Derive the watch-only account + fund receive #0 ────────
  const account = makeWatchOnlyTestAccount();
  const accountTpub = account.accountExtendedPublicKey;
  const paymentAddress = account.addressAt(0); // scan auto-picks #0; the mint funds from it
  console.log(`[inscribe-xpub] account tpub=${accountTpub.slice(0, 12)}... payment=${paymentAddress}`);
  expect(paymentAddress).toMatch(/^bcrt1p/); // keypath-only p2tr on regtest

  // Fund on COMMON (mid-block) sats via the SDK harness faucet, NOT a raw
  // sendtoaddress: with --index-sats the coinbase boundary sat is an uncommon
  // rare sat, so a plain send can hand this ONE-ADDRESS (xpub) wallet a coin the
  // funding-safety scan correctly flags as asset-bearing, which disables the CTA
  // (expert-required) and makes this lane roll dice run to run. fundCommonSats
  // spends one mature input with the boundary sat absorbed into vout-0 change so
  // the payment inherits common sats, then mines and waits for electrs + BOTH ord
  // instances to index it (the connect scan reads /output/<outpoint> on both).
  console.log(`[inscribe-xpub] funding ${paymentAddress} with ${FUND_AMOUNT_BTC} BTC on common sats`);
  await fundCommonSats(paymentAddress, FUND_AMOUNT_BTC);

  // ─── 2. Open /inscribe, connect the watch-only (xpub) wallet ───
  const page = await context.newPage();
  await page.goto(`${FRONTEND_URL}${MINT_PATH}`, { waitUntil: 'domcontentloaded' });
  await shot(page, '01-page-loaded');

  const connectTrigger = page.getByTestId('connect-wallet-trigger').first();
  await expect(connectTrigger).toBeVisible({ timeout: 30_000 });
  await connectTrigger.click();

  // Pick the watch-only (xpub) connect row -> the picker switches to the paste form.
  await page.getByTestId('wallet-connect-xpub').click({ timeout: 20_000 });
  await page.getByTestId('xpub-connect-input').fill(accountTpub);
  await shot(page, '02-xpub-pasted');

  // A plain tpub is script-type-ambiguous: the first scan reveals the
  // account-type selector. Pick Taproot, then scan again.
  await page.getByTestId('xpub-connect-scan').click();
  const scriptType = page.getByTestId('xpub-script-type');
  await expect(scriptType).toBeVisible({ timeout: 20_000 });
  // The options use Angular's [ngValue]="'p2tr'" binding, which sets an OPAQUE
  // DOM value (e.g. "1: p2tr"), so a value match (selectOption('p2tr')) never
  // finds it. A native <select> option can't carry a data-testid. Match the
  // visible LABEL, not position: a reorder would silently pick a different
  // script type (deriving a different address family from the same tpub); a
  // copy change breaks this loudly instead.
  await scriptType.selectOption({ label: 'Taproot (P2TR), recommended for cats' });
  await page.getByTestId('xpub-connect-scan').click();
  await shot(page, '03-scanned');

  // Scan review: confirm the auto-picked funding address (receive #0) and connect.
  const confirmXpub = page.getByTestId('xpub-connect-confirm');
  await expect(confirmXpub).toBeVisible({ timeout: 30_000 });

  // Positive assertion at the point of the selection mistake: the derived
  // ordinals address the UI now shows must be the account's receive #0.
  //
  // The expected value is a LITERAL a human transcribed and verified against
  // makeWatchOnlyTestAccount (fixed seed, m/86'/1'/7', keypath-only p2tr), NOT
  // re-derived here from the SDK. Comparing the page's SDK-derived address
  // against the SDK's own addressAt(0) would be the SDK's derivation checked
  // against itself: a bug in it corrupts both sides and they agree. Against a
  // typed literal the page's derivation has an independent oracle. (If the
  // helper's seed/path ever changes the address, this fails loudly and a human
  // re-verifies and updates the literal.) shortenString:14 renders first7...last7,
  // so both halves are on screen: the HEAD (bcrt1p vs bcrt1q) is the family
  // discriminator a wrong script type would flip; the TAIL pins the exact
  // identity. Surfaces a mis-selection on THIS line, not as a downstream timeout.
  const EXPECTED_ORDINALS_ADDRESS = 'bcrt1pkh944sywa9czctjzzet5f29v97p4pgrr2p0sp6xcktf3k5ryxxwq9an3c0';
  const shownOrdinals = (await page.getByTestId('xpub-ordinals-address').textContent()) ?? '';
  expect(shownOrdinals).toContain(EXPECTED_ORDINALS_ADDRESS.slice(0, 7));
  expect(shownOrdinals).toContain(EXPECTED_ORDINALS_ADDRESS.slice(-7));

  await confirmXpub.click();
  await shot(page, '04-connected');

  // ─── 3. Drop the fixture, pin the fee, wait for Inscribe ───────
  // Funded BEFORE connect, so the connect-time getUtxos usually sees the coin
  // and the button enables straight away. When that fetch loses the race and
  // reads empty, the orchestrator would keep that empty set forever (it reads
  // once on connect) and the button would stay disabled the full 60s. The
  // component's bounded funding-refresh poll recovers it: once a file is set and
  // the status is `insufficient`, it re-reads the set within one interval, so
  // the button enables whether or not the connect fetch won. No page reload,
  // which a watch-only (pasted-key) connection would not survive.
  await page.setInputFiles('[data-testid="inscribe-file-input"]', FIXTURE_PATH);
  await expect(page.locator('[data-testid="inscribe-file-name"]')).toContainText('inscribe-probe.svg', { timeout: 10_000 });
  await expect(page.locator('[data-testid="inscribe-detected-type"]')).toHaveText(EXPECTED_CONTENT_TYPE, { timeout: 10_000 });

  const feeRateInput = page.locator('[data-testid="inscribe-fee-rate"]');
  await feeRateInput.fill('1');
  await feeRateInput.press('Tab');

  const inscribeButton = page.locator('[data-testid="inscribe-btn"]');
  await expect(inscribeButton).toBeEnabled({ timeout: 60_000 });
  await shot(page, '05-ready-to-inscribe');

  // ─── 4. Inscribe -> export dialog -> offline-sign -> paste ─────
  await inscribeButton.click();

  const unsignedField = page.locator('[data-testid="psbt-export-unsigned"]');
  await expect(unsignedField).toBeVisible({ timeout: 60_000 });
  const unsignedBase64 = (await unsignedField.inputValue()).trim();
  expect(unsignedBase64.length).toBeGreaterThan(0);
  console.log(`[inscribe-xpub] exported unsigned PSBT (${unsignedBase64.length} b64 chars)`);
  await shot(page, '06-export-dialog');

  // Sign OUTSIDE the browser with the offline half of the account. Default
  // receive index 0 for the single funding input - the shape of the commit.
  const signedBase64 = account.signExportedPsbt(unsignedBase64);
  await page.locator('[data-testid="psbt-export-signed"]').fill(signedBase64);
  await page.locator('[data-testid="psbt-export-submit"]').click();
  await shot(page, '07-signed-submitted');

  // ─── 5. Success panel -> read commit/reveal txids ──────────────
  const successPanel = page.locator('[data-testid="inscribe-success"]');
  await expect(successPanel).toBeVisible({ timeout: 120_000 });
  await shot(page, '08-success');

  const commitTxId = (await page.locator('[data-testid="inscribe-commit-txid"]').textContent())!.trim();
  const revealTxId = (await page.locator('[data-testid="inscribe-reveal-txid"]').textContent())!.trim();
  console.log(`[inscribe-xpub] commit=${commitTxId} reveal=${revealTxId}`);
  expect(commitTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).toMatch(/^[0-9a-f]{64}$/);
  expect(revealTxId).not.toBe(commitTxId);

  // ─── 6. Confirm both txs, verify the inscription on-chain ──────
  await waitForElectrsSync(mineBlocks(1));
  const commitTx = await waitForTxConfirmed(commitTxId);
  const revealTx = await waitForTxConfirmed(revealTxId);
  console.log(`[inscribe-xpub] commit locktime=${commitTx.locktime} reveal locktime=${revealTx.locktime}`);

  // The SDK builder convention sets nLockTime=21 on every cat-touching tx (here
  // both commit and reveal), so each also mints a bonus CAT-21 cat. Regression
  // guard on the SDK builder invariant.
  expect(commitTx.locktime).toBe(21);
  expect(revealTx.locktime).toBe(21);
  expect(revealTx.status.block_hash).toBeTruthy();

  // Parse the reveal as an inscription via ordpool-parser.
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

  // The page compresses by default and inscribes the smaller of gzip / brotli.
  // The decode-back is the immutability-safety criterion.
  const enc = parsed[0].getContentEncoding();
  expect(['br', 'gzip']).toContain(enc);
  const onChain = Buffer.from(parsed[0].getDataRaw());
  expect(onChain.length).toBeLessThan(EXPECTED_BODY.length);
  const decoded = Buffer.from(await parsed[0].getData(), 'base64');
  expect(decoded.equals(EXPECTED_BODY)).toBe(true);
});
