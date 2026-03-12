import { test, expect } from '@playwright/test';

// This test exercises the SingleTabManager via the takeover strategy page.
// It verifies:
// - First tab becomes active.
// - Second tab opens while first is active -> starts blocked and manager.isActive() is false.
// - Second tab stays blocked until user clicks the "Take Over Control" button.
// - After takeover, only the second tab is active (localStorage owner changes).

const TEST_KEY = 'single-active-tab';
const PAGE = '/cypress-test-page.html?strategy=takeover&heartbeat=2000';

test.describe('SingleTabManager - one active tab with takeover', () => {
  test('second tab remains inactive until user triggers takeover', async ({ browser, baseURL }) => {
    const context = await browser.newContext();

    // ----- Tab 1: open app and become active -----
    const page1 = await context.newPage();
    await page1.goto(baseURL! + PAGE);

    await page1.getByText('Start Manager').click();
    const status1 = page1.locator('#status');
    await expect(status1).toHaveClass(/active/);
    await expect(status1).toContainText('Active Tab');

    // Capture first tab's ID from localStorage
    const firstTabId = await page1.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { id?: string };
        return parsed.id ?? null;
      } catch {
        return null;
      }
    }, TEST_KEY);
    expect(firstTabId).not.toBeNull();

    // ----- Tab 2: open same page again in same browser context -----
    const page2 = await context.newPage();
    await page2.goto(baseURL! + PAGE);

    await page2.getByText('Start Manager').click();

    const status2 = page2.locator('#status');
    await expect(status2).toHaveClass(/blocked/);
    await expect(status2).toContainText('Blocked');

    const takeoverButton = page2.locator('#btn-takeover');
    await expect(takeoverButton).toBeEnabled();

    // From this tab's manager perspective, isActive() must be false
    const isActiveInTab2 = await page2.evaluate(() => {
      const anyWin = window as any;
      const manager = typeof anyWin.getManager === 'function' ? anyWin.getManager() : null;
      return manager ? manager.isActive() : null;
    });
    expect(isActiveInTab2).toBe(false);

    // Wait a bit to ensure it does not auto-takeover while first tab is still "alive"
    await page2.waitForTimeout(2500);
    await expect(status2).toHaveClass(/blocked/);

    // ----- User explicitly triggers takeover on second tab -----
    await takeoverButton.click();

    await expect(status2).toHaveClass(/active/);
    await expect(status2).toContainText('Active Tab');
    await expect(takeoverButton).toBeDisabled();

    // LocalStorage owner should now be different from the first tab's ID
    const secondTabId = await page2.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { id?: string };
        return parsed.id ?? null;
      } catch {
        return null;
      }
    }, TEST_KEY);

    expect(secondTabId).not.toBeNull();
    if (firstTabId && secondTabId) {
      expect(secondTabId).not.toBe(firstTabId);
    }

    await context.close();
  });
});

