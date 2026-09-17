import { expect, Page, test } from '@playwright/test';
import { loadBitmapFixture, mountFixture, readDebug, waitForState } from './bitmap-3d-debug';

/**
 * Performance guards for the bitmap 3D renderer, shared by the desktop and
 * mobile projects (the renderer takes a different branch on each: mobile
 * skips SSAA + SAO and halves the shadow map).
 *
 * These assert mechanisms, not wall-clock times. A shared CI runner's clock
 * is far too noisy to gate on, but "is the octree built?" and "how big is
 * the heap?" are stable, and they are what actually regressed here: the
 * renderer used to build a collision octree on every mount, over a root box
 * ten times the cubes' extent, which cost 15 s and 3.3 GB on block 500,000
 * before anything was drawn.
 *
 * Timings are measured and attached to the report for trend-watching, but
 * only an absurd value fails the run.
 */

/** usedJSHeapSize in MB. Chromium-only and coarsely bucketed, which is fine
 *  for a signal whose regression is a factor of thirty. */
const heapMB = (page: Page) =>
  page.evaluate(() => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
  });

/**
 * Ceiling for a worst-case bitmap. Measured at ~50 MB in a production build
 * and well under 300 MB against the unminified dev bundle the E2E server
 * serves; the pre-fix renderer sat at ~2 GB. Generous on purpose: this is
 * here to catch a return to per-mount octree building, not to police
 * megabytes.
 */
const HEAP_CEILING_MB = 600;

/**
 * Nothing should take this long. Purely a canary against a hang -- the
 * per-mount octree build this branch removed cost 15 s on the desktop that
 * measured it, so a return to it lands here.
 *
 * waitForState below is given more than this on purpose: at its 30 s
 * default the wait aborted first and the canary could never fire, so a
 * regression would have surfaced as an opaque wait timeout instead of a
 * named budget.
 */
const MOUNT_CEILING_MS = 45_000;
const MOUNT_WAIT_MS = MOUNT_CEILING_MS + 15_000;

export const bitmapPerfSuite = (label: string): void => {
  // Block 500,000: the widest layout of any block sampled (160 units from
  // 2701 old-style large-value txs), which is what the octree's cost scales
  // with. Worst case, not biggest block.
  const fixture = loadBitmapFixture(500_000);

  test.describe(`bitmap-3d performance (${label})`, () => {
    test('the collision octree is built only once the walk is entered', async ({ page }) => {
      await mountFixture(page, fixture.sizes);
      await waitForState(page, 'orbit');

      // Orbiting never consults the octree, so it must not exist yet: this
      // is what keeps a 3D mount cheap for the many visitors who never walk.
      expect((await readDebug(page)).octreeBuilt).toBe(false);

      await page.getByTestId('e2e-enter-pfp').click();
      await waitForState(page, 'pfp');
      expect((await readDebug(page)).octreeBuilt).toBe(true);
    });

    test('a worst-case bitmap mounts quickly and keeps the heap flat', async ({ page }, testInfo) => {
      const startedAt = Date.now();
      await mountFixture(page, fixture.sizes);
      await waitForState(page, 'orbit', MOUNT_WAIT_MS);
      const mountMs = Date.now() - startedAt;

      const mb = await heapMB(page);
      testInfo.annotations.push(
        { type: 'perf', description: `${label}: mount-to-orbit ${mountMs} ms, heap ${mb ?? 'n/a'} MB, ${fixture.sizes.length} cubes` },
      );

      expect(mountMs).toBeLessThan(MOUNT_CEILING_MS);
      if (mb !== null) expect(mb).toBeLessThan(HEAP_CEILING_MB);
    });
  });
};
