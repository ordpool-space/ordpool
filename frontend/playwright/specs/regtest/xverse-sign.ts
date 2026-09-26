import { Locator, Page } from '@playwright/test';
import { clickApprovalButton, clickUntilEffect } from 'ordpool-sdk/e2e';

/**
 * Confirm an Xverse sign popup and wait for the dapp's `outcome` (its success
 * or error surface).
 *
 * Xverse can drop a Confirm click: the button enters its loading state, then
 * the popup returns to "Review transaction" with Confirm enabled and nothing
 * signed. A second click is sent only in that state, which precedes any
 * signature, so it never requests a second one. Confirm loading, gone, or the
 * popup closed means the click registered, and the outcome is waited on.
 */
export async function confirmXverseSign(popup: Page, outcome: Locator, label: string): Promise<void> {
  const confirm = popup.getByRole('button', { name: /^confirm$/i }).filter({ visible: true }).first();
  await clickUntilEffect(
    {
      click: () => clickApprovalButton(confirm, popup, 30_000),
      isVisible: () => confirm.isVisible(),
      isEnabled: () => confirm.isEnabled(),
    },
    outcome,
    { label, settleMs: 45_000, maxClicks: 3 },
  );
}
