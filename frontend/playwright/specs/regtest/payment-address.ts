import { expect, Page } from '@playwright/test';

/**
 * The connected wallet's payment address, read from the wallet popover's
 * `title`, which holds it unshortened.
 *
 * The fund-this-address panel is not a source: it renders only when the
 * funding verdict is 'insufficient', and a wallet profile shared across specs
 * in one lane is already funded by the time a later spec connects it.
 */
export async function readPaymentAddress(page: Page): Promise<string> {
  // The wallet control renders twice (header and collapsed nav); one is visible.
  const button = page.getByTestId('connected-wallet-button').filter({ visible: true });
  const row = page.getByTestId('connected-payment-address');
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();
  await expect(row).toBeVisible();
  const address = await row.getAttribute('title');
  await button.click();
  await expect(row).toBeHidden();
  if (!address || address === 'None') {
    throw new Error(`connected wallet has no payment address (title=${JSON.stringify(address)})`);
  }
  return address;
}
