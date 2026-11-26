import { chromium, test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseURL = process.env.PWA_BASE_URL || 'http://127.0.0.1:4173';
const appURL = new URL('/', baseURL).toString();

async function prepareOnlineShell(page) {
  const assetCacheControls = {};
  const appOrigin = new URL(appURL).origin;

  page.on('response', (response) => {
    const responseUrl = new URL(response.url());
    if (responseUrl.origin === appOrigin && responseUrl.pathname.startsWith('/assets/')) {
      assetCacheControls[responseUrl.pathname] = response.headers()['cache-control'] || null;
    }
  });

  const documentResponse = await page.goto(appURL, { waitUntil: 'load' });
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

  const cacheAudit = await page.evaluate(async () => {
    const cache = await caches.open('simplelife-shell-v5');
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
    const indexDocument = await cache.match(
      new URL('/index.html', window.location.origin).href,
      { ignoreVary: true },
    );
    const rootDocument = await cache.match(
      new URL('/', window.location.origin).href,
      { ignoreVary: true },
    );
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      assetCount: manifest.assets.length,
      missing,
      cachedUrls,
      documentCached: Boolean(indexDocument),
      indexDocumentStatus: indexDocument?.status ?? null,
      rootDocumentStatus: rootDocument?.status ?? null,
    };
  });

  return {
    ...cacheAudit,
    documentCacheControl: documentResponse?.headers()['cache-control'] || null,
    assetCacheControls,
  };
}

test('a cold app launch works offline after one successful online visit', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const onlinePage = await context.newPage();
  const cacheAudit = await prepareOnlineShell(onlinePage);

  expect(cacheAudit.controlled).toBe(true);
  expect(cacheAudit.assetCount).toBeGreaterThan(0);
  expect(cacheAudit.missing).toEqual([]);
  expect(cacheAudit.documentCached).toBe(true);
  expect(cacheAudit.indexDocumentStatus).toBe(200);
  expect(cacheAudit.rootDocumentStatus).toBe(200);
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
    expect(cacheAudit.indexDocumentStatus).toBe(200);
    expect(cacheAudit.rootDocumentStatus).toBe(200);

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

test('hosted cold launch works from the browser HTTP cache even without a Service Worker', async () => {
  test.skip(!process.env.PWA_BASE_URL, 'Requires the deployed Cloudflare Preview cache headers.');

  const userDataDir = await mkdtemp(join(tmpdir(), 'simplelife-pwa-http-cache-'));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      serviceWorkers: 'allow',
    });

    const onlinePage = context.pages()[0] || await context.newPage();
    const cacheAudit = await prepareOnlineShell(onlinePage);

    expect(cacheAudit.documentCacheControl).toMatch(/max-age=604800/);
    const jsCacheControl = Object.entries(cacheAudit.assetCacheControls)
      .find(([path]) => path.endsWith('.js'))?.[1];
    const cssCacheControl = Object.entries(cacheAudit.assetCacheControls)
      .find(([path]) => path.endsWith('.css'))?.[1];
    expect(jsCacheControl).toMatch(/max-age=31536000/);
    expect(jsCacheControl).toMatch(/immutable/);
    expect(cssCacheControl).toMatch(/max-age=31536000/);
    expect(cssCacheControl).toMatch(/immutable/);

    // Remove the registration in this disposable profile to prove that the
    // browser HTTP cache alone can recover the shell and its hashed bundles.
    const remainingRegistrations = await onlinePage.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      return (await navigator.serviceWorker.getRegistrations()).length;
    });
    expect(remainingRegistrations).toBe(0);

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

    const response = await offlinePage.goto(appURL, {
      waitUntil: 'load',
      timeout: 15_000,
    });
    expect(response?.ok()).toBe(true);
    await expect(offlinePage.locator('#root > :not(.offline-shell-status)')).toHaveCount(1);
    expect(await offlinePage.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(false);
    expect(pageErrors).toEqual([]);
  } finally {
    await context?.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});




