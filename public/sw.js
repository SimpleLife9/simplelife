const CACHE_NAME = 'simplelife-shell-v7';
// Cloudflare's SPA asset handler redirects /index.html to /. Precache the
// canonical root document, then store a separate /index.html alias below.
const STT_LAB_DOCUMENT = '/experiments/stt-local/index.html';
const STT_LAB_ASSETS = [
  STT_LAB_DOCUMENT,
  '/experiments/stt-local/app.js',
];
const APP_SHELL = [
  '/', '/manifest.webmanifest', '/leaf.svg', '/precache-manifest.json',
];

async function readBuildAssetManifest() {
  const response = await fetch('/precache-manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('The offline asset manifest is unavailable.');
  const manifest = await response.json();
  if (manifest?.version !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error('The offline asset manifest is invalid.');
  }
  return manifest.assets.filter((path) => (
    typeof path === 'string'
    && path.startsWith('/')
    && !path.startsWith('//')
    && !path.includes('..')
  ));
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const assets = await readBuildAssetManifest();
  // Install is committed only after the canonical HTML shell and every
  // compiled JavaScript/CSS/font/image asset needed to boot the app exist.
  await cache.addAll([...new Set([...APP_SHELL, ...assets])]);

  // Stable STT lab paths must bypass the browser HTTP cache during every
  // Service Worker version install. Otherwise a fresh vN Cache Storage bucket
  // can be populated with an old HTML/JS response retained by max-age headers.
  for (const path of STT_LAB_ASSETS) {
    const url = new URL(path, self.location.origin);
    const request = new Request(url, { cache: 'reload' });
    const response = await fetch(request);
    if (!response.ok) {
      throw new Error('The current STT lab asset could not be refreshed: ' + path);
    }
    await cache.put(url, response);
  }

  // Cloudflare serves /index.html as a 307 redirect to /. Never store that
  // redirect as the offline document: it loops when the browser is offline.
  const rootDocument = await cache.match(
    new URL('/', self.location.origin),
    { ignoreVary: true },
  );
  if (!rootDocument || rootDocument.status !== 200 || !rootDocument.ok) {
    throw new Error('The canonical offline app-shell document was not cached.');
  }
  await cache.put(
    new URL('/index.html', self.location.origin),
    rootDocument.clone(),
  );

  await self.skipWaiting();
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('simplelife-shell-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Cache only public application resources. Authenticated API responses,
// Supabase traffic, and personal data are never stored by this service worker.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin
    || url.pathname.startsWith('/rest/')) return;

  if (request.mode === 'navigate') {
    const navigationResponse = (async () => {
      let cachedDocument = null;
      let cachedSttLabDocument = null;
      const isSttLabNavigation = url.pathname === STT_LAB_DOCUMENT
        || url.pathname === '/experiments/stt-local/';

      // Prefer the canonical root document. Only accept a real HTTP 200 page,
      // never a hosted SPA redirect from /index.html back to /.
      try {
        const cache = await caches.open(CACHE_NAME);
        const cachedRoot = await cache.match(
          new URL('/', self.location.origin),
          { ignoreVary: true },
        );
        const cachedIndex = await cache.match(
          new URL('/index.html', self.location.origin),
          { ignoreVary: true },
        );
        cachedSttLabDocument = await cache.match(
          new URL(STT_LAB_DOCUMENT, self.location.origin),
          { ignoreVary: true },
        );
        if (cachedSttLabDocument?.status !== 200 || !cachedSttLabDocument.ok) {
          cachedSttLabDocument = null;
        }
        cachedDocument = [cachedRoot, cachedIndex].find((candidate) => (
          candidate && candidate.status === 200 && candidate.ok
        )) || null;
      } catch (cacheError) {
        console.error('Offline app-shell lookup failed:', cacheError);
      }

      // Do not even start a network fetch when the browser is offline.
      // A cached document is enough to boot the already-precached app shell.
      if (!self.navigator.onLine) {
        if (isSttLabNavigation && cachedSttLabDocument) return cachedSttLabDocument;
        if (cachedDocument) return cachedDocument;
        return new Response('SimpleLife necesita abrirse online al menos una vez para preparar este dispositivo.', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }

      try {
        const response = await fetch(request);
        if (response.ok && isSttLabNavigation) {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(STT_LAB_DOCUMENT, response.clone());
          } catch (cacheError) {
            console.error('STT lab document cache failed:', cacheError);
          }
        }
        if (response.ok && (url.pathname === '/' || url.pathname === '/index.html')) {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put('/index.html', response.clone());
            await cache.put('/', response.clone());
          } catch (cacheError) {
            console.error('Online app-shell refresh failed:', cacheError);
          }
        }
        return response;
      } catch (networkError) {
        // A navigation to the isolated STT lab must recover its own cached
        // document when the network fails, not silently fall back to the app.
        if (isSttLabNavigation && cachedSttLabDocument) return cachedSttLabDocument;
        if (cachedDocument) return cachedDocument;

        console.warn('Offline app-shell document is not cached:', networkError);
        return new Response('SimpleLife necesita abrirse online al menos una vez para preparar este dispositivo.', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
    })().catch((navigationError) => {
      // Never let an unexpected cache/worker exception reject respondWith()
      // and surface to Chrome as ERR_FAILED.
      console.error('SimpleLife navigation fallback failed:', navigationError);
      return new Response('No se pudo recuperar el inicio offline de SimpleLife.', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    });

    event.respondWith(navigationResponse);
    return;
  }

  if (APP_SHELL.includes(url.pathname)
    || STT_LAB_ASSETS.includes(url.pathname)
    || url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      // Preview/static hosts may add Vary: Origin even for identical public bundles.
      // Ignore that header difference when serving same-origin immutable build assets.
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
