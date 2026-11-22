import {
  applyAuthoritativeEventResolution,
  buildEventTimeResolutionRequest,
  createEventDraft,
} from "../../../src/features/agenda/domain/event.js";
import { buildEventInsertRecord } from "../../../src/features/agenda/domain/event-record.js";
import { hashEventMutationIntent, normalizeEventMutation } from "../../../src/features/agenda/domain/event-mutation.js";
import { normalizeEventIdempotencyKey } from "../../../src/features/agenda/domain/event-idempotency.js";
import { uuidv7 } from "../../../src/lib/uuidv7.js";
import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
} from "../_shared/agenda-event-profile.ts";
import { resolveLocalDateTimeRange, TzdbVersionError } from "../agenda-time-resolve/resolver.ts";

export const MAX_REQUEST_BYTES = 32 * 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const EDIT_FIELDS = [
  "title",
  "description",
  "location_label",
  "location_kind",
  "temporal_kind",
  "start_date",
  "end_date_exclusive",
  "start_local",
  "end_local",
  "time_zone",
  "starts_at",
  "ends_at",
  "start_disambiguation",
  "end_disambiguation",
  "start_gap_strategy",
  "end_gap_strategy",
] as const;

type RpcClient = {
  from(table: string): any;
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};
type Context = EventAuthenticatedContext & { supabaseAdmin: RpcClient };
type Dependencies = {
  now?: () => string;
};

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

function toEventPatch(record: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of EDIT_FIELDS) patch[field] = record[field];
  return patch;
}

/**
 * Authenticated Event edit/status/lifecycle writer.
 *
 * All mutations use an owner-scoped UUIDv7 key and the caller's exact
 * updated_at value. The SECURITY INVOKER RPC performs the compare-and-swap,
 * saves the receipt and lets the database audit trigger append atomically.
 * The browser never writes calendar_event, audit_event or the receipt table.
 */
export async function handleRequest(
  request: Request,
  ctx: Context,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return json({ error: "CONTENT_TYPE_MUST_BE_JSON" }, 415);

  const profile = await resolveActiveEventProfile(ctx);
  if (!profile.ok) return json({ error: profile.code }, profile.status);

  let idempotencyKey: string;
  try {
    idempotencyKey = normalizeEventIdempotencyKey(request.headers.get("idempotency-key"));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "INVALID_IDEMPOTENCY_KEY" }, 422);
  }

  let raw: string | null;
  try {
    raw = await readBoundedBody(request);
  } catch {
    return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400);
  }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "EVENT_MUTATION_BODY_MUST_BE_AN_OBJECT" }, 422);
  }
  const input = body as Record<string, unknown>;
  const allowedKeys = input.action === "edit"
    ? ["action", "event", "eventId", "expectedUpdatedAt"]
    : ["action", "eventId", "expectedUpdatedAt"];
  if (Object.keys(input).length !== allowedKeys.length
    || Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    return json({ error: "EVENT_MUTATION_BODY_HAS_UNSUPPORTED_FIELDS" }, 422);
  }

  try {
    const mutation = normalizeEventMutation({
      eventId: input.eventId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      action: String(input.action),
      eventDraft: input.action === "edit"
        ? createEventDraft(input.event)
        : null,
    });
    const intent = await hashEventMutationIntent(mutation);

    // Replay a completed receipt before resolving civil time. A retry must
    // return its original result even if the current TZDB package is unavailable
    // or has changed since the winning mutation.
    const existing = await ctx.supabaseAdmin
      .from("event_mutation_request")
      .select("event_id,payload_version,payload_hash,response_http_status,response_body")
      .eq("owner_user_id", profile.profileId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing.error) return json({ error: "IDEMPOTENCY_LOOKUP_FAILED" }, 503);
    if (existing.data) {
      const storedHash = existing.data.payload_hash instanceof Uint8Array
        ? Array.from(existing.data.payload_hash as Uint8Array).map((byte) => byte.toString(16).padStart(2, "0")).join("")
        : typeof existing.data.payload_hash === "string"
        ? existing.data.payload_hash.replace(/^\\x/, "")
        : "";
      if (existing.data.event_id !== mutation.eventId
        || existing.data.payload_version !== intent.version
        || storedHash !== intent.payloadHash) {
        return json({ error: "IDEMPOTENCY_KEY_REUSED" }, 409);
      }
      if (typeof existing.data.response_http_status !== "number"
        || !existing.data.response_body
        || typeof existing.data.response_body !== "object") {
        return json({ error: "EVENT_MUTATION_RECEIPT_INCOMPLETE" }, 503);
      }
      return json({
        ...(existing.data.response_body as Record<string, unknown>),
        replayed: true,
      }, existing.data.response_http_status);
    }

    const now = (dependencies.now ?? (() => new Date().toISOString()))();
    let eventPatch: Record<string, unknown> = {};
    if (mutation.action === "edit") {
      let readyDraft = mutation.eventDraft!;
      if (readyDraft.temporal.kind === "zoned_civil") {
        const resolution = resolveLocalDateTimeRange(buildEventTimeResolutionRequest(readyDraft));
        readyDraft = applyAuthoritativeEventResolution(readyDraft, resolution);
      }
      const record = buildEventInsertRecord({
        eventDraft: readyDraft,
        eventId: mutation.eventId,
        ownerProfileId: profile.profileId,
        now,
      });
      eventPatch = toEventPatch(record as unknown as Record<string, unknown>);
    }

    const result = await ctx.supabaseAdmin.rpc("mutate_calendar_event_once", {
      p_owner_user_id: profile.profileId,
      p_event_id: mutation.eventId,
      p_idempotency_key: idempotencyKey,
      p_payload_version: intent.version,
      p_payload_hash_hex: intent.payloadHash,
      p_expected_updated_at: mutation.expectedUpdatedAt,
      p_mutation: mutation.action,
      p_event_patch: eventPatch,
      p_now: now,
    });
    if (result.error) return json({ error: "EVENT_MUTATION_FAILED" }, 503);

    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row || typeof row !== "object") return json({ error: "EVENT_MUTATION_RESULT_INVALID" }, 503);
    const outcome = row as Record<string, unknown>;
    const status = outcome.http_status;
    if (typeof status !== "number" || !outcome.response_body || typeof outcome.response_body !== "object") {
      return json({ error: "EVENT_MUTATION_RESULT_INVALID" }, 503);
    }
    return json({
      ...(outcome.response_body as Record<string, unknown>),
      replayed: outcome.replayed === true,
    }, status);
  } catch (error) {
    if (error instanceof TzdbVersionError) return json({ error: "TIMEZONE_RULES_UNAVAILABLE" }, 503);
    if (error instanceof TypeError || error instanceof RangeError) {
      return json({ error: error.message }, 422);
    }
    return json({ error: "EVENT_MUTATION_FAILED" }, 500);
  }
}