test('a new Service Worker cache version replaces stale cached STT lab code', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await page.goto(new URL('/experiments/stt-local/index.html', baseURL).toString(), { waitUntil: 'load' });
    await page.evaluate(async () => {
      const legacy = await caches.open('simplelife-shell-v4');
      await legacy.put(
        new URL('/experiments/stt-local/app.js', window.location.origin),
        new Response('/* stale STT lab script from the previous deployment */', {
          status: 200,
          headers: { 'content-type': 'text/javascript' },
        }),
      );
    });

    await page.goto(appURL, { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
      await page.reload({ waitUntil: 'load' });
    }
    await page.waitForFunction(
      () => Boolean(navigator.serviceWorker.controller),
      null,
      { timeout: 20_000 },
    );

    const result = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open('simplelife-shell-v5');
      const script = await cache.match(
        new URL('/experiments/stt-local/app.js', window.location.origin),
        { ignoreVary: true },
      );
      return {
        names,
        scriptText: script ? await script.text() : null,
        scriptStatus: script?.status ?? null,
      };
    });

    expect(result.names).toContain('simplelife-shell-v5');
    expect(result.names).not.toContain('simplelife-shell-v4');
    expect(result.scriptStatus).toBe(200);
    expect(result.scriptText).toContain('STT_RUNTIME_IMPORT_FAILED [cdn.jsdelivr.net]');
    expect(result.scriptText).toContain('STT_MODEL_OR_WASM_LOAD_FAILED:');
    expect(result.scriptText).toContain('const MODEL_REMOTE_PATH_TEMPLATE = "{model}/resolve/" + MODEL_REVISION + "/";');
    expect(result.scriptText).toContain('function pinModelRevisionUrl(url)');
    expect(result.scriptText).toContain('"/" + MODEL_ID + "/resolve/" + MODEL_REVISION + "/"');
    expect(result.scriptText).toContain('env.remotePathTemplate = MODEL_REMOTE_PATH_TEMPLATE;');
  } finally {
    await context.close();
  }
});

test('STT lab pins Transformers.js metadata preflights to the immutable model revision', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    const modelRequests = [];
    await page.route('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'access-control-allow-origin': '*',
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
        },
        body: `
          export const env = {
            remotePathTemplate: "{model}/resolve/{revision}/",
            backends: { onnx: { wasm: { numThreads: 0 } } },
          };
          export async function pipeline(_task, model) {
            const hubRequest = await fetch(
              "https://huggingface.co/" + model + "/resolve/main/config.json",
            );
            const localRequest = await fetch(
              location.origin + "/__stt-model/" + model + "/resolve/main/config.json",
            );
            if (!hubRequest.ok || !localRequest.ok) {
              throw new Error("Mock model config returned " + hubRequest.status + "/" + localRequest.status);
            }
            return async () => ({ text: "" });
          }
        `,
      });
    });
    await page.route('https://huggingface.co/**', async (route) => {
      modelRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        headers: {
          'access-control-allow-origin': '*',
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: '{"model_type":"whisper"}',
      });
    });
    const sameOriginModelRequests = [];
    await page.route('**/__stt-model/**', async (route) => {
      sameOriginModelRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=86400',
        },
        body: '{"model_type":"whisper"}',
      });
    });

    await page.goto(appURL, { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
      await page.reload({ waitUntil: 'load' });
    }
    await page.waitForFunction(
      () => Boolean(navigator.serviceWorker.controller),
      null,
      { timeout: 20_000 },
    );

    const labURL = new URL('/experiments/stt-local/index.html', baseURL).toString();
    await page.goto(labURL, { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Descargar y preparar modelo' }).click();
    await expect(page.locator('#status')).toContainText('Modelo listo.', { timeout: 10_000 });

    expect(modelRequests).toEqual([]);
    expect(sameOriginModelRequests).toEqual([
      new URL('/__stt-model/onnx-community/whisper-tiny/resolve/ff4177021cc41f7db950912b73ea4fdf7d01d8e7/config.json', baseURL).toString(),
      new URL('/__stt-model/onnx-community/whisper-tiny/resolve/ff4177021cc41f7db950912b73ea4fdf7d01d8e7/config.json', baseURL).toString(),
    ]);
    await expect(page.getByRole('button', { name: 'Transcribir localmente' })).toBeDisabled();
  } finally {
    await context.close();
  }
});

