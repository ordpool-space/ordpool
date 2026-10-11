import { defineConfig } from '@playwright/test';
import * as path from 'node:path';
import { E2E_TIMEOUT_ENV } from 'ordpool-sdk/e2e';

/**
 * The per-wait bound (TESTING.md): every assertion, action, navigation and
 * page event, and, through ORDPOOL_E2E_TIMEOUT_MS, every SDK polling helper
 * (electrs, ord, bitcoind, a wallet popup search). A state that needs longer
 * to arrive is a defect in the app, the harness or the helper, fixed there,
 * never by raising this bound.
 */
const WAIT_TIMEOUT_MS = 30_000;
process.env[E2E_TIMEOUT_ENV] = String(WAIT_TIMEOUT_MS);

/**
 * The per-test bound. A test is a sequence of waits, not one wait.
 * Twice the longest green test: 142 s, cat21-mint-dirty-matrix cell 2 in ordpool run 37765141941.
 */
const TEST_TIMEOUT_MS = 300_000;

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
  // Zero retries, on purpose. A retry hides a real failure behind a second roll
  // of the dice, and these specs share a chain: a retry re-runs a mutated cell
  // against already-mutated state, so its result is meaningless anyway. A flake
  // here is an error to FIX (a missing wait, a race), not to paper over. If a
  // wallet popup times out, the fix is a better wait, not another attempt.
  retries: 0,
  timeout: TEST_TIMEOUT_MS,
  expect: {
    timeout: WAIT_TIMEOUT_MS,
  },
  use: {
    headless: false,
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: WAIT_TIMEOUT_MS,
    navigationTimeout: WAIT_TIMEOUT_MS,
  },
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { outputFolder: 'playwright-report-regtest', open: 'never' }],
  ],
  outputDir: path.resolve(__dirname, 'test-results'),
});
