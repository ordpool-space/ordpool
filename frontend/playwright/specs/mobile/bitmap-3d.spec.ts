import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Same canonical fixture as the desktop spec.
const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../fixtures/bitmap-800000.json'), 'utf8'),
);

interface Bitmap3dDebug {
  state: string;
  playerState: string;
  pos: [number, number, number];
  fov: number;
  onFloor: boolean;
  joy: { fwd: number; right: number };
  look: { x: number; y: number };
  touchOn: boolean;
  pfpOn: boolean;
  tick(frames?: number, dt?: number): void;
  setKey(code: string, down: boolean): void;
  jump(): void;
}

const readDebug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bitmap3d?: Bitmap3dDebug }).__bitmap3d!);

const waitForState = (page: Page, target: string, timeout = 30_000) =>
  page.waitForFunction(
    s => (window as unknown as { __bitmap3d?: { state: string } }).__bitmap3d?.state === s,
    target,
    { timeout, polling: 100 },
  );

const tick = (page: Page, frames: number) =>
  page.evaluate(n => (window as unknown as { __bitmap3d?: Bitmap3dDebug }).__bitmap3d?.tick(n), frames);

test.describe('bitmap-3d renderer (mobile)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(`window.__bitmap3dFixture = ${JSON.stringify({ sizes: fixture.sizes })};`);
    await page.goto('/e2e/bitmap-3d');
    await expect(page.getByTestId('bitmap-3d-renderer')).toBeAttached();
  });

  test('renderer mounts on a touch device + reports a touch viewport', async ({ page }) => {
    const env = await page.evaluate(() => ({
      hasTouch: navigator.maxTouchPoints > 0,
      pointer: matchMedia('(pointer: coarse)').matches,
      vw: window.innerWidth,
    }));
    // Sanity: emulation is doing its job. The renderer's mobile branch
    // gates on the same OR of conditions.
    expect(env.hasTouch || env.pointer || env.vw < 1024).toBe(true);
    await waitForState(page, 'orbit');
  });

  test('PFP entry on mobile shows the touch UI (touch-on + pfp-on classes)', async ({ page }) => {
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');

    const d = await readDebug(page);
    // The user's bug: "no controls at all". If these flip to false on a
    // real touch device, that's the bug reproduced. Assert positively.
    expect(d.pfpOn).toBe(true);
    expect(d.touchOn).toBe(true);
  });

  test('jump button is visible (display:flex) after PFP entry', async ({ page }) => {
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');

    const jumpBtn = page.locator('app-bitmap-3d-renderer .touch-jump');
    await expect(jumpBtn).toHaveCount(1);
    await expect(jumpBtn).toBeVisible();
    const display = await jumpBtn.evaluate(el => getComputedStyle(el).display);
    expect(display).toBe('flex');
  });

  test('joystick zones are present and visible after PFP entry', async ({ page }) => {
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');

    const left = page.locator('app-bitmap-3d-renderer .touch-joy-zone-left');
    const right = page.locator('app-bitmap-3d-renderer .touch-joy-zone-right');
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();

    const leftDisplay = await left.evaluate(el => getComputedStyle(el).display);
    expect(leftDisplay).toBe('block');
  });

  test('tapping the jump button triggers a jump', async ({ page }) => {
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');
    await tick(page, 1);

    // The button binds touchstart -> triggerJump (sets jumpPulse=true).
    // dispatchEvent('touchstart') is enough — no need for full touch
    // sequence since the handler just reads from the event.
    await page.locator('app-bitmap-3d-renderer .touch-jump').dispatchEvent('touchstart');

    // jumpPulse is consumed by the next physics frame; tick once to see
    // the velocity set, again to see playerState classify as 'jumping'.
    await tick(page, 2);
    expect((await readDebug(page)).playerState).toBe('jumping');
  });

  test('nipplejs renders its joystick UI inside the zone after PFP entry', async ({ page }) => {
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');

    // nipplejs appends its back + front circles to the zone via addToDom.
    // Polled because the dynamic import + create is async after PFP entry.
    await page.waitForFunction(() => {
      const z = document.querySelector('app-bitmap-3d-renderer .touch-joy-zone-left');
      return !!(z && z.childElementCount > 0);
    }, undefined, { timeout: 10_000, polling: 100 });
  });

  test('dragging the left joystick zone moves joy.fwd off zero', async ({ page }) => {
    await waitForState(page, 'orbit');
    await page.getByTestId('e2e-enter-pfp').dispatchEvent('click');
    await waitForState(page, 'pfp');
    await tick(page, 1);
    // nipplejs init is async (dynamic import after PFP entry). Wait
    // until its UI is appended to the zone, which is a clean signal
    // that pointerdown/pointermove listeners are bound.
    await page.waitForFunction(() => {
      const z = document.querySelector('app-bitmap-3d-renderer .touch-joy-zone-left');
      return !!(z && z.childElementCount > 0);
    }, undefined, { timeout: 10_000, polling: 100 });

    // Dispatch synthetic PointerEvents from inside the page — nipplejs
    // binds pointerdown on the zone and pointermove/pointerup on the
    // document (it prefers PointerEvent over TouchEvent when both are
    // available, which is always in modern Chromium). Sample joy.fwd
    // BEFORE pointerup so the renderer's 'end' callback doesn't zero
    // it before we read.
    const fwdDuringDrag = await page.evaluate(() => {
      const zone = document.querySelector('app-bitmap-3d-renderer .touch-joy-zone-left') as HTMLElement;
      const rect = zone.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const fire = (
        target: EventTarget,
        type: 'pointerdown' | 'pointermove' | 'pointerup',
        x: number, y: number,
      ) => {
        target.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, view: window,
          pointerId: 1, pointerType: 'touch', isPrimary: true,
          clientX: x, clientY: y, screenX: x, screenY: y,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: type === 'pointerup' ? 0 : 0.5,
        }));
      };

      // pointerdown on zone, then 8 pointermoves dragging 60px upward
      // on the document. nipplejs y is screen-inverted, so dragging up
      // is positive joy.fwd.
      fire(zone, 'pointerdown', cx, cy);
      for (let i = 1; i <= 8; i++) fire(document, 'pointermove', cx, cy - (60 * i) / 8);
      const captured = (window as any).__bitmap3d.joy.fwd;
      fire(document, 'pointerup', cx, cy - 60);
      return captured;
    });

    expect(fwdDuringDrag).toBeGreaterThan(0);
  });
});