test('Cloudflare Preview serves pinned Whisper metadata through the same-origin model proxy', async ({ request }) => {
  test.skip(!process.env.PWA_BASE_URL, 'Requires the deployed Cloudflare Preview Worker.');
  const url = new URL(
    '/__stt-model/onnx-community/whisper-tiny/resolve/ff4177021cc41f7db950912b73ea4fdf7d01d8e7/config.json',
    baseURL,
  );
  const response = await request.get(url.toString(), { timeout: 30_000 });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toMatch(/max-age=86400/);
  const config = await response.json();
  expect(config.model_type).toBe('whisper');
  expect(config.vocab_size).toBe(51865);
});

test('isolated local STT lab reopens from the service-worker cache while offline', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const onlinePage = await context.newPage();
    await onlinePage.goto(appURL, { waitUntil: 'load' });
    await onlinePage.evaluate(() => navigator.serviceWorker.ready);
    if (!await onlinePage.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
      await onlinePage.reload({ waitUntil: 'load' });
    }
    await onlinePage.waitForFunction(
      () => Boolean(navigator.serviceWorker.controller),
      null,
      { timeout: 20_000 },
    );

    const labURL = new URL('/experiments/stt-local/index.html', baseURL).toString();
    await onlinePage.goto(labURL, { waitUntil: 'load' });
    await expect(onlinePage.getByRole('heading', { name: 'Transcripción local de voz' })).toBeVisible();
    await expect(onlinePage.getByRole('button', { name: 'Descargar y preparar modelo' })).toBeEnabled();

    const cachedLab = await onlinePage.evaluate(async () => {
      const cache = await caches.open('simplelife-shell-v5');
      const origin = window.location.origin;
      const documentResponse = await cache.match(new URL('/experiments/stt-local/index.html', origin));
      const scriptResponse = await cache.match(new URL('/experiments/stt-local/app.js', origin));
      return {
        documentStatus: documentResponse?.status ?? null,
        scriptStatus: scriptResponse?.status ?? null,
        documentBytes: Number(documentResponse?.headers.get('content-length') || 0),
        scriptBytes: Number(scriptResponse?.headers.get('content-length') || 0),
      };
    });
    expect(cachedLab.documentStatus).toBe(200);
    expect(cachedLab.scriptStatus).toBe(200);

    await context.setOffline(true);
    const offlinePage = await context.newPage();

    const serviceWorkerSession = await context.newCDPSession(offlinePage);
    await serviceWorkerSession.send('Network.enable');
    // Clear the HTTP cache but preserve Cache Storage. The following
    // navigation must therefore be answered by the Service Worker cache.
    await serviceWorkerSession.send('Network.clearBrowserCache');
    await serviceWorkerSession.send('ServiceWorker.enable');
    await serviceWorkerSession.send('ServiceWorker.startWorker', { scopeURL: appURL });

    const rootResponse = await offlinePage.goto(appURL, { waitUntil: 'load', timeout: 15_000 });
    expect(rootResponse?.ok()).toBe(true);
    expect(rootResponse?.fromServiceWorker()).toBe(true);
    await offlinePage.waitForFunction(
      () => Boolean(navigator.serviceWorker.controller),
      null,
      { timeout: 15_000 },
    );

    const externalRequests = [];
    const pageErrors = [];
    const sttScriptResponses = [];
    offlinePage.on('request', (request) => {
      if (new URL(request.url()).origin !== new URL(labURL).origin) {
        externalRequests.push(request.url());
      }
    });
    offlinePage.on('response', (response) => {
      if (new URL(response.url()).pathname === '/experiments/stt-local/app.js') {
        sttScriptResponses.push(response.fromServiceWorker());
      }
    });
    offlinePage.on('pageerror', (error) => pageErrors.push(error.message));

    const response = await offlinePage.goto(labURL, { waitUntil: 'load', timeout: 15_000 });
    expect(response?.ok()).toBe(true);
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(offlinePage.getByRole('heading', { name: 'Transcripción local de voz' })).toBeVisible();
    await expect(offlinePage.getByRole('button', { name: 'Descargar y preparar modelo' })).toBeEnabled();
    await expect(offlinePage.locator('#status')).toContainText('Motor sin cargar');
    expect(sttScriptResponses).toContain(true);
    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
