import { chromium, test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
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
  await page.waitForFunction(
    () => Boolean(navigator.serviceWorker.controller),
    null,
    { timeout: 20_000 },
  );
  await expect(page.locator('#root > :not(.offline-shell-status)')).toHaveCount(1);

  const isolation = await page.evaluate(() => ({
    isolated: globalThis.crossOriginIsolated === true,
    sharedMemory: typeof globalThis.SharedArrayBuffer === 'function',
  }));
  expect(isolation).toEqual({ isolated: true, sharedMemory: true });

  const cacheAudit = await page.evaluate(async () => {
    const cache = await caches.open('simplelife-shell-v13');
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

test('hosted app document bypasses HTTP cache while hashed bundles remain immutable', async () => {
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

    expect(cacheAudit.documentCacheControl).toMatch(/no-store/i);
    const jsCacheControl = Object.entries(cacheAudit.assetCacheControls)
      .find(([path]) => path.endsWith('.js'))?.[1];
    const cssCacheControl = Object.entries(cacheAudit.assetCacheControls)
      .find(([path]) => path.endsWith('.css'))?.[1];
    expect(jsCacheControl).toMatch(/max-age=31536000/);
    expect(jsCacheControl).toMatch(/immutable/);
    expect(cssCacheControl).toMatch(/max-age=31536000/);
    expect(cssCacheControl).toMatch(/immutable/);

    // App HTML is intentionally not retained by the browser HTTP cache.
    // Offline launch is the Service Worker's responsibility, not a stale
    // seven-day HTML response. The compiled bundles remain immutable.
  } finally {
    await context?.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});





test('an already-controlled PWA fetches the newest document instead of a stale HTTP-cache entry', async ({ browser }) => {
  const workerSource = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');
  let buildVersion = 'build-1';
  let rootDocumentRequests = 0;

  const server = createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const send = (body, contentType, cacheControl = 'public, max-age=31536000, immutable') => {
      response.writeHead(200, {
        'content-type': contentType,
        'cache-control': cacheControl,
      });
      response.end(body);
    };

    if (pathname === '/sw.js') {
      send(workerSource, 'text/javascript; charset=utf-8', 'no-store');
      return;
    }
    if (pathname === '/') {
      rootDocumentRequests += 1;
      send(
        `<!doctype html><html><head><meta charset="utf-8"></head><body><main id="build-version">${buildVersion}</main><script>navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});</script></body></html>`,
        'text/html; charset=utf-8',
      );
      return;
    }
    if (pathname === '/precache-manifest.json') {
      send(JSON.stringify({ version: 1, assets: [] }), 'application/json; charset=utf-8', 'no-store');
      return;
    }
    if (pathname === '/manifest.webmanifest') {
      send(JSON.stringify({ name: 'SimpleLife test' }), 'application/manifest+json');
      return;
    }
    if (pathname === '/leaf.svg') {
      send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>', 'image/svg+xml');
      return;
    }
    if (pathname === '/experiments/stt-local/index.html') {
      send('<!doctype html><title>STT test</title>', 'text/html; charset=utf-8', 'no-store');
      return;
    }
    if (pathname.endsWith('.mjs') || pathname.endsWith('.js')) {
      send('/* same-origin runtime fixture */', 'text/javascript; charset=utf-8');
      return;
    }
    send('ok', 'text/plain; charset=utf-8');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const testOrigin = `http://127.0.0.1:${address.port}/`;
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await page.goto(testOrigin, { waitUntil: 'load' });
    await page.waitForFunction(
      () => Boolean(navigator.serviceWorker.controller),
      null,
      { timeout: 15_000 },
    );
    await expect(page.locator('#build-version')).toHaveText('build-1');

    // Deliberately change the origin's HTML while its prior response still has
    // a one-year HTTP freshness lifetime. A plain fetch(request) would reuse
    // build-1 from the browser cache; the no-store navigation fetch must see 2.
    const requestsBeforeNewBuild = rootDocumentRequests;
    buildVersion = 'build-2';
    await page.goto(testOrigin, { waitUntil: 'load' });
    await expect(page.locator('#build-version')).toHaveText('build-2');
    expect(rootDocumentRequests).toBeGreaterThan(requestsBeforeNewBuild);
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PWA shell v13 replaces v12 cached application and same-origin STT runtime assets', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await page.goto(new URL('/experiments/stt-local/index.html', baseURL).toString(), { waitUntil: 'load' });
    await page.evaluate(async () => {
      const legacy = await caches.open('simplelife-shell-v12');
      await legacy.put(
        new URL('/experiments/stt-local/app.js', window.location.origin),
        new Response('/* stale STT lab script from the previous deployment */', {
          status: 200,
          headers: { 'content-type': 'text/javascript' },
        }),
      );
    });

    await page.goto(appURL, { waitUntil: 'load' });
    await page.waitForFunction(
      () => Boolean(navigator.serviceWorker.controller),
      null,
      { timeout: 20_000 },
    );

    const result = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open('simplelife-shell-v13');
      const document = await cache.match(
        new URL('/experiments/stt-local/index.html', window.location.origin),
        { ignoreVary: true },
      );
      const script = await cache.match(
        new URL('/experiments/stt-local/app.js', window.location.origin),
        { ignoreVary: true },
      );
      const runtimeModule = await cache.match(
        new URL('/vendor/whisper-wasm/0.1.1/index.es.js', window.location.origin),
        { ignoreVary: true },
      );
      const workerModule = await cache.match(
        new URL('/vendor/whisper-wasm/0.1.1/libmain-D9-QM3iM.mjs', window.location.origin),
        { ignoreVary: true },
      );
      return {
        names,
        scriptText: script ? await script.text() : null,
        scriptStatus: script?.status ?? null,
        documentText: document ? await document.text() : null,
        runtimeModuleStatus: runtimeModule?.status ?? null,
        workerModuleStatus: workerModule?.status ?? null,
      };
    });

    expect(result.names).toContain('simplelife-shell-v13');
    expect(result.names).not.toContain('simplelife-shell-v12');
    expect(result.scriptStatus).toBe(200);
    expect(result.runtimeModuleStatus).toBe(200);
    expect(result.workerModuleStatus).toBe(200);
    expect(result.scriptText).toContain('STT_RUNTIME_IMPORT_FAILED [mismo origen]');
    expect(result.scriptText).toContain('STT_MODEL_CHECKSUM_MISMATCH');
    expect(result.scriptText).toContain('const MODEL_SHA256 = "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7";');
    expect(result.scriptText).toContain('function installReadOnlyFetchGuard()');
    expect(result.scriptText).toContain('const WHISPER_WASM_MODULE = "/vendor/whisper-wasm/0.1.1/index.es.js";');
    expect(result.scriptText).not.toContain('cdn.jsdelivr.net');
    expect(result.scriptText).toContain('const WHISPER_CPP_MODEL_URL = "/__stt-whisper/" + MODEL_PATH;');
    expect(result.scriptText).toContain('state.session.streaming(samples');
    expect(result.scriptText).not.toContain('@huggingface/transformers');
    expect(result.documentText).toContain('whisper.cpp');
    expect(result.documentText).toContain('32,2 MB');
  } finally {
    await context.close();
  }
});

