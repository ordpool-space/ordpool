import { defineConfig, devices } from '@playwright/test';
import { LOOPBACK_HOSTS, netLogArgs, offlineLaunchArgs } from 'ordpool-sdk/e2e';

/**
 * Playwright config for ordpool E2E.
 *
 * - Specs are split per project by directory:
 *     e2e/bitmap/desktop  -> only the chromium project runs these
 *     e2e/bitmap/mobile   -> only the mobile (Pixel 7) project
 *   Files dropped in subfolders are picked up automatically.
 * - Port 4242, not 4200: ordpool's normal dev server and other Angular
 *   dev sessions on this machine collide on 4200. Playwright owns a
 *   dedicated port so the two stacks can run side by side.
 * - webServer: auto-spawns `npm run start:ordpool-e2e` so the dev server is
 *   running before tests fire. The script runs `ng serve -c ordpool-e2e
 *   --port 4242`, a serve config with no proxy: no request can leave
 *   localhost. The bitmap-3d E2E route needs no backend, its sizes come from
 *   a Playwright-injected fixture (e2e/bitmap/fixtures/bitmap-800000.json).
 * - reuseExistingServer: lets `npm run start:ordpool-e2e` already running
 *   in another terminal serve the tests, skipping the ~30s cold-start wait.
 * - The browser reaches loopback only (`offlineLaunchArgs` from ordpool-sdk):
 *   every other host fails inside the browser. With ORDPOOL_E2E_NET_LOG_DIR
 *   set, each launch writes Chrome's net log there, and
 *   `node node_modules/ordpool-sdk/scripts/check-net-log.mjs <dir>` fails on
 *   anything that left the machine.
 *
 * First-run setup: `npm run ordpool-e2e:install` (vendored browsers are
 * ~150MB and skipped by `npm install`).
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

/** The launch switches of one project: render at full rate, offline, net log named for the project. */
const launchArgs = (project: string): string[] => [
  ...KEEP_ALIVE_FLAGS,
  ...offlineLaunchArgs(LOOPBACK_HOSTS),
  ...netLogArgs(`bitmap-${project}`),
];

/**
 * The per-wait bound (TESTING.md): every assertion, action, navigation and
 * in-page wait (`waitForFunction`, `waitForState`). A state that needs longer
 * is a defect in the renderer or the harness, fixed there.
 */
const WAIT_TIMEOUT_MS = 30_000;

export default defineConfig({
  testMatch: '**/*.e2e.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Zero retries: a retry hides a failure behind a second roll of the dice.
  retries: 0,
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
    timeout: WAIT_TIMEOUT_MS,
  },
  use: {
    baseURL: 'http://localhost:4242',
    actionTimeout: WAIT_TIMEOUT_MS,
    navigationTimeout: WAIT_TIMEOUT_MS,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testDir: './e2e/bitmap/desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: launchArgs('desktop') },
      },
    },
    {
      name: 'mobile',
      testDir: './e2e/bitmap/mobile',
      // Pixel 7: hasTouch=true, isMobile=true, 412×915 viewport, dpr=2.625.
      // Matches the "(pointer: coarse) OR maxTouchPoints>0" branch the
      // renderer uses to switch into mobile-perf + touch-controls mode.
      use: {
        ...devices['Pixel 7'],
        launchOptions: { args: launchArgs('mobile') },
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
