import {
  applyAuthoritativeEventResolution,
  buildEventTimeResolutionRequest,
  createEventDraft,
} from "../../../src/features/agenda/domain/event.js";
import { buildEventInsertRecord } from "../../../src/features/agenda/domain/event-record.js";
import {
  hashEventCreateIntent,
  normalizeEventIdempotencyKey,
} from "../../../src/features/agenda/domain/event-idempotency.js";
import { uuidv7 } from "../../../src/lib/uuidv7.js";
import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
} from "../_shared/agenda-event-profile.ts";
import { resolveLocalDateTimeRange, TzdbVersionError } from "../agenda-time-resolve/resolver.ts";
import { normalizeProtectedTimeConflictDecisions } from "../../../src/features/agenda/domain/protected-time.js";
import {
  assessEventProtectedTimeConflicts,
  buildProtectedTimeSnapshot,
  decisionsMatchConflicts,
  MAX_PROTECTED_TIME_BLOCKS,
} from "../_shared/agenda-protected-time-conflicts.ts";

export const MAX_REQUEST_BYTES = 32 * 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type AdminClient = {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};
type Context = EventAuthenticatedContext & { supabaseAdmin: AdminClient };
type Dependencies = {
  now?: () => string;
  newEventId?: () => string;
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

function receiptResponse(data: Record<string, unknown>, replayed: boolean): Response {
  if (typeof data.result_event_id !== "string"
    || typeof data.response_created_at !== "string"
    || typeof data.response_event_status !== "string") {
    return json({ error: "EVENT_CREATE_RECEIPT_INCOMPLETE" }, 503);
  }
  return json({
    eventId: data.result_event_id,
    createdAt: new Date(data.response_created_at).toISOString(),
    eventStatus: data.response_event_status,
    replayed,
  }, 201);
}


type ProtectedTimeState = {
  blocks: Array<Record<string, unknown>>;
  snapshot: Array<{ id: string; updatedAt: string }>;
  viewerTimeZone: string;
};

async function readProtectedTimeState(
  ctx: Context,
  ownerProfileId: string,
): Promise<ProtectedTimeState> {
  const { data, error } = await ctx.supabaseAdmin
    .from("protected_time_block")
    .select("id,label,category,protection_mode,pattern_kind,time_zone,starts_at,ends_at,start_date,end_date_exclusive,weekdays,start_time_local,end_time_local,ends_next_day,updated_at")
    .eq("owner_user_id", ownerProfileId)
    .is("archived_at", null)
    .is("deleted_at", null)
    .order("id", { ascending: true })
    .limit(MAX_PROTECTED_TIME_BLOCKS + 1);
  if (error) throw new Error("PROTECTED_TIME_LOOKUP_FAILED");
  if (!Array.isArray(data) || data.length > MAX_PROTECTED_TIME_BLOCKS) {
    throw new Error("PROTECTED_TIME_BLOCK_LIMIT_EXCEEDED");
  }

  const preference = await ctx.supabaseAdmin
    .from("user_preference")
    .select("time_zone")
    .eq("user_id", ownerProfileId)
    .maybeSingle();
  if (preference.error) throw new Error("PROTECTED_TIME_TIMEZONE_LOOKUP_FAILED");
  const viewerTimeZone = typeof preference.data?.time_zone === "string"
    ? preference.data.time_zone
    : "America/Havana";

  return {
    blocks: data,
    snapshot: buildProtectedTimeSnapshot(data as never),
    viewerTimeZone,
  };
}

function assessCurrentProtectedTime(
  eventRecord: Record<string, unknown>,
  state: ProtectedTimeState,
) {
  return assessEventProtectedTimeConflicts({
    event: eventRecord as never,
    protectedBlocks: state.blocks as never,
    viewerTimeZone: state.viewerTimeZone,
  }) as Array<Record<string, unknown>>;
}

/**
 * Authenticated, owner-scoped Event Create endpoint.
 *
 * The verified JWT resolves the profile. Idempotency is checked before any
 * timezone resolution so a retry can replay its original receipt even if the
 * current TZDB/resolver is unavailable or has changed. First writes cross the
 * SECURITY INVOKER RPC, which commits the claim, Event and audit append atomically.
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
    return json({ error: "BODY_MUST_BE_AN_OBJECT" }, 422);
  }
  const input = body as Record<string, unknown>;
  const allowedKeys = ["event", "conflictDecisions"];
  if (!("event" in input) || Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    return json({ error: "BODY_HAS_UNSUPPORTED_FIELDS" }, 422);
  }

  try {
    const eventDraft = createEventDraft(input.event);
    const conflictDecisions = normalizeProtectedTimeConflictDecisions(input.conflictDecisions ?? []);
    const intent = await hashEventCreateIntent(eventDraft, globalThis.crypto, conflictDecisions);

    // Fast replay path: no IANA resolution, new Event ID or mutable resolver
    // metadata is needed once the original committed receipt exists.
    const existing = await ctx.supabaseAdmin
      .from("event_create_request")
      .select("payload_version,payload_hash,result_event_id,response_created_at,response_event_status")
      .eq("owner_user_id", profile.profileId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing.error) return json({ error: "IDEMPOTENCY_LOOKUP_FAILED" }, 503);
    if (existing.data) {
      const hashHex = intent.payloadHash;
      const storedHash = existing.data.payload_hash instanceof Uint8Array
        ? Array.from(existing.data.payload_hash as Uint8Array).map((byte) => byte.toString(16).padStart(2, "0")).join("")
        : typeof existing.data.payload_hash === "string"
        ? existing.data.payload_hash.replace(/^\\x/, "")
        : "";
      if (existing.data.payload_version !== intent.version || storedHash !== hashHex) {
        return json({ error: "IDEMPOTENCY_KEY_REUSED" }, 409);
      }
      return receiptResponse(existing.data, true);
    }

    let readyDraft = eventDraft;
    if (eventDraft.temporal.kind === "zoned_civil") {
      const resolution = resolveLocalDateTimeRange(buildEventTimeResolutionRequest(eventDraft));
      readyDraft = applyAuthoritativeEventResolution(eventDraft, resolution);
    }

    const now = (dependencies.now ?? (() => new Date().toISOString()))();
    const eventRecord = buildEventInsertRecord({
      eventDraft: readyDraft,
      eventId: (dependencies.newEventId ?? uuidv7)(),
      ownerProfileId: profile.profileId,
      now,
    });
    let protectedTimeState: ProtectedTimeState;
    let conflicts: Array<Record<string, unknown>>;
    try {
      protectedTimeState = await readProtectedTimeState(ctx, profile.profileId);
      conflicts = assessCurrentProtectedTime(eventRecord as unknown as Record<string, unknown>, protectedTimeState);
    } catch (error) {
      const code = error instanceof Error ? error.message : "PROTECTED_TIME_LOOKUP_FAILED";
      return json({ error: code }, code === "PROTECTED_TIME_BLOCK_LIMIT_EXCEEDED" ? 503 : 503);
    }

    if (conflicts.length > 0 && conflictDecisions.length === 0) {
      return json({ error: "PROTECTED_TIME_CONFLICTS", conflicts }, 409);
    }
    if (!decisionsMatchConflicts(
      conflictDecisions as unknown as Array<Record<string, unknown>>,
      conflicts,
    )) {
      return json({
        error: "PROTECTED_TIME_CONFLICTS_CHANGED",
        conflicts,
      }, 409);
    }

    const result = await ctx.supabaseAdmin.rpc("create_calendar_event_with_protected_time_once", {
      p_owner_user_id: profile.profileId,
      p_idempotency_key: idempotencyKey,
      p_payload_version: intent.version,
      p_payload_hash_hex: intent.payloadHash,
      p_event_record: eventRecord,
      p_protected_time_snapshot: protectedTimeState.snapshot,
      p_conflict_decisions: conflictDecisions,
    });
    if (result.error) return json({ error: "EVENT_CREATE_FAILED" }, 503);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row || typeof row !== "object") return json({ error: "EVENT_CREATE_RESULT_INVALID" }, 503);
    const outcome = row as Record<string, unknown>;
    if (outcome.http_status === 409) {
      const responseBody = (outcome.response_body ?? { error: "IDEMPOTENCY_KEY_REUSED" }) as Record<string, unknown>;
      if (responseBody.error === "PROTECTED_TIME_STATE_CHANGED") {
        try {
          const refreshed = await readProtectedTimeState(ctx, profile.profileId);
          const refreshedConflicts = assessCurrentProtectedTime(eventRecord as unknown as Record<string, unknown>, refreshed);
          return json({
            error: refreshedConflicts.length > 0 ? "PROTECTED_TIME_CONFLICTS_CHANGED" : "PROTECTED_TIME_STATE_CHANGED",
            conflicts: refreshedConflicts,
          }, 409);
        } catch {
          return json({ error: "PROTECTED_TIME_STATE_CHANGED", conflicts: [] }, 409);
        }
      }
      return json(responseBody, 409);
    }
    if (outcome.http_status !== 201 || !outcome.response_body || typeof outcome.response_body !== "object") {
      return json({ error: "EVENT_CREATE_RESULT_INVALID" }, 503);
    }
    return json({ ...(outcome.response_body as Record<string, unknown>), replayed: outcome.replayed === true }, 201);
  } catch (error) {
    if (error instanceof TzdbVersionError) return json({ error: "TIMEZONE_RULES_UNAVAILABLE" }, 503);
    if (error instanceof Error && error.message.startsWith("PROTECTED_TIME_")) {
      return json({ error: error.message }, 503);
    }
    if (error instanceof TypeError || error instanceof RangeError) {
      return json({ error: error.message }, 422);
    }
    return json({ error: "EVENT_CREATE_FAILED" }, 500);
  }
}
