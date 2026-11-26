const STT_MODEL_ROUTE = "/__stt-model/";
const STT_MODEL_ID = "onnx-community/whisper-tiny";
const STT_MODEL_REVISION = "ff4177021cc41f7db950912b73ea4fdf7d01d8e7";
const STT_MODEL_PREFIX = STT_MODEL_ID + "/resolve/" + STT_MODEL_REVISION + "/";
const STT_MODEL_FILES = new Set([
  "added_tokens.json",
  "config.json",
  "generation_config.json",
  "merges.txt",
  "normalizer.json",
  "preprocessor_config.json",
  "quantize_config.json",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
  "onnx/decoder_model_merged_quantized.onnx",
  "onnx/encoder_model_quantized.onnx",
]);
const STT_UPSTREAM_HOSTS = new Set([
  "huggingface.co",
  "hf.co",
  "cas-server.xethub.hf.co",
  "cas-server.xethub-eu.hf.co",
  "transfer.xethub.hf.co",
  "transfer.xethub-eu.hf.co",
  "us.aws.cdn.hf.co",
  "us.gcp.cdn.hf.co",
  "cdn-lfs-us-1.hf.co",
  "cdn-lfs-eu-1.hf.co",
]);

function sttProxyError(status, message) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// This is a narrow, read-only relay for the public, immutable Whisper snapshot.
// Audio never reaches this route: only model files from the fixed allowlist do.
export async function proxyWhisperModelFile(request, upstreamFetch = fetch) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(STT_MODEL_ROUTE)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return sttProxyError(405, "STT_MODEL_METHOD_NOT_ALLOWED");
  }
  if (url.search) return sttProxyError(400, "STT_MODEL_QUERY_NOT_ALLOWED");

  let relativePath;
  try {
    relativePath = decodeURIComponent(url.pathname.slice(STT_MODEL_ROUTE.length));
  } catch {
    return sttProxyError(400, "STT_MODEL_PATH_INVALID");
  }
  if (!relativePath.startsWith(STT_MODEL_PREFIX)) {
    return sttProxyError(404, "STT_MODEL_SNAPSHOT_NOT_FOUND");
  }
  const filePath = relativePath.slice(STT_MODEL_PREFIX.length);
  if (!STT_MODEL_FILES.has(filePath) || filePath.includes("..") || filePath.startsWith("/")) {
    return sttProxyError(404, "STT_MODEL_FILE_NOT_ALLOWED");
  }

  const upstreamUrl = new URL(STT_MODEL_PREFIX + filePath, "https://huggingface.co/");
  const upstreamHeaders = new Headers();
  for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }

  let upstream;
  try {
    upstream = await upstreamFetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "follow",
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
  } catch {
    return sttProxyError(502, "STT_MODEL_UPSTREAM_UNAVAILABLE");
  }

  const finalUrl = upstream.url ? new URL(upstream.url) : upstreamUrl;
  if (!STT_UPSTREAM_HOSTS.has(finalUrl.hostname)) {
    return sttProxyError(502, "STT_MODEL_UPSTREAM_HOST_REJECTED");
  }
  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
    return sttProxyError(upstream.status, "STT_MODEL_UPSTREAM_HTTP_" + upstream.status);
  }

  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const modelResponse = await proxyWhisperModelFile(request);
    if (modelResponse) return modelResponse;

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
