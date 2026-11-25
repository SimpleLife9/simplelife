export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const url = new URL(request.url);

    // Chrome does not implement stale-if-error for browser HTTP cache. Keep
    // the public document fresh for a bounded offline window instead, so a
    // cold navigation can be served without contacting the network at all.
    const isAppNavigation = request.method === 'GET'
      && request.mode === 'navigate'
      && response.ok;

    // Vite emits content-hashed files under /assets/. They are immutable and
    // can safely remain in the browser HTTP cache across app-shell updates.
    const isHashedBuildAsset = request.method === 'GET'
      && url.pathname.startsWith('/assets/')
      && response.ok;

    if (!isAppNavigation && !isHashedBuildAsset) return response;

    const headers = new Headers(response.headers);
    if (isAppNavigation) {
      headers.set('Cache-Control', 'public, max-age=604800');
    } else {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
