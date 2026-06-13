import { defineConfig } from '@playwright/test';
import * as path from 'node:path';

/**
 * Playwright config for the regtest cat21-mint round-trip suite.
 *
 * Runs ONLY in CI — the workflow (`e2e-regtest-mint.yml`) takes
 * responsibility for:
 *   - bringing up bitcoind + electrs + mariadb (via the SDK's
 *     consumer-environment),
 *   - starting ordpool-backend on :8999,
 *   - serving the frontend at FRONTEND_URL with the regtest serve
 *     config,
 *   - downloading + unpacking the Xverse `.crx` (via the SDK's
 *     `playwright-bootstrap.sh xverse`),
 *   - running the SDK's globalSetup against regtest to seed the
 *     Xverse vault.
 *
 * This config doesn't auto-spawn anything. It just points Playwright
 * at the spec directory and tells the runner about CI quirks.
 *
 * Headless mode is disabled because Xverse — like every wallet
 * extension — relies on a real renderer; the workflow runs Playwright
 * under xvfb to give it a display.
 */
export default defineConfig({
  testDir: path.resolve(__dirname, 'playwright/specs/regtest'),
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // Each spec includes ~2 wallet popups + 2 block mines + electrs
  // polling. The default 60s isn't anywhere near enough.
  timeout: 480_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    headless: false,
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { outputFolder: 'playwright-report-regtest', open: 'never' }],
  ],
  outputDir: path.resolve(__dirname, 'test-results'),
});