test('Cloudflare Preview streams the pinned Whisper.cpp tiny-q5_1 model through the existing Worker', async ({ request }) => {
  test.skip(!process.env.PWA_BASE_URL, 'Requires the deployed Cloudflare Preview Worker.');
  const url = new URL(
    '/__stt-whisper/ggerganov/whisper.cpp/resolve/0b364b566045a405be7225ee1e415a073e04da77/ggml-tiny-q5_1.bin',
    baseURL,
  );
  const response = await request.get(url.toString(), {
    headers: { range: 'bytes=0-63' },
    timeout: 30_000,
  });
  expect(response.status()).toBe(206);
  expect(response.headers()['cache-control']).toMatch(/max-age=31536000/);
  expect(response.headers()['content-range']).toMatch(/^bytes 0-63\/3\d{7}$/);
  expect((await response.body()).byteLength).toBe(64);
});

test('Cloudflare Preview serves the vendored Whisper runtime from the same origin', async ({ request }) => {
  test.skip(!process.env.PWA_BASE_URL, 'Requires the deployed Cloudflare Preview Worker.');
  const assets = [
    ['/vendor/whisper-wasm/0.1.1/index.es.js', './libmain-D9-QM3iM.mjs'],
    ['/vendor/whisper-wasm/0.1.1/libmain-D9-QM3iM.mjs', 'new Worker(new URL'],
  ];
  for (const [path, expectedContent] of assets) {
    const response = await request.get(new URL(path, baseURL).toString(), { timeout: 30_000 });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/javascript/i);
    expect(response.headers()['cross-origin-embedder-policy']).toBe('credentialless');
    expect(response.headers()['cross-origin-resource-policy']).toBe('same-origin');
    expect(response.headers()['cache-control']).toMatch(/max-age=31536000/);
    expect(response.headers()['cache-control']).toMatch(/immutable/i);
    const body = await response.text();
    expect(body).toContain(expectedContent);
    expect(body).not.toContain('cdn.jsdelivr.net');
  }
});

