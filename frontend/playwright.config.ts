import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for ordpool E2E.
 *
 * - Specs are split per project by directory:
 *     playwright/specs/desktop  -> only the chromium project runs these
 *     playwright/specs/mobile   -> only the mobile (Pixel 7) project
 *   Files dropped in subfolders are picked up automatically.
 * - Port 4242, not 4200: ordpool's normal dev server and other Angular
 *   dev sessions on this machine collide on 4200. Playwright owns a
 *   dedicated port so the two stacks can run side by side.
 * - webServer: auto-spawns `npm run start:ordpool-e2e` so the dev server is
 *   running before tests fire. The script runs `ng serve -c against-prod
 *   --port 4242` which proxies /api/* to the real api.ordpool.space — fine
 *   here since the bitmap-3d E2E route doesn't hit the backend (sizes come
 *   from a Playwright-injected fixture).
 * - reuseExistingServer: lets `npm run start:ordpool-e2e` already running
 *   in another terminal serve the tests, skipping the ~30s cold-start wait.
 *
 * First-run setup: `npx playwright install chromium` (vendored browsers
 * are ~150MB and skipped by `npm install`).
 */

// Headless Chromium throttles setInterval and rAF to ~1Hz when there's
// no compositor — empirically that eats every wait the bitmap renderer's
// physics-grounded transitions need (waitForFunction itself polls via
// setInterval inside the page). These flags keep the rendering pipeline
// running at full rate.
const KEEP_ALIVE_FLAGS = [
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion',
];

export default defineConfig({
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // Two reporters: a console one (GitHub annotations in CI, list-style
  // locally) plus HTML always. The HTML directory (`playwright-report/`)
  // gets uploaded as a workflow artifact in CI; locally, `npx playwright
  // show-report` opens it. `open: 'never'` keeps it from auto-launching
  // a browser on a green run.
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  // Each test pays a one-time setup tax in headless: full Angular boot,
  // three.js dynamic import, octree build for 3721 cubes, intro tween
  // (~3.3s). 30-40s of that sits inside beforeEach before the test body
  // even runs. 180s gives the body its own breathing room.
  timeout: 180_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: 'http://localhost:4242',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testDir: './playwright/specs/desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: KEEP_ALIVE_FLAGS },
      },
    },
    {
      name: 'mobile',
      testDir: './playwright/specs/mobile',
      // Pixel 7: hasTouch=true, isMobile=true, 412×915 viewport, dpr=2.625.
      // Matches the "(pointer: coarse) OR maxTouchPoints>0" branch the
      // renderer uses to switch into mobile-perf + touch-controls mode.
      use: {
        ...devices['Pixel 7'],
        launchOptions: { args: KEEP_ALIVE_FLAGS },
      },
    },
  ],
  webServer: {
    command: 'npm run start:ordpool-e2e',
    url: 'http://localhost:4242',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
