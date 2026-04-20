import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** First tab on `/` becomes the active owner once the manager finishes negotiation. */
export async function expectFirstTabActive(tab1: Page): Promise<void> {
  await expect(tab1.getByTestId('status-active')).toBeVisible();
}

/**
 * Second tab opens the same app: should be blocked, then takeover flips roles.
 * Assertion timeouts come from `playwright.config.ts` → `expect.timeout`.
 */
export async function expectSecondTabBlockedThenTakeover(tab1: Page, tab2: Page): Promise<void> {
  await expectFirstTabActive(tab1);

  await tab2.goto('/');

  await expect(tab2.getByTestId('status-blocked')).toBeVisible();
  await expect(tab2.getByTestId('takeover-button')).toBeEnabled();

  await tab2.getByTestId('takeover-button').click();

  await expect(tab2.getByTestId('status-active')).toBeVisible();
  await expect(tab1.getByTestId('status-blocked')).toBeVisible();
}