test('isolated local STT lab reopens from the service-worker cache while offline', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const onlinePage = await context.newPage();
    await onlinePage.goto(appURL, { waitUntil: 'load' });
    await onlinePage.waitForFunction(
      () => Boolean(navigator.serviceWorker.controller),
      null,
      { timeout: 20_000 },
    );

    const labURL = new URL('/experiments/stt-local/index.html', baseURL).toString();
    await onlinePage.goto(labURL, { waitUntil: 'load' });
    await expect(onlinePage.getByRole('heading', { name: 'Transcripción local de voz' })).toBeVisible();
    await expect(onlinePage.getByRole('button', { name: 'Descargar y preparar motor' })).toBeEnabled();

    const cachedLab = await onlinePage.evaluate(async () => {
      const cache = await caches.open('simplelife-shell-v13');
      const origin = window.location.origin;
      const documentResponse = await cache.match(new URL('/experiments/stt-local/index.html', origin));
      const scriptResponse = await cache.match(new URL('/experiments/stt-local/app.js', origin));
      const runtimeResponse = await cache.match(new URL('/vendor/whisper-wasm/0.1.1/index.es.js', origin));
      const workerModuleResponse = await cache.match(new URL('/vendor/whisper-wasm/0.1.1/libmain-D9-QM3iM.mjs', origin));
      return {
        documentStatus: documentResponse?.status ?? null,
        scriptStatus: scriptResponse?.status ?? null,
        runtimeStatus: runtimeResponse?.status ?? null,
        workerModuleStatus: workerModuleResponse?.status ?? null,
        documentBytes: Number(documentResponse?.headers.get('content-length') || 0),
        scriptBytes: Number(scriptResponse?.headers.get('content-length') || 0),
      };
    });
    expect(cachedLab.documentStatus).toBe(200);
    expect(cachedLab.scriptStatus).toBe(200);
    expect(cachedLab.runtimeStatus).toBe(200);
    expect(cachedLab.workerModuleStatus).toBe(200);

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
    const offlineIsolation = await offlinePage.evaluate(async () => {
      const paths = [
        '/vendor/whisper-wasm/0.1.1/index.es.js',
        '/vendor/whisper-wasm/0.1.1/libmain-D9-QM3iM.mjs',
      ];
      const responses = await Promise.all(paths.map((path) => fetch(path)));
      return {
        isolated: globalThis.crossOriginIsolated,
        sharedMemory: typeof globalThis.SharedArrayBuffer === 'function',
        runtimeAssetStatuses: responses.map((response) => response.status),
      };
    });
    expect(offlineIsolation).toEqual({
      isolated: true, sharedMemory: true, runtimeAssetStatuses: [200, 200],
    });
    await expect(offlinePage.getByRole('heading', { name: 'Transcripción local de voz' })).toBeVisible();
    await expect(offlinePage.getByRole('button', { name: 'Descargar y preparar motor' })).toBeEnabled();
    await expect(offlinePage.locator('#status')).toContainText('Motor sin cargar');
    expect(sttScriptResponses).toContain(true);
    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});


test('hosted Preview initializes Whisper.cpp and recognizes synthetic Spanish speech locally', async ({ page }) => {
  test.skip(!process.env.PWA_BASE_URL, 'Runs once against the hosted Preview to verify actual Spanish speech recognition.');
  test.setTimeout(360_000);
  const pageErrors = [];
  const workerScripts = [];
  const externalRequests = [];
  const appOrigin = new URL(baseURL).origin;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('worker', (worker) => workerScripts.push(worker.url()));
  page.on('request', (request) => {
    try {
      const requestUrl = new URL(request.url());
      if ((requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:')
        && requestUrl.origin !== appOrigin) {
        externalRequests.push(requestUrl.origin + requestUrl.pathname);
      }
    } catch { /* Ignore non-HTTP browser-internal URLs. */ }
  });

  await page.goto(new URL('/experiments/stt-local/index.html', baseURL).toString(), { waitUntil: 'load' });
  const isolation = await page.evaluate(() => ({
    isolated: globalThis.crossOriginIsolated === true,
    sharedMemory: typeof globalThis.SharedArrayBuffer === 'function',
  }));
  expect(isolation).toEqual({ isolated: true, sharedMemory: true });

  await page.getByRole('button', { name: 'Descargar y preparar motor' }).click();
  await expect(page.locator('#status')).toContainText('Modelo listo y verificado', { timeout: 240_000 });

  const speechFixture = await readFile(
    new URL('../fixtures/audio/synthetic-spanish-voice.wav', import.meta.url),
  );
  await page.locator('#audio-file').setInputFiles({
    name: 'simplelife-synthetic-spanish-speech.wav',
    mimeType: 'audio/wav',
    buffer: speechFixture,
  });
  await page.getByRole('button', { name: 'Transcribir localmente' }).click();
  await expect(page.locator('#status')).toContainText('Prueba terminada en el dispositivo', { timeout: 120_000 });

  const transcript = await page.locator('#transcription').innerText();
  const normalizedTranscript = transcript.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  expect(normalizedTranscript).toContain('soy');
  expect(normalizedTranscript).toContain('carlos');
  expect(workerScripts.some((url) => url.includes('/vendor/whisper-wasm/0.1.1/libmain-D9-QM3iM.mjs'))).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
