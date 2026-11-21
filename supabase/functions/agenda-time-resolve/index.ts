import { resolveLocalDateTime, TzdbVersionError } from "./resolver.ts";

const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, x-client-info, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
export async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { status: 204, headers });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
  const raw = await request.text();
  if (raw.length > 4096) return response({ error: "Request body too large." }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return response({ error: "Valid JSON is required." }, 400); }
  try { return response(resolveLocalDateTime(body), 200); }
  catch (error) {
    if (error instanceof TzdbVersionError) return response({ error: "Timezone rules are unavailable or outdated." }, 503);
    if (error instanceof TypeError || error instanceof RangeError) return response({ error: error.message }, 422);
    return response({ error: "Timezone resolution failed." }, 500);
  }
}
if (import.meta.main) Deno.serve(handleRequest);
