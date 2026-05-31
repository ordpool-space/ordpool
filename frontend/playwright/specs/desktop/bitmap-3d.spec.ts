import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Block 800,000 — picked as the canonical E2E bitmap. Healthy variety of
// cube sizes (1-6) so step-up (size-1 auto-climb) and jump (size-2+) both
// get exercised, immutable on-chain, lives forever in playwright/fixtures/.
const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../fixtures/bitmap-800000.json'), 'utf8'),
);

interface Bitmap3dDebug {
  state: 'intro' | 'orbit' | 'fly-to-pfp' | 'pfp' | 'fly-to-iso' | 'exit-done';
  playerState: 'idle' | 'walking' | 'running' | 'jumping' | 'falling';
  pos: [number, number, number];
  fov: number;
  onFloor: boolean;
  vel: [number, number, number];
  tick(frames?: number, dt?: number): void;
  setKey(code: string, down: boolean): void;
  jump(): void;
}

const readDebug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bitmap3d?: Bitmap3dDebug }).__bitmap3d!);

// In-browser polling for a state value: avoids the Node<->CDP roundtrip
// per probe, and unlike expect.poll catches transient values reliably.
const waitForState = (page: Page, target: Bitmap3dDebug['state'], timeout = 30_000) =>
  page.waitForFunction(
    s => (window as unknown as { __bitmap3d?: { state: string } }).__bitmap3d?.state === s,
    target,
    { timeout, polling: 100 },
  );

// Run N PFP physics frames at a fixed dt in-browser. Replaces real-time
// rAF (which headless Chromium throttles to ~1Hz) with a deterministic
// loop the test can wait on. 60 frames @ 1/60 dt = 1 simulated second.
const tick = (page: Page, frames: number) =>
  page.evaluate(n => (window as unknown as { __bitmap3d?: Bitmap3dDebug }).__bitmap3d?.tick(n), frames);

const setKey = (page: Page, code: string, down: boolean) =>
  page.evaluate(
    args => (window as unknown as { __bitmap3d?: Bitmap3dDebug }).__bitmap3d?.setKey(args.code, args.down),
    { code, down },
  );

test.describe('bitmap-3d renderer', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(`window.__bitmap3dFixture = ${JSON.stringify({ sizes: fixture.sizes })};`);
    await page.goto('/e2e/bitmap-3d');
    await expect(page.getByTestId('bitmap-3d-renderer')).toBeAttached();
  });

  test('mounts the renderer and reaches the orbit state', async ({ page }) => {
    await expect(page.getByTestId('e2e-sizes-len')).toHaveText(String(fixture.sizes.length));
    await waitForState(page, 'orbit');
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
