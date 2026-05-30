import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for ordpool E2E.
 *
 * - testDir: playwright/specs (kept out of src/ so jest doesn't pick up
 *   .spec.ts files meant for the browser).
 * - Port 4242, not 4200: ordpool's normal dev server and other Angular
 *   dev sessions on this machine collide on 4200. Playwright owns a
 *   dedicated port so the two stacks can run side by side.
 * - webServer: auto-spawns `npm run start:pw` so the dev server is running
 *   before tests fire. start:pw runs `ng serve -c against-prod --port 4242`
 *   which proxies /api/* to the real api.ordpool.space — fine here since
 *   the bitmap-3d E2E route doesn't hit the backend (sizes come from a
 *   Playwright-injected fixture).
 * - reuseExistingServer: lets `npm run start:pw` already running in
 *   another terminal serve the tests, skipping the ~30s cold-start wait.
 *
 * First-run setup: `npx playwright install chromium` (vendored browsers
 * are ~150MB and skipped by `npm install`).
 */
export default defineConfig({
  testDir: './playwright/specs',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
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
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run start:pw',
    url: 'http://localhost:4242',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
