import { test, expect } from '@playwright/test';
import { expectSecondTabBlockedThenTakeover } from './helpers/broadcast-two-tab-flow';

test.describe('BroadcastChannel single-active tab', () => {
  test('second tab is blocked until takeover; then roles swap', async ({ browser }) => {
    const context = await browser.newContext();
    const tab1 = await context.newPage();
    const tab2 = await context.newPage();

    await tab1.goto('/');

    await expectSecondTabBlockedThenTakeover(tab1, tab2);
  });
});

test.describe('Service worker + broadcast flow', () => {
  test('/sw.js controls the page; two-tab broadcast behaviour unchanged', async ({ browser }) => {
    const context = await browser.newContext();
    const tab1 = await context.newPage();

    await tab1.goto('/');

    await tab1.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
    });

    await tab1.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), {
      timeout: 20_000,
    });

    const scriptUrl = await tab1.evaluate(() => {
      const c = navigator.serviceWorker?.controller;
      return c?.scriptURL ?? '';
    });
    expect(scriptUrl).toMatch(/sw\.js$/);

    const tab2 = await context.newPage();

    await expectSecondTabBlockedThenTakeover(tab1, tab2);
  });
});
