import { test, expect } from '@playwright/test';

test('a cold app launch works offline after one successful online visit', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const onlinePage = await context.newPage();
  await onlinePage.goto('/');
  await onlinePage.waitForLoadState('load');

  await onlinePage.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!await onlinePage.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await onlinePage.reload();
  }
  await expect(onlinePage.locator('#root > *')).toHaveCount(1);

  const cacheAudit = await onlinePage.evaluate(async () => {
    const response = await fetch('/precache-manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Build precache manifest could not be read.');
    const manifest = await response.json();
    const cache = await caches.open('simplelife-shell-v2');
    const cachedUrls = (await cache.keys()).map((request) => new URL(request.url).pathname);
    const missing = [];
    for (const asset of manifest.assets) {
      if (!await cache.match(asset)) missing.push(asset);
    }
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      assetCount: manifest.assets.length,
      missing,
      cachedUrls,
    };
  });

  expect(cacheAudit.controlled).toBe(true);
  expect(cacheAudit.assetCount).toBeGreaterThan(0);
  expect(cacheAudit.missing).toEqual([]);
  expect(cacheAudit.cachedUrls).toContain('/index.html');
  expect(cacheAudit.cachedUrls).toContain('/precache-manifest.json');
  expect(cacheAudit.cachedUrls.some((url) => url.endsWith('.js'))).toBe(true);
  expect(cacheAudit.cachedUrls.some((url) => url.endsWith('.css'))).toBe(true);
  expect(cacheAudit.cachedUrls.some((url) => url.includes('supabase.co'))).toBe(false);

  // Close the already-running document, then open the same app origin offline.
  await onlinePage.close();
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  const pageErrors = [];
  offlinePage.on('pageerror', (error) => pageErrors.push(error.message));

  const response = await offlinePage.goto('/', { waitUntil: 'load', timeout: 15_000 });
  expect(response?.ok()).toBe(true);
  await expect(offlinePage.locator('#root > *')).toHaveCount(1);
  expect(await offlinePage.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  expect(pageErrors).toEqual([]);

  await context.close();
});
