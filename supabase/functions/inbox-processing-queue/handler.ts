import { uuidv7 } from "../../../src/lib/uuidv7.js";
import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
} from "../_shared/agenda-event-profile.ts";

export const MAX_REQUEST_BYTES = 8 * 1024;
export const PROCESSOR_VERSION = "inbox-proposal-v1";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
type AdminClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: any }>;
};
type UserQuery = {
  select(columns: string): UserQuery;
  eq(column: string, value: string): UserQuery;
  is(column: string, value: null): UserQuery;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
};
type Context = Omit<EventAuthenticatedContext, "supabase"> & {
  supabase: { from(table: string): UserQuery };
  supabaseAdmin: AdminClient;
};
type Dependencies = { newRunId?: () => string };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
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
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** User-authenticated enqueue. No browser write to processing_run is allowed. */
export async function handleRequest(
  request: Request,
  ctx: Context,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "CONTENT_TYPE_MUST_BE_JSON" }, 415);
  }
  const profile = await resolveActiveEventProfile(ctx as unknown as EventAuthenticatedContext);
  if (!profile.ok) return json({ error: profile.code }, profile.status);

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
  if (!UUID_V7.test(idempotencyKey)) return json({ error: "IDEMPOTENCY_KEY_MUST_BE_UUIDV7" }, 422);

  let raw: string | null;
  try { raw = await readBoundedBody(request); } catch {
    return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400);
  }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || !("captureId" in body)) {
    return json({ error: "BODY_MUST_CONTAIN_ONLY_CAPTURE_ID" }, 422);
  }
  const captureId = (body as { captureId: unknown }).captureId;
  if (typeof captureId !== "string" || !UUID_V7.test(captureId)) {
    return json({ error: "CAPTURE_ID_MUST_BE_UUIDV7" }, 422);
  }

  let capture: { data: unknown; error: unknown };
  try {
    capture = await ctx.supabase.from("capture").select("id")
      .eq("id", captureId).is("deleted_at", null).maybeSingle();
  } catch { return json({ error: "CAPTURE_LOOKUP_FAILED" }, 503); }
  if (capture.error) return json({ error: "CAPTURE_LOOKUP_FAILED" }, 503);
  if (!capture.data) return json({ error: "CAPTURE_NOT_FOUND" }, 404);

  const runId = (dependencies.newRunId ?? uuidv7)();
  if (!UUID_V7.test(runId)) return json({ error: "PROCESSING_RUN_ID_INVALID" }, 500);
  const result = await ctx.supabaseAdmin.rpc("enqueue_inbox_processing_run", {
    p_run_id: runId,
    p_owner_profile_id: profile.profileId,
    p_capture_id: captureId,
    p_idempotency_key: idempotencyKey.toLowerCase(),
    p_processor_version: PROCESSOR_VERSION,
  });
  if (result.error) {
    if (result.error.code === "42501" || result.error.code === "P0002") return json({ error: "CAPTURE_NOT_FOUND" }, 404);
    if (result.error.code === "55000") return json({ error: "CAPTURE_ALREADY_PROCESSED" }, 409);
    if (result.error.code === "23505") return json({ error: "IDEMPOTENCY_KEY_REUSED" }, 409);
    return json({ error: "PROCESSING_ENQUEUE_FAILED" }, 503);
  }
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row || typeof row !== "object") return json({ error: "PROCESSING_ENQUEUE_RESULT_INVALID" }, 503);
  const run = row as Record<string, unknown>;
  if (typeof run.run_id !== "string" || typeof run.run_status !== "string"
    || typeof run.attempt_number !== "number") return json({ error: "PROCESSING_ENQUEUE_RESULT_INVALID" }, 503);
  return json({
    runId: run.run_id, status: run.run_status,
    attemptNumber: run.attempt_number, replayed: run.replayed === true,
  }, 202);
}
