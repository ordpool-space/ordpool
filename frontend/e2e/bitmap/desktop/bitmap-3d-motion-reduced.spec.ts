import { expect, test } from '@playwright/test';
import { loadBitmapFixture, mountFixture, readDebug, waitForState } from '../_shared/bitmap-3d-debug';

/**
 * Reader asks the OS for reduced motion, so the opening cinematic collapses
 * to a single frame: the cube city appears rather than performing.
 *
 * Emulated per page rather than through `test.use({ reducedMotion })` --
 * that route does not reach the page under this config (matchMedia still
 * reports no-preference), while emulateMedia demonstrably does.
 */
const fixture = loadBitmapFixture();

test('skips the opening cinematic under prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

  await mountFixture(page, fixture.sizes);
  await waitForState(page, 'orbit');
  expect((await readDebug(page)).introMs).toBeLessThan(10);
});
