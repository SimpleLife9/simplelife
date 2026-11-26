const STT_CPP_MODEL_ROUTE = "/__stt-whisper/";
const STT_CPP_MODEL_REVISION = "0b364b566045a405be7225ee1e415a073e04da77";
const STT_CPP_MODEL_PREFIX = "ggerganov/whisper.cpp/resolve/" + STT_CPP_MODEL_REVISION + "/";
const STT_CPP_MODEL_FILE = "ggml-tiny-q5_1.bin";
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
  "cdn-lfs.huggingface.co",
  "cas-bridge.xethub.hf.co",
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

// This route streams one public, immutable model file. It never accepts audio,
// arbitrary repository paths, mutable revisions, or write requests.
export async function proxyWhisperCppModelFile(request, upstreamFetch = fetch) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(STT_CPP_MODEL_ROUTE)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return sttProxyError(405, "STT_MODEL_METHOD_NOT_ALLOWED");
  }
  if (url.search) return sttProxyError(400, "STT_MODEL_QUERY_NOT_ALLOWED");

  let relativePath;
  try {
    relativePath = decodeURIComponent(url.pathname.slice(STT_CPP_MODEL_ROUTE.length));
  } catch {
    return sttProxyError(400, "STT_MODEL_PATH_INVALID");
  }
  if (relativePath !== STT_CPP_MODEL_PREFIX + STT_CPP_MODEL_FILE) {
    return sttProxyError(404, "STT_MODEL_FILE_NOT_ALLOWED");
  }

  const upstreamUrl = new URL(
    STT_CPP_MODEL_PREFIX + STT_CPP_MODEL_FILE,
    "https://huggingface.co/",
  );
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
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const modelResponse = await proxyWhisperCppModelFile(request);
    if (modelResponse) return modelResponse;

    const response = await env.ASSETS.fetch(request);
    const url = new URL(request.url);

    const isBrowserNavigation = request.headers.get("sec-fetch-mode") === "navigate"
      || request.mode === "navigate";
    const isAppNavigation = request.method === "GET"
      && isBrowserNavigation
      && response.ok;
    const isHashedBuildAsset = request.method === "GET"
      && url.pathname.startsWith("/assets/")
      && response.ok;
    const isSttLabAsset = request.method === "GET"
      && response.ok
      && (url.pathname === "/experiments/stt-local/index.html"
        || url.pathname === "/experiments/stt-local/app.js");

    if (!isAppNavigation && !isHashedBuildAsset && !isSttLabAsset) return response;

    const headers = new Headers(response.headers);
    if (isSttLabAsset) {
      // These stable public paths are deliberately mutable between Preview
      // revisions. Never let the browser/CDN retain a previous lab build.
      headers.set("Cache-Control", "no-store");
    } else if (isAppNavigation) {
      headers.set("Cache-Control", "public, max-age=604800");
    } else {
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
