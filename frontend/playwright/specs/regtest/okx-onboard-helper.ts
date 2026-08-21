import { expect, Page } from '@playwright/test';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_MNEMONIC_WORDS = TEST_MNEMONIC.split(' ');
const TEST_PASSWORD = 'TestPassword123!';

/**
 * Drive OKX v4.1.0 onboarding from welcome to dashboard. Multi-page,
 * multi-iframe flow (CI iterations 22-31, 2026-05-31):
 *   - Welcome: "Your portal to Web3" → Import wallet (CDP click +
 *     programmatic fallback; native click absorbed by anti-bot).
 *   - "Seed phrase or private key" picker on the same page.
 *   - 12-box seed form opens in #ui-ses-iframe; Confirm.
 *   - "Secure your wallet" opens on a NEW page; Password preselected;
 *     Next button (also in iframe).
 *   - "Set password" form inside the same iframe; Confirm.
 *   - "Welcome to OKX Wallet — Let's explore Web3" gate; Start your
 *     Web3 journey button.
 *
 * Requires the context to be launched with
 * `--disable-blink-features=AutomationControlled` so navigator.webdriver
 * is hidden — without this the welcome-screen click is absorbed.
 */
export async function onboardOkx(page: Page, extensionId: string): Promise<Page> {
  if (page.url() === 'about:blank') {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto(`chrome-extension://${extensionId}/popup-init.html`, { waitUntil: 'domcontentloaded' });
  }

  // Wait for the cover-video opacity gate to release.
  await page.waitForFunction(() => {
    const wrapper = document.querySelector('[class*="_affix_"]') as HTMLElement | null;
    return !!wrapper && getComputedStyle(wrapper).opacity === '1';
  }, undefined, { timeout: 60_000, polling: 250 });

  const importBtn = page.getByTestId('onboard-page-import-wallet-button');
  await expect(importBtn).toBeVisible({ timeout: 10_000 });
  const cdp = await page.context().newCDPSession(page);
  const box = await importBtn.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 20, y: y - 20, button: 'none', buttons: 0 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 5, y: y - 5, button: 'none', buttons: 0 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  await importBtn.click({ force: true, delay: 100 }).catch(() => undefined);
  const stillOnWelcome = await page.locator('text="Your portal to Web3"').isVisible({ timeout: 3_000 }).catch(() => false);
  if (stillOnWelcome) {
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="onboard-page-import-wallet-button"]') as HTMLElement | null;
      btn?.click();
    });
  }

  const seedOption = page.getByText('Seed phrase or private key', { exact: true });
  await expect(seedOption).toBeVisible({ timeout: 15_000 });
  const seedBox = await seedOption.boundingBox();
  if (seedBox) {
    const x = seedBox.x + seedBox.width / 2;
    const y = seedBox.y + seedBox.height / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  // Seed form inside #ui-ses-iframe.
  const seedFrame = page.frameLocator('#ui-ses-iframe');
  await expect(seedFrame.locator('text="My seed phrase has"').first()).toBeVisible({ timeout: 30_000 });
  const mnemonicInputs = seedFrame.locator('input');
  await expect(mnemonicInputs.first()).toBeVisible({ timeout: 15_000 });
  const inputCount = await mnemonicInputs.count();
  if (inputCount >= 12) {
    for (let i = 0; i < TEST_MNEMONIC_WORDS.length; i++) {
      await mnemonicInputs.nth(i).fill(TEST_MNEMONIC_WORDS[i]);
    }
  } else {
    await mnemonicInputs.first().fill(TEST_MNEMONIC);
  }
  const confirmAfterMnemonic = seedFrame.getByRole('button', { name: /^(confirm|continue|next|import|restore)$/i }).first();
  await expect(confirmAfterMnemonic).toBeEnabled({ timeout: 15_000 });
  await confirmAfterMnemonic.click();

  // "Secure your wallet" opens on a NEW page.
  const ctx = page.context();
  const secureDeadline = Date.now() + 30_000;
  let securePage: Page | null = null;
  while (Date.now() < secureDeadline) {
    for (const p of ctx.pages()) {
      const text = await p.locator('body').innerText().catch(() => '');
      if (/Secure your wallet/i.test(text)) { securePage = p; break; }
    }
    if (securePage) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (securePage) page = securePage;
  const secureFrame = page.frameLocator('#ui-ses-iframe');
  const nextBtn = secureFrame.getByRole('button', { name: /^next$/i }).first();
  if (await nextBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await expect(nextBtn).toBeEnabled({ timeout: 10_000 });
    await nextBtn.click();
  }

  const pwInputs = secureFrame.locator('input[type="password"]');
  if (await pwInputs.first().isVisible({ timeout: 10_000 }).catch(() => false)) {
    const pwCount = await pwInputs.count();
    for (let i = 0; i < pwCount; i++) {
      await pwInputs.nth(i).fill(TEST_PASSWORD);
    }
    const pwContinue = secureFrame.getByRole('button', { name: /^(confirm|continue|next|create|done)$/i }).first();
    await expect(pwContinue).toBeEnabled({ timeout: 10_000 });
    await pwContinue.click();
  }

  // "Welcome to OKX Wallet" completion gate.
  const welcomeDeadline = Date.now() + 30_000;
  let welcomePage: Page | null = null;
  while (Date.now() < welcomeDeadline) {
    for (const p of ctx.pages()) {
      const text = await p.locator('body').innerText().catch(() => '');
      if (/Welcome to OKX Wallet|Start your Web3 journey/i.test(text)) { welcomePage = p; break; }
    }
    if (welcomePage) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (welcomePage) {
    page = welcomePage;
    const startBtn = page.getByRole('button', { name: /Start your Web3 journey/i }).first();
    if (await startBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await startBtn.click().catch(() => undefined);
    } else {
      const fr = page.frameLocator('#ui-ses-iframe');
      const frStart = fr.getByRole('button', { name: /Start your Web3 journey/i }).first();
      if (await frStart.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await frStart.click().catch(() => undefined);
      }
    }
  }

  const dashDeadline = Date.now() + 60_000;
  let dashed = false;
  while (Date.now() < dashDeadline) {
    for (const p of ctx.pages()) {
      const text = (await p.locator('body').innerText().catch(() => '')).toLowerCase();
      if (
        text.includes('send') || text.includes('receive') || text.includes('balance') ||
        text.includes('total') || text.includes('welcome to okx wallet') ||
        text.includes('start your web3 journey') || text.includes('tokens') || text.includes('nft')
      ) {
        dashed = true; page = p; break;
      }
    }
    if (dashed) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!dashed) throw new Error('OKX dashboard markers not found on any context page within 60s');
  return page;
}
