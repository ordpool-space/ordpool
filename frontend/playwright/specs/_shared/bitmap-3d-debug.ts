import { expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Shared helpers + types for the bitmap-3d Playwright specs (desktop +
 * mobile). Lives outside both project testDirs so Playwright doesn't try
 * to execute it as a spec file.
 */

export interface Bitmap3dDebug {
  state: 'intro' | 'orbit' | 'fly-to-pfp' | 'pfp' | 'fly-to-iso' | 'exit-done';
  playerState: 'idle' | 'walking' | 'running' | 'jumping' | 'falling';
  pos: [number, number, number];
  fov: number;
  onFloor: boolean;
  vel: [number, number, number];
  joy: { fwd: number; right: number };
  look: { x: number; y: number };
  touchOn: boolean;
  pfpOn: boolean;
  tick(frames?: number, dt?: number): void;
  setKey(code: string, down: boolean): void;
  jump(): void;
}

type Win = Window & { __bitmap3d?: Bitmap3dDebug };

/**
 * Block 800,000 — canonical E2E bitmap. Healthy variety of cube sizes
 * (1-6) so step-up (size-1 auto-climb) and jump (size-2+) both get
 * exercised, immutable on-chain, lives in playwright/fixtures/.
 */
export const loadBitmapFixture = (height = 800_000): { sizes: number[] } =>
  JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, `../../fixtures/bitmap-${height}.json`),
      'utf8',
    ),
  );

export const readDebug = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__bitmap3d!);

/**
 * In-browser polling for a state value. Avoids Node<->CDP roundtrip per
 * probe and unlike expect.poll catches transient values reliably.
 */
export const waitForState = (page: Page, target: Bitmap3dDebug['state'], timeout = 30_000) =>
  page.waitForFunction(
    s => (window as unknown as Win).__bitmap3d?.state === s,
    target,
    { timeout, polling: 100 },
  );

/**
 * Run N PFP physics frames at a fixed dt in-browser. Replaces real-time
 * rAF (which headless Chromium throttles to ~1Hz) with a deterministic
 * loop. 60 frames @ 1/60 dt = 1 simulated second.
 */
export const tick = (page: Page, frames: number) =>
  page.evaluate(n => (window as unknown as Win).__bitmap3d?.tick(n), frames);

export const setKey = (page: Page, code: string, down: boolean) =>
  page.evaluate(
    args => (window as unknown as Win).__bitmap3d?.setKey(args.code, args.down),
    { code, down },
  );

/**
 * Common beforeEach: inject the fixture via addInitScript so it's
 * available before the SPA boots, navigate to /e2e/bitmap-3d, assert
 * the renderer mounted.
 */
export const mountFixture = async (page: Page, sizes: number[]): Promise<void> => {
  await page.addInitScript(`window.__bitmap3dFixture = ${JSON.stringify({ sizes })};`);
  await page.goto('/e2e/bitmap-3d');
  await expect(page.getByTestId('bitmap-3d-renderer')).toBeAttached();
};
