import { expect, Page, test } from '@playwright/test';

import { mountFixture, waitForState } from './bitmap-3d-debug';
import { mountViewer } from './bitmap-toolbar';

/**
 * What the reader is left with when the 3D side goes wrong, and what tells
 * them how to drive it when it goes right.
 *
 * Three cases, none of which any other spec covers:
 *
 *  - the GPU takes the context away mid-session, which on a phone is an
 *    ordinary consequence of memory pressure rather than an exotic failure;
 *  - the walk starts with no joysticks on screen, so a keyboard reader has
 *    nothing telling them the controls exist;
 *  - a claim for a block with a single transaction, the shape every other
 *    fixture here is the opposite of.
 */

const hint = (page: Page) => page.locator('app-bitmap-3d-renderer .pfp-hint');
const hintControls = (page: Page) => page.locator('app-bitmap-3d-renderer .pfp-hint-controls');
const hintRelock = (page: Page) => page.locator('app-bitmap-3d-renderer .pfp-hint-relock');

/** Enter the walk through the e2e harness button and wait for the state. */
const enterPfp = async (page: Page) => {
  await waitForState(page, 'orbit');
  // dispatchEvent skips the actionability check: the canvas animates, so
  // Playwright considers the page permanently unstable.
  await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
  await waitForState(page, 'pfp');
};

export const bitmap3dResilienceSuite = (label: 'desktop' | 'mobile'): void => {
  test.describe(`bitmap-3d resilience (${label})`, () => {

    test('a lost GPU context hands the reader back to the SVG, with a reason', async ({ page }) => {
      await mountViewer(page);
      // The toolbar's last button is the 2D/3D toggle. dispatchEvent rather
      // than click: the e2e page stacks a second renderer above the viewer,
      // which overlaps the toolbar on a phone viewport. Whether the button
      // is reachable is the toolbar suite's question, not this one's.
      await page.locator('app-bitmap-viewer .bitmap-toolbar button').last().dispatchEvent('click');
      const canvas = page.locator('app-bitmap-viewer app-bitmap-3d-renderer canvas');
      await expect(canvas).toBeAttached();

      // WEBGL_lose_context is the browser's own simulation of what a driver
      // reset or a memory-pressure eviction does to a live context.
      const lost = await page.evaluate(() => {
        const el = document.querySelector('app-bitmap-viewer app-bitmap-3d-renderer canvas');
        if (!(el instanceof HTMLCanvasElement)) { return 'no canvas'; }
        // Re-requesting the same context type returns the one three.js
        // already holds, so this loses the context actually in use.
        const gl = (el.getContext('webgl2') ?? el.getContext('webgl')) as WebGLRenderingContext | null;
        const ext = gl?.getExtension('WEBGL_lose_context');
        if (!ext) { return 'no extension'; }
        ext.loseContext();
        return 'lost';
      });
      expect(lost, 'could not take the context away').toBe('lost');

      // Back on the 2D drawing, with the renderer gone rather than sitting
      // there as a black square.
      await expect(page.locator('app-bitmap-viewer app-bitmap-3d-renderer')).toHaveCount(0);
      await expect(page.locator('app-bitmap-viewer .bitmap-canvas svg')).toBeVisible();
      await expect(page.locator('app-bitmap-viewer .bitmap-context-lost')).toBeVisible();
    });

    test('a block with a single transaction still builds a walkable scene', async ({ page }) => {
      await mountFixture(page, [1]);
      await enterPfp(page);

      const debug = await page.evaluate(() =>
        (window as unknown as { __bitmap3d: { pos: number[]; onFloor: boolean } }).__bitmap3d);
      // Settle the physics: spawn starts in the air by design.
      await page.evaluate(() =>
        (window as unknown as { __bitmap3d: { tick(n: number): void } }).__bitmap3d.tick(120));
      const settled = await page.evaluate(() =>
        (window as unknown as { __bitmap3d: { onFloor: boolean; pos: number[] } }).__bitmap3d);

      expect(debug.pos).toHaveLength(3);
      expect(settled.onFloor, 'player never landed on a one-cube scene').toBe(true);
      expect(Number.isFinite(settled.pos[1])).toBe(true);
    });

    if (label === 'desktop') {
      test('the walk names its controls, and stops once the reader is driving', async ({ page }) => {
        await mountFixture(page, [1, 2, 3, 2, 1]);
        await enterPfp(page);

        await expect(hint(page)).toBeVisible();
        await expect(hintControls(page)).toContainText('WASD');

        await page.keyboard.press('KeyW');

        await expect(hint(page)).toBeHidden();
      });

      test('losing the pointer lock prompts for the click that gets it back', async ({ page }) => {
        await mountFixture(page, [1, 2, 3, 2, 1]);
        await enterPfp(page);
        await page.keyboard.press('KeyW');
        await expect(hint(page)).toBeHidden();

        // The same event the browser dispatches when Escape releases the
        // lock. Headless Chromium will not grant a real pointer lock, so
        // this drives our handler rather than the browser's emission of it.
        await page.evaluate(() => document.dispatchEvent(new Event('pointerlockchange')));

        await expect(hint(page)).toBeVisible();
        await expect(hintRelock(page)).toBeVisible();
        await expect(hintControls(page)).toBeHidden();
      });

      test('the prompt belongs to the walk, not to the orbit', async ({ page }) => {
        await mountFixture(page, [1, 2, 3, 2, 1]);
        await waitForState(page, 'orbit');

        // Orbit has no pointer lock to lose, so the same event must do
        // nothing. Without this the test above would also pass on a handler
        // that showed the prompt unconditionally.
        await page.evaluate(() => document.dispatchEvent(new Event('pointerlockchange')));

        await expect(hint(page)).toBeHidden();
        // The state class as well as the pixels. Display is gated on pfp-on
        // too, so a handler that reacted in every state would still look
        // right here; this is the half that can actually be wrong.
        await expect(page.locator('app-bitmap-3d-renderer .bitmap3d-host'))
          .not.toHaveClass(/hint-relock/);
      });
    } else {
      test('the walk shows joysticks instead of a keyboard list', async ({ page }) => {
        await mountFixture(page, [1, 2, 3, 2, 1]);
        await enterPfp(page);

        await expect(page.locator('app-bitmap-3d-renderer .touch-joy-zone').first()).toBeVisible();
        await expect(hint(page)).toBeHidden();
      });
    }
  });
};
