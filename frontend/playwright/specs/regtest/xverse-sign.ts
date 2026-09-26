import { Page } from '@playwright/test';
import { clickApprovalButton } from 'ordpool-sdk/e2e';

const SETTLE_MS = 30_000;
const POLL_MS = 100;

/**
 * Click Xverse's sign-popup Confirm ONCE and wait until the popup closes or
 * drops the button. Xverse may keep the window open on a result screen, so
 * either outcome means the click registered.
 *
 * No second click: on a signing popup that is a second signature request. A
 * click that never registers fails here, named, with the button's state.
 * `force` skips the actionability wait; the caller has already waited for an
 * enabled Confirm with pointer events.
 */
export async function confirmXverseSign(popup: Page, label: string): Promise<void> {
  const confirm = popup.getByRole('button', { name: /^confirm$/i }).first();
  await clickApprovalButton({ click: (o) => confirm.click({ ...o, force: true }) }, popup, SETTLE_MS);

  const deadline = Date.now() + SETTLE_MS;
  while (!popup.isClosed()) {
    let visible: boolean;
    try {
      visible = await confirm.isVisible();
    } catch (e) {
      // The popup closed between the loop check and this read: that is the success case.
      if (popup.isClosed()) return;
      throw e;
    }
    if (!visible) return;
    if (Date.now() > deadline) {
      const enabled = await confirm.isEnabled();
      throw new Error(
        `${label}: clicked Confirm once and after ${SETTLE_MS} ms the popup is still open with Confirm visible ` +
          `(enabled=${enabled}). Visible and enabled is the swallowed-click signature.`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
