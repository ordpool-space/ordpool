import { test, expect } from '@playwright/test';
import {
  loadBitmapFixture,
  mountFixture,
  readDebug,
  setKey,
  tick,
  waitForState,
} from '../_shared/bitmap-3d-debug';

const fixture = loadBitmapFixture();

test.describe('bitmap-3d renderer', () => {
  test.beforeEach(async ({ page }) => {
    await mountFixture(page, fixture.sizes);
  });

  test('mounts the renderer and reaches the orbit state', async ({ page }) => {
    await expect(page.getByTestId('e2e-sizes-len')).toHaveText(String(fixture.sizes.length));
    await waitForState(page, 'orbit');
  });

  test('exactly one canvas in the host after mount (no duplicate scene)', async ({ page }) => {
    // Regression: two rebuild() calls used to race on mount (sizes Input
    // setter + ngAfterViewInit) and append two WebGL canvases into the
    // same host. User-reported as "I see the whole scene twice" on the tx
    // page after Switch-to-3D. Pin canvas count post-mount.
    await waitForState(page, 'orbit');
    const canvasCount = await page.evaluate(
      () => document.querySelectorAll('app-bitmap-3d-renderer canvas').length,
    );
    expect(canvasCount).toBe(1);
  });

  test('PFP entry: orbit -> fly-to-pfp -> pfp', async ({ page }) => {
    await waitForState(page, 'orbit');
    // dispatchEvent skips Playwright's actionability check, which considers
    // the page permanently unstable while the canvas is animating.
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');
  });

  test('player starts grounded and idle on PFP entry', async ({ page }) => {
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');

    // Even one tick is enough — the post-substep ray-ground check fires
    // immediately and finds the ground collider directly below the spawn.
    await tick(page, 1);
    const d = await readDebug(page);
    expect(d.onFloor).toBe(true);
    expect(d.playerState).toBe('idle');
  });

  test('jump arc: idle -> jumping -> falling -> idle', async ({ page }) => {
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');
    await tick(page, 1);

    // One-shot jump pulse (same path as the on-screen jump button — no
    // keyboard-event focus concerns).
    await page.evaluate(() => (window as any).__bitmap3d.jump());

    // Empirical trajectory (calibrated via 10-frame-step diagnostic):
    // jumping ~0-30 frames after pulse, falling ~30-80, landing + damping
    // ~80-100. Damping is aggressive — vy×0.98/frame in air shortens the
    // arc considerably below the gravity-only ballistic estimate. Wide
    // margins absorb the slight variance from interleaved rAF ticks.
    await tick(page, 10);
    expect((await readDebug(page)).playerState).toBe('jumping');
    await tick(page, 70);   // total 80 frames since jump — well past apex
    expect((await readDebug(page)).playerState).toBe('falling');
    await tick(page, 300);  // land + damp out
    expect((await readDebug(page)).playerState).toBe('idle');
  });

  test('Shift alone (no movement) does NOT widen the FOV', async ({ page }) => {
    // Regression: pressing Shift while stationary used to widen FOV
    // because the gate was just `sprinting && onFloor`. User-reported
    // as "what is shift doing, it zooms out a bit". Gate now requires
    // actual horizontal motion above the run threshold.
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');
    await tick(page, 1);

    const restingFov = (await readDebug(page)).fov;
    expect(restingFov).toBeCloseTo(75, 0);

    await setKey(page, 'ShiftLeft', true);
    await tick(page, 30);   // hold Shift for 0.5s simulated, no WASD

    // FOV must stay at the resting value (within easing slack).
    expect((await readDebug(page)).fov).toBeLessThan(80);
    await setKey(page, 'ShiftLeft', false);
  });

  test('sprint widens the FOV', async ({ page }) => {
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');
    await tick(page, 1);

    const restingFov = (await readDebug(page)).fov;
    expect(restingFov).toBeCloseTo(75, 0);

    await setKey(page, 'ShiftLeft', true);
    await setKey(page, 'KeyW', true);

    // FOV eases at rate=10. 30 frames @ 1/60 = 0.5s of simulated time,
    // alpha=10*1/60 per frame → ~99% of the gap closed.
    await tick(page, 30);
    expect((await readDebug(page)).fov).toBeGreaterThan(85);

    await setKey(page, 'KeyW', false);
    await setKey(page, 'ShiftLeft', false);
  });

  test('bunny-hopping (held Space + KeyW) covers more ground than walking alone', async ({ page }) => {
    // Bhop preserves horizontal momentum across chained jumps. Held Space
    // means applyControls re-jumps every time playerOnFloor flips true,
    // and updatePlayer's air-physics branch fires whenever vy>0.1 (just
    // jumped) so ground friction doesn't bite on the landing substep.
    // Net effect: holding Space + W noticeably outpaces holding W alone.
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');
    await tick(page, 1);

    // Baseline: walk for 60 frames (1 simulated second).
    const walkStart = (await readDebug(page)).pos;
    await setKey(page, 'KeyW', true);
    await tick(page, 60);
    await setKey(page, 'KeyW', false);
    const walkEnd = (await readDebug(page)).pos;
    const walkDist = Math.hypot(walkEnd[0] - walkStart[0], walkEnd[2] - walkStart[2]);

    // Settle to rest before the bhop run.
    await tick(page, 30);

    // Bhop: hold W AND Space for the same 60 frames.
    const hopStart = (await readDebug(page)).pos;
    await setKey(page, 'KeyW', true);
    await setKey(page, 'Space', true);
    await tick(page, 60);
    await setKey(page, 'Space', false);
    await setKey(page, 'KeyW', false);
    const hopEnd = (await readDebug(page)).pos;
    const hopDist = Math.hypot(hopEnd[0] - hopStart[0], hopEnd[2] - hopStart[2]);

    expect(hopDist).toBeGreaterThan(walkDist * 1.2);
  });

  test('walking forward translates the player position', async ({ page }) => {
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');
    await tick(page, 1);

    const startPos = (await readDebug(page)).pos;

    await setKey(page, 'KeyW', true);
    await tick(page, 30);  // 0.5s of walking
    await setKey(page, 'KeyW', false);

    const endPos = (await readDebug(page)).pos;
    const dx = endPos[0] - startPos[0];
    const dz = endPos[2] - startPos[2];
    // SPEED_ON_FLOOR=25 units/s but damping eats most of it. Empirically
    // 0.5s of walking moves the capsule a small but non-trivial distance.
    expect(Math.hypot(dx, dz)).toBeGreaterThan(0.5);
  });

  test('PFP exit: pfp -> fly-to-iso -> exit-done', async ({ page }) => {
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');

    // Exit-PFP click sets exit=true which routes the fly tween to
    // 'exit-done' (the renderer's terminal state — parent decides whether
    // to tear down or restart). "Back to orbit" goes through a different
    // path (clearing pfp without setting exit).
    await page.getByTestId('e2e-exit-pfp').dispatchEvent('click');

    // The fly tween IS rAF-driven (not tick-driven). Headless throttling
    // means rAF fires every ~2-5s, and the 1.5s tween completes in 1-2 of
    // those firings. The default 30s waitForState timeout covers it.
    await waitForState(page, 'exit-done');
  });
});
