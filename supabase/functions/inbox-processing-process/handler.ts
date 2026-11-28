import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
} from "../_shared/agenda-event-profile.ts";
import { handleRequest as processWorkerRequest } from "../inbox-processing-worker/handler.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_REQUEST_BYTES = 2 * 1024;
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
type Context = Omit<EventAuthenticatedContext, "supabase"> & {
  supabase: { from(table: string): any };
  supabaseAdmin: { rpc(name: string, args: Record<string, unknown>): Promise<{data: unknown; error: any}> };
};
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        try { await reader.cancel(); } catch { /* best effort */ }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Owner-authenticated bridge. The browser never receives service credentials. */
export async function handleRequest(
  request: Request, ctx: Context, dependencies: {newLeaseToken?:()=>string} = {},
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "CONTENT_TYPE_MUST_BE_JSON" }, 415);
  }
  const profile = await resolveActiveEventProfile(ctx as unknown as EventAuthenticatedContext);
  if (!profile.ok) return json({ error: profile.code }, profile.status);
  let raw: string | null;
  try { raw = await readBoundedBody(request); } catch {
    return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400);
  }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || !("runId" in body)) {
    return json({ error: "BODY_MUST_CONTAIN_ONLY_RUN_ID" }, 422);
  }
  const runId = (body as {runId: unknown}).runId;
  if (typeof runId !== "string" || !UUID.test(runId)) return json({ error: "RUN_ID_MUST_BE_UUIDV7" }, 422);

  const visible = await ctx.supabase.from("processing_run").select("id").eq("id", runId).maybeSingle();
  if (visible.error) return json({ error: "PROCESSING_RUN_LOOKUP_FAILED" }, 503);
  if (!visible.data) return json({ error: "PROCESSING_RUN_NOT_FOUND" }, 404);

  const internalRequest = new Request("https://inbox-worker.internal/process", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "process", runId }),
  });
  return await processWorkerRequest(internalRequest, {
    authMode: "secret", supabaseAdmin: ctx.supabaseAdmin,
  }, dependencies);
}
