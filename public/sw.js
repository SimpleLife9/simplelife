const CACHE_NAME = 'simplelife-shell-v2';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/leaf.svg', '/precache-manifest.json'];

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
  // Install is committed only after the HTML shell and every compiled
  // JavaScript/CSS/font/image asset needed to boot the app are available.
  await cache.addAll([...new Set([...APP_SHELL, ...assets])]);
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
    event.respondWith((async () => {
      let cachedDocument = null;

      // Read the document while Cache Storage is known to be reachable,
      // before attempting a network request. Keep the Response in memory so
      // the offline branch does not need another Cache API operation after
      // the network has failed or the browser has just restarted.
      try {
        const cache = await caches.open(CACHE_NAME);
        cachedDocument = await cache.match(
          new URL('/index.html', self.location.origin),
          { ignoreVary: true },
        ) || await cache.match(
          new URL('/', self.location.origin),
          { ignoreVary: true },
        );
      } catch (cacheError) {
        console.error('Offline app-shell lookup failed:', cacheError);
      }

      try {
        const response = await fetch(request);
        if (response.ok && (url.pathname === '/' || url.pathname === '/index.html')) {
          try {
            const cache = await caches.open(CACHE_NAME);
            // Refresh both navigation aliases only after a successful response.
            await cache.put('/index.html', response.clone());
            await cache.put('/', response.clone());
          } catch (cacheError) {
            console.error('Online app-shell refresh failed:', cacheError);
          }
        }
        return response;
      } catch (networkError) {
        if (cachedDocument) return cachedDocument;

        console.warn('Offline app-shell document is not cached:', networkError);
        return new Response('SimpleLife necesita abrirse online al menos una vez para preparar este dispositivo.', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  if (APP_SHELL.includes(url.pathname) || url.pathname.startsWith('/assets/')) {
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
