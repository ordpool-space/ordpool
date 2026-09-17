import { expect, test } from '@playwright/test';
import { loadBitmapFixture, mountFixture, readDebug, waitForState } from '../_shared/bitmap-3d-debug';

/**
 * Scrolling the canvas out of view stops it drawing. It must not stop it
 * *thinking*: the exit transition is what emits exitDone, and the viewer
 * latches an `exiting` flag that only that event clears, with both toolbar
 * buttons guarded on it. Gating the state machine on visibility therefore
 * stranded the viewer with two dead buttons until the reader scrolled back.
 */
const fixture = loadBitmapFixture();

const scrollOutOfView = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    document.body.style.minHeight = '4000px';
    window.scrollTo(0, 2500);
  });

test('finishes the exit transition while scrolled out of view', async ({ page }) => {
  await mountFixture(page, fixture.sizes);
  await waitForState(page, 'orbit');

  await page.getByTestId('e2e-enter-pfp').click();
  await waitForState(page, 'pfp');

  await page.getByTestId('e2e-exit-pfp').click();
  await scrollOutOfView(page);
  // The observer is asynchronous; give it a beat to report the canvas gone
  // so the exit really does run through the off-screen path.
  await page.waitForFunction(() => window.scrollY > 2000, null, { timeout: 5_000 });

  await waitForState(page, 'exit-done');
  expect((await readDebug(page)).state).toBe('exit-done');
});
