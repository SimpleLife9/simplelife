import { chromium, test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseURL = process.env.PWA_BASE_URL || 'http://127.0.0.1:4173';
const appURL = new URL('/', baseURL).toString();

async function prepareOnlineShell(page) {
  await page.goto(appURL, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'load' });
  }

  await page.waitForFunction(
    () => Boolean(navigator.serviceWorker.controller),
    null,
    { timeout: 20_000 },
  );
  await expect(page.locator('#root > :not(.offline-shell-status)')).toHaveCount(1);

  return page.evaluate(async () => {
    const cache = await caches.open('simplelife-shell-v2');
    const manifestResponse = await cache.match(
      new URL('/precache-manifest.json', window.location.origin).href,
      { ignoreVary: true },
    );
    if (!manifestResponse) throw new Error('Build precache manifest was not stored.');

    const manifest = await manifestResponse.json();
    const missing = [];
    for (const asset of manifest.assets) {
      const cached = await cache.match(new URL(asset, window.location.origin).href, {
        ignoreVary: true,
      });
      if (!cached) missing.push(asset);
    }

    const cachedUrls = (await cache.keys()).map((request) => new URL(request.url).pathname);
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      assetCount: manifest.assets.length,
      missing,
      cachedUrls,
      documentCached: Boolean(await cache.match(
        new URL('/index.html', window.location.origin).href,
        { ignoreVary: true },
      )),
    };
  });
}

test('a cold app launch works offline after one successful online visit', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const onlinePage = await context.newPage();
  const cacheAudit = await prepareOnlineShell(onlinePage);

  expect(cacheAudit.controlled).toBe(true);
  expect(cacheAudit.assetCount).toBeGreaterThan(0);
  expect(cacheAudit.missing).toEqual([]);
  expect(cacheAudit.documentCached).toBe(true);
  expect(cacheAudit.cachedUrls).toContain('/index.html');
  expect(cacheAudit.cachedUrls).toContain('/precache-manifest.json');
  expect(cacheAudit.cachedUrls.some((url) => url.endsWith('.js'))).toBe(true);
  expect(cacheAudit.cachedUrls.some((url) => url.endsWith('.css'))).toBe(true);
  expect(cacheAudit.cachedUrls.some((url) => url.includes('supabase.co'))).toBe(false);

  // Keep the installed origin alive while Chromium's offline emulation is
  // enabled. This tests a genuine cold navigation in a new tab without
  // terminating the only running worker before the browser can wake it.
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  const pageErrors = [];
  offlinePage.on('pageerror', (error) => pageErrors.push(error.message));

  const serviceWorkerSession = await context.newCDPSession(offlinePage);
  await serviceWorkerSession.send('ServiceWorker.enable');
  await serviceWorkerSession.send('ServiceWorker.startWorker', { scopeURL: appURL });

  const response = await offlinePage.goto(appURL, { waitUntil: 'load', timeout: 15_000 });
  expect(response?.ok()).toBe(true);
  await expect(offlinePage.locator('#root > :not(.offline-shell-status)')).toHaveCount(1);
  expect(await offlinePage.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  expect(pageErrors).toEqual([]);

  await context.close();
});

test('a cold app launch stays available offline after closing and reopening the browser', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'simplelife-pwa-profile-'));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      serviceWorkers: 'allow',
    });

    const onlinePage = context.pages()[0] || await context.newPage();
    const cacheAudit = await prepareOnlineShell(onlinePage);
    expect(cacheAudit.controlled).toBe(true);
    expect(cacheAudit.missing).toEqual([]);
    expect(cacheAudit.documentCached).toBe(true);

    // Closing the persistent context flushes the browser profile to disk.
    // Reopening it below verifies that the SW registration and Cache Storage
    // survive a complete browser-session restart, not just a new tab.
    await context.close();
    context = undefined;

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      serviceWorkers: 'allow',
    });
    await context.setOffline(true);

    const offlinePage = context.pages()[0] || await context.newPage();
    const pageErrors = [];
    offlinePage.on('pageerror', (error) => pageErrors.push(error.message));

    // On a closed profile Chromium may leave the SW process stopped. Wake the
    // persisted registration through CDP, matching the browser's worker-start
    // lifecycle before the first offline PWA navigation.
    const serviceWorkerSession = await context.newCDPSession(offlinePage);
    await serviceWorkerSession.send('ServiceWorker.enable');
    await serviceWorkerSession.send('ServiceWorker.startWorker', { scopeURL: appURL });

    const response = await offlinePage.goto(appURL, {
      waitUntil: 'load',
      timeout: 15_000,
    });
    expect(response?.ok()).toBe(true);
    await expect(offlinePage.locator('#root > :not(.offline-shell-status)')).toHaveCount(1);
    expect(await offlinePage.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await context?.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
