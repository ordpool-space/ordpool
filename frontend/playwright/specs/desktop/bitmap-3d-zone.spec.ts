import { expect, Page, test } from '@playwright/test';

import { loadBitmapFixture, mountFixture, waitForState } from '../_shared/bitmap-3d-debug';

/**
 * The 3D scene must not drive Angular's change detection.
 *
 * Every listener the scene registers (OrbitControls' pointer handlers, the
 * walk's document-level mousemove, the observers, the rAF loop) goes
 * through an API zone.js patches. Registered inside the Angular zone, each
 * pointer sample of an orbit drag ends in an application-wide
 * ApplicationRef.tick(): on the transaction page that is the whole page,
 * re-checked dozens of times a second, for a canvas that needs none of it.
 *
 * Counted, not timed: the number of passes during a drag is a property of
 * where the listeners live, which a noisy runner cannot blur. The counter
 * is the harness's subscription to NgZone.onMicrotaskEmpty, the signal the
 * tick runs on. (Counting a component's DoCheck does NOT work: an OnPush
 * tree that nothing marked dirty is never entered, so a canvas-driven tick
 * would pass unseen.)
 */

const passes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bitmap3dZoneTurns?: number }).__bitmap3dZoneTurns ?? 0);

/** Pointer samples in the drag. */
const STEPS = 30;

test('orbiting the scene triggers no change detection', async ({ page }) => {
  await mountFixture(page, loadBitmapFixture().sizes);
  await waitForState(page, 'orbit', 60_000);

  const box = await page.locator('app-bitmap-3d-renderer canvas').boundingBox();
  if (!box) { throw new Error('the scene canvas has no bounding box'); }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  const before = await passes(page);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 40, { steps: STEPS });
  await page.mouse.up();
  const after = await passes(page);

  // A listener living in the zone costs at least one pass per pointer
  // sample, so a leak scales with the drag; the app shell's own listeners
  // answer the discrete down/up/click and stay constant. Measured on this
  // drag: 136 passes with the scene in the zone, 3 with it outside. The
  // bound is the sample count itself, which only a per-sample leak can
  // reach.
  expect(after - before, `change-detection passes during a ${STEPS}-step orbit drag`).toBeLessThan(STEPS);
});
