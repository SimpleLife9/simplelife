export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const url = new URL(request.url);

    // Browser HTTP-cache fallback for the public app document. The Service
    // Worker remains the primary offline path; stale-if-error lets Chromium
    // recover the last successful shell if a cold navigation cannot wake it.
    if (request.method === 'GET'
      && request.mode === 'navigate'
      && (url.pathname === '/' || url.pathname === '/index.html')
      && response.ok) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=0, stale-if-error=604800');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return response;
  },
};
