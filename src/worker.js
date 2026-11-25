export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const url = new URL(request.url);

    // Chrome does not implement stale-if-error for browser HTTP cache. Keep
    // the public document fresh for a bounded offline window instead, so a
    // cold navigation can be served without contacting the network at all.
    // Cloudflare identifies browser navigations with Fetch Metadata. Read the
    // header directly because Request.mode is not a reliable signal on every
    // Worker/static-asset request path.
    const isBrowserNavigation = request.headers.get('sec-fetch-mode') === 'navigate'
      || request.mode === 'navigate';
    const isAppNavigation = request.method === 'GET'
      && isBrowserNavigation
      && response.ok;

    // Vite emits content-hashed files under /assets/. They are immutable and
    // can safely remain in the browser HTTP cache across app-shell updates.
    const isHashedBuildAsset = request.method === 'GET'
      && url.pathname.startsWith('/assets/')
      && response.ok;

    if (!isAppNavigation && !isHashedBuildAsset) return response;

    // _headers rules do not apply to Worker-generated responses when
    // run_worker_first is enabled, so set these policies on the Worker response.
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
