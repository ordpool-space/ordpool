import { expect, test } from '@playwright/test';
import { loadBitmapFixture, mountFixture, readDebug, waitForState } from '../_shared/bitmap-3d-debug';

/**
 * The renderer opens with a cinematic: hold the top-down view, tilt to the
 * isometric corner, then grow the cubes out of the floor. This is the
 * default half of that behaviour; the reduced-motion half lives in its own
 * file, because the emulation has to be declared at the top level of a spec
 * file to take effect.
 *
 * Asserted on the cinematic's own length rather than on how long the mount
 * took, so a loaded CI runner can't turn this into a coin flip.
 */
const fixture = loadBitmapFixture();

test('plays the opening cinematic by default', async ({ page }) => {
  await mountFixture(page, fixture.sizes);
  await waitForState(page, 'orbit');
  expect((await readDebug(page)).introMs).toBeGreaterThan(3000);
});
