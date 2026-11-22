import {
  buildTaskSchedulePatch,
  buildTaskScheduleResolutionRequest,
  hashTaskScheduleMutationIntent,
  normalizeTaskScheduleIdempotencyKey,
  normalizeTaskScheduleMutation,
} from "../../../src/features/agenda/domain/task-schedule.js";
import { uuidv7 } from "../../../src/lib/uuidv7.js";
import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
} from "../_shared/agenda-event-profile.ts";
import { resolveLocalDateTimeRange, TzdbVersionError } from "../agenda-time-resolve/resolver.ts";
import { assessOwnerTaskScheduleConflicts } from "../_shared/task-schedule-conflicts.ts";

export const MAX_REQUEST_BYTES = 32 * 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type RpcClient = {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
type Context = EventAuthenticatedContext & { supabaseAdmin: RpcClient };
type Dependencies = {
  now?: () => string;
  newTaskScheduleId?: () => string;
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

function storedHash(value: unknown): string {
  if (value instanceof Uint8Array) {
    return Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return typeof value === "string" ? value.replace(/^\\x/, "") : "";
}

function replayResponse(row: Record<string, unknown>): Response {
  if (typeof row.response_http_status !== "number"
    || !row.response_body || typeof row.response_body !== "object"
    || Array.isArray(row.response_body)) {
    return json({ error: "TASK_SCHEDULE_RECEIPT_INCOMPLETE" }, 503);
  }
  return json({ ...(row.response_body as Record<string, unknown>), replayed: true },
    row.response_http_status);
}

/**
 * Authenticated TaskSchedule writer. Owner/actor come exclusively from the
 * verified JWT -> active profile lookup. The browser receives SELECT only;
 * every write crosses the server-only idempotent SECURITY INVOKER RPC.
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
    idempotencyKey = normalizeTaskScheduleIdempotencyKey(request.headers.get("idempotency-key"));
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

  try {
    const mutation = normalizeTaskScheduleMutation(body);
    const intent = await hashTaskScheduleMutationIntent(mutation);

    // Completed retries are replayed before reading mutable Tasks, Events,
    // Protected Time or current timezone data.
    const existing = await ctx.supabaseAdmin
      .from("task_schedule_mutation_request")
      .select("task_schedule_id,payload_version,payload_hash,response_http_status,response_body")
      .eq("owner_user_id", profile.profileId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing.error) return json({ error: "TASK_SCHEDULE_IDEMPOTENCY_LOOKUP_FAILED" }, 503);
    if (existing.data) {
      if (existing.data.payload_version !== intent.version
        || storedHash(existing.data.payload_hash) !== intent.payloadHash
        || (mutation.action !== "create" && existing.data.task_schedule_id !== mutation.taskScheduleId)) {
        return json({ error: "IDEMPOTENCY_KEY_REUSED" }, 409);
      }
      return replayResponse(existing.data as Record<string, unknown>);
    }

    const now = (dependencies.now ?? (() => new Date().toISOString()))();
    const taskScheduleId = mutation.action === "create"
      ? (dependencies.newTaskScheduleId ?? uuidv7)()
      : mutation.taskScheduleId;

    let schedulePatch: Record<string, unknown> = {};
    if (mutation.action === "create" || mutation.action === "edit") {
      let taskId = mutation.taskId;
      let scheduleStatus = "proposed";
      if (mutation.action === "edit") {
        const current = await ctx.supabaseAdmin
          .from("task_schedule")
          .select("task_id,schedule_status")
          .eq("owner_user_id", profile.profileId)
          .eq("id", mutation.taskScheduleId)
          .maybeSingle();
        if (current.error) return json({ error: "TASK_SCHEDULE_LOOKUP_FAILED" }, 503);
        if (!current.data) return json({ error: "TASK_SCHEDULE_NOT_FOUND" }, 404);
        taskId = String(current.data.task_id);
        scheduleStatus = String(current.data.schedule_status);
        if (scheduleStatus !== "proposed" && scheduleStatus !== "confirmed") {
          return json({ error: "TASK_SCHEDULE_NOT_EDITABLE" }, 409);
        }
      }

      const resolution = resolveLocalDateTimeRange(buildTaskScheduleResolutionRequest(mutation));
      const assessment = await assessOwnerTaskScheduleConflicts({
        supabaseAdmin: ctx.supabaseAdmin,
        ownerProfileId: profile.profileId,
        startsAt: resolution.startsAt,
        endsAt: resolution.endsAt,
        taskScheduleId: mutation.action === "edit" ? mutation.taskScheduleId : null,
        suppliedEventDecisions: mutation.eventDecisions,
        suppliedProtectedTimeDecisions: mutation.protectedTimeDecisions,
        now,
      });
      if (!assessment.ok) {
        return json({
          error: assessment.code,
          eventConflicts: assessment.eventConflicts,
          protectedTimeConflicts: assessment.protectedTimeConflicts,
          taskScheduleConflicts: assessment.taskScheduleConflicts,
        }, 409);
      }

      schedulePatch = buildTaskSchedulePatch({
        mutation: { ...mutation, taskId },
        resolution,
        scheduleStatus,
        conflictDecisions: [...assessment.assessment.decisions],
        conflictSnapshot: [...assessment.assessment.snapshot],
      }) as unknown as Record<string, unknown>;
    }

    const result = await ctx.supabaseAdmin.rpc("mutate_task_schedule_once", {
      p_owner_user_id: profile.profileId,
      p_task_schedule_id: taskScheduleId,
      p_idempotency_key: idempotencyKey,
      p_payload_version: intent.version,
      p_payload_hash_hex: intent.payloadHash,
      p_expected_updated_at: mutation.expectedUpdatedAt,
      p_mutation: mutation.action,
      p_schedule_patch: schedulePatch,
      p_now: now,
    });
    if (result.error) return json({ error: "TASK_SCHEDULE_MUTATION_FAILED" }, 503);

    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row || typeof row !== "object") return json({ error: "TASK_SCHEDULE_MUTATION_RESULT_INVALID" }, 503);
    const outcome = row as Record<string, unknown>;
    if (typeof outcome.http_status !== "number"
      || !outcome.response_body || typeof outcome.response_body !== "object"
      || Array.isArray(outcome.response_body)) {
      return json({ error: "TASK_SCHEDULE_MUTATION_RESULT_INVALID" }, 503);
    }
    return json({
      ...(outcome.response_body as Record<string, unknown>),
      replayed: outcome.replayed === true,
    }, outcome.http_status);
  } catch (error) {
    if (error instanceof TzdbVersionError) return json({ error: "TIMEZONE_RULES_UNAVAILABLE" }, 503);
    if (error instanceof TypeError || error instanceof RangeError) {
      return json({ error: error.message }, 422);
    }
    if (error instanceof Error && (
      error.message === "TASK_SCHEDULE_TIME_ZONE_LOOKUP_FAILED"
      || error.message === "TASK_SCHEDULE_EVENT_LOOKUP_FAILED"
      || error.message === "TASK_SCHEDULE_PROTECTED_TIME_LOOKUP_FAILED"
      || error.message === "TASK_SCHEDULE_EXISTING_LOOKUP_FAILED"
    )) {
      return json({ error: error.message }, 503);
    }
    return json({ error: "TASK_SCHEDULE_MUTATION_FAILED" }, 500);
  }
}
