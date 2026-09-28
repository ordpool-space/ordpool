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

const hint = (page: Page) => page.getByTestId('bitmap-walk-hint');
const hintControls = (page: Page) => page.getByTestId('bitmap-walk-hint-controls');
const hintRelock = (page: Page) => page.getByTestId('bitmap-walk-hint-relock');
const viewToggle = (page: Page) => page.getByTestId('bitmap-view-toggle');
const threeDNote = (page: Page) => page.getByTestId('bitmap-3d-note');

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
      // Teardown after a real loss must not ask for the context to be lost
      // again: three answers that with a missing-extension warning, which
      // sends whoever reads the console after the wrong problem.
      const warnings: string[] = [];
      page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
      await mountViewer(page);
      // dispatchEvent rather than click: the e2e page stacks a second
      // renderer above the viewer, which overlaps the toolbar on a phone
      // viewport. Whether the button is reachable is the toolbar suite's
      // question, not this one's.
      await viewToggle(page).dispatchEvent('click');
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
      await expect(page.getByTestId('bitmap-svg').locator('svg')).toBeVisible();
      await expect(threeDNote(page)).toContainText('lost its graphics context');
      expect(warnings.filter(w => w.includes('WEBGL_lose_context'))).toEqual([]);
    });

    test('a 3D view that cannot load says so, keeps the toggle alive, and loads after a reload', async ({ page }) => {
      await mountViewer(page);
      // What a flaky connection, or a tab older than the deploy that renamed
      // the chunk, does to the lazy three.js load.
      await page.route(/three/, route => route.abort());

      await viewToggle(page).dispatchEvent('click');

      // Back on the SVG with the reason on screen, not stuck under the
      // loading cover with both toggles waiting on a renderer that will
      // never answer.
      await expect(threeDNote(page)).toContainText('Reload the page');
      await expect(page.getByTestId('bitmap-scene-loading')).toHaveCount(0);
      await expect(page.getByTestId('bitmap-svg').locator('svg')).toBeVisible();

      // Pressing again, with the network back, still cannot fetch the chunk:
      // the browser keeps the failed module fetch for the life of the
      // document. What must hold is that it fails the same honest way
      // instead of hanging.
      await page.unroute(/three/);
      await viewToggle(page).dispatchEvent('click');
      await expect(threeDNote(page)).toContainText('Reload the page');
      await expect(page.getByTestId('bitmap-scene-loading')).toHaveCount(0);

      // The reload the note asks for is what brings 3D back.
      await page.reload();
      await expect(page.getByTestId('bitmap-viewer-e2e-host')).toBeAttached();
      await viewToggle(page).dispatchEvent('click');
      await expect(page.locator('app-bitmap-viewer app-bitmap-3d-renderer canvas')).toBeAttached();
      await expect(threeDNote(page)).toHaveCount(0);
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

      test('the click that starts the walk also asks for mouse look', async ({ page }) => {
        // Counted rather than granted: headless Chromium never grants a
        // real pointer lock, so what is pinned is that the walk asks on
        // entry, before any click on the canvas.
        await page.addInitScript(() => {
          const w = window as unknown as { __lockRequests: number };
          w.__lockRequests = 0;
          HTMLCanvasElement.prototype.requestPointerLock = function () {
            w.__lockRequests++;
            return Promise.resolve();
          } as typeof HTMLCanvasElement.prototype.requestPointerLock;
        });
        await mountFixture(page, [1, 2, 3, 2, 1]);
        await enterPfp(page);

        expect(await page.evaluate(() => (window as unknown as { __lockRequests: number }).__lockRequests)).toBe(1);
      });

      test('the key list names the mouse the way the lock stands', async ({ page }) => {
        await mountFixture(page, [1, 2, 3, 2, 1]);
        await enterPfp(page);

        // No lock (headless never grants one): the click is the way in.
        await expect(page.getByTestId('bitmap-walk-hint-mouse-click')).toBeVisible();
        await expect(page.getByTestId('bitmap-walk-hint-mouse-locked')).toBeHidden();

        // Stand in for the lock the browser would grant, then send the
        // event it would send with it.
        await page.evaluate(() => {
          const canvas = document.querySelector('app-bitmap-3d-renderer canvas');
          Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
          document.dispatchEvent(new Event('pointerlockchange'));
        });

        await expect(page.getByTestId('bitmap-walk-hint-mouse-locked')).toBeVisible();
        await expect(page.getByTestId('bitmap-walk-hint-mouse-locked')).toContainText('Esc');
        await expect(page.getByTestId('bitmap-walk-hint-mouse-click')).toBeHidden();
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

      test('the re-lock prompt leaves the moment the walk does', async ({ page }) => {
        await mountFixture(page, [1, 2, 3, 2, 1]);
        await enterPfp(page);
        await page.evaluate(() => document.dispatchEvent(new Event('pointerlockchange')));
        await expect(hintRelock(page)).toBeVisible();

        await page.getByTestId('e2e-exit-pfp').dispatchEvent('click');

        // Checked during the fly-out itself: the sweep back to the iso view
        // lasts long enough for a stale prompt to ask for a click that no
        // longer does anything. State and visibility are read together in
        // one task: an auto-retrying toBeHidden() would simply outwait the
        // sweep, whose end hides the hint anyway, and pass either way.
        const duringSweep = await page.waitForFunction(() => {
          const debug = (window as unknown as { __bitmap3d?: { state: string } }).__bitmap3d;
          if (debug?.state !== 'fly-to-iso') { return null; }
          const el = document.querySelector('[data-testid="bitmap-walk-hint"]');
          return { shown: !!el && getComputedStyle(el).display !== 'none' };
        }, undefined, { polling: 50 });
        expect(await duringSweep.jsonValue()).toEqual({ shown: false });
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
        await expect(page.getByTestId('bitmap3d-host')).not.toHaveClass(/hint-relock/);
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
