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
      try {
        const response = await fetch(request);
        if (response.ok && (url.pathname === '/' || url.pathname === '/index.html')) {
          const cache = await caches.open(CACHE_NAME);
          // Keep the last successfully delivered app document available for
          // a cold launch when the next navigation happens without a network.
          await cache.put('/index.html', response.clone());
          await cache.put('/', response.clone());
        }
        return response;
      } catch {
        // The public HTML shell is safe to serve offline. Preview hosts may
        // vary public documents by request headers, so ignore Vary here just
        // as we do for the immutable JS/CSS bundle.
        try {
          const cache = await caches.open(CACHE_NAME);
          const cachedDocument = await cache.match(
            new URL('/index.html', self.location.origin),
            { ignoreVary: true },
          ) || await cache.match(
            new URL('/', self.location.origin),
            { ignoreVary: true },
          );
          if (cachedDocument) return cachedDocument;
        } catch (cacheError) {
          console.error('Offline app-shell fallback failed:', cacheError);
        }

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
