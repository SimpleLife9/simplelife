import { resolveLocalDateTime, resolveLocalDateTimeRange, TzdbVersionError } from "./resolver.ts";

export const MAX_REQUEST_BYTES = 4096;

const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, x-client-info, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Read at most MAX_REQUEST_BYTES from the request stream.
 * Returns null when the payload crosses the byte limit. This avoids buffering
 * an arbitrarily large body before rejecting it.
 */
async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The request is already rejected; cancellation is best effort.
        }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return response({ error: "Content-Type must be application/json." }, 415);
  }

  let raw: string | null;
  try {
    raw = await readBoundedBody(request);
  } catch {
    return response({ error: "Request body must be valid UTF-8." }, 400);
  }

  if (raw === null) return response({ error: "Request body too large." }, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return response({ error: "Valid JSON is required." }, 400);
  }

  try {
    const isRange = !!body
      && typeof body === "object"
      && !Array.isArray(body)
      && ("start" in body || "end" in body);
    return response(isRange ? resolveLocalDateTimeRange(body) : resolveLocalDateTime(body), 200);
  } catch (error) {
    if (error instanceof TzdbVersionError) {
      return response({ error: "Timezone rules are unavailable or outdated." }, 503);
    }
    if (error instanceof TypeError || error instanceof RangeError) {
      return response({ error: error.message }, 422);
    }
    return response({ error: "Timezone resolution failed." }, 500);
  }
}

