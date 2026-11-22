import { uuidv7 } from "../../../src/lib/uuidv7.js";
import {
  buildTaskSchedulePatch,
  buildTaskScheduleResolutionRequest,
  hashTaskScheduleMutationIntent,
  normalizeTaskScheduleExpectedVersion,
  normalizeTaskScheduleId,
  normalizeTaskScheduleMutation,
  normalizeTaskScheduleDraft,
} from "../../../src/features/agenda/domain/task-schedule.js";
import { normalizeEventIdempotencyKey } from "../../../src/features/agenda/domain/event-idempotency.js";
import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
} from "../_shared/agenda-event-profile.ts";
import { resolveLocalDateTimeRange, TzdbVersionError } from "../agenda-time-resolve/resolver.ts";
import { assessOwnerProtectedTimeConflicts } from "../_shared/protected-time-conflicts.ts";

export const MAX_REQUEST_BYTES = 32 * 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
type AdminClient = {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
type Context = EventAuthenticatedContext & { supabaseAdmin: AdminClient };
type Dependencies = { now?: () => string; newTaskScheduleId?: () => string };
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
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function hashHex(value: unknown): string {
  if (value instanceof Uint8Array) return Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (typeof value === "string") return value.replace(/^\\x/, "");
  return "";
}
function priorDecisionInputs(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      blockId: row.blockId,
      blockUpdatedAt: row.blockUpdatedAt,
      occurrenceStartsAt: row.occurrenceStartsAt,
      decision: row.decision,
    };
  });
}
function priorDecisionMap(value: unknown): Map<string, Record<string, unknown>> {
  if (!Array.isArray(value)) return new Map();
  const items: Array<[string, Record<string, unknown>]> = [];
  for (const valueItem of value) {
    if (!valueItem || typeof valueItem !== "object" || Array.isArray(valueItem)) continue;
    const row = valueItem as Record<string, unknown>;
    if (typeof row.blockId !== "string" || typeof row.occurrenceStartsAt !== "string"
      || !Number.isFinite(Date.parse(row.occurrenceStartsAt))) continue;
    items.push([row.blockId + ":" + new Date(Date.parse(row.occurrenceStartsAt)).toISOString(), row]);
  }
  return new Map(items);
}
function sameWindow(current: Record<string, unknown>, patch: Record<string, unknown>) {
  return Date.parse(String(current.starts_at)) === Date.parse(String(patch.starts_at))
    && Date.parse(String(current.ends_at)) === Date.parse(String(patch.ends_at))
    && current.task_id === patch.task_id;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
export async function handleRequest(request: Request, ctx: Context, dependencies: Dependencies = {}): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return json({ error: "CONTENT_TYPE_MUST_BE_JSON" }, 415);
  const profile = await resolveActiveEventProfile(ctx);
  if (!profile.ok) return json({ error: profile.code }, profile.status);
  let key: string;
  try { key = normalizeEventIdempotencyKey(request.headers.get("idempotency-key")); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "INVALID_IDEMPOTENCY_KEY" }, 422); }

  let raw: string | null;
  try { raw = await readBoundedBody(request); }
  catch { return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400); }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  if (!isRecord(input)) return json({ error: "TASK_SCHEDULE_BODY_MUST_BE_AN_OBJECT" }, 422);

  const action = input.action;
  const required = action === "create" ? ["action", "schedule"]
    : action === "edit" ? ["action", "taskScheduleId", "expectedUpdatedAt", "schedule"]
    : action === "confirm" ? ["action", "taskScheduleId", "expectedUpdatedAt"]
    : ["action", "taskScheduleId", "expectedUpdatedAt"];
  const optional = action === "edit" || action === "confirm" ? ["conflictDecisions"] : [];
  const allowed = new Set([...required, ...optional]);
  if (required.some((name) => !(name in input)) || Object.keys(input).some((name) => !allowed.has(name))) {
    return json({ error: "TASK_SCHEDULE_BODY_HAS_UNSUPPORTED_OR_MISSING_FIELDS" }, 422);
  }

  try {
    const now = (dependencies.now ?? (() => new Date().toISOString()))();
    const normalizedDraft = action === "create" || action === "edit"
      ? normalizeTaskScheduleDraft(input.schedule) : null;
    const taskScheduleId = action === "create"
      ? (dependencies.newTaskScheduleId ?? uuidv7)()
      : normalizeTaskScheduleId(input.taskScheduleId);
    const mutation = normalizeTaskScheduleMutation({
      action: String(action),
      taskScheduleId: action === "create" ? null : taskScheduleId,
      expectedUpdatedAt: action === "create" ? null : normalizeTaskScheduleExpectedVersion(input.expectedUpdatedAt),
      scheduleDraft: normalizedDraft,
      conflictDecisions: input.conflictDecisions ?? [],
    });
    const intent = await hashTaskScheduleMutationIntent(mutation);

    const existing = await ctx.supabaseAdmin.from("task_schedule_mutation_request")
      .select("task_schedule_id,payload_version,payload_hash,response_http_status,response_body")
      .eq("owner_user_id", profile.profileId).eq("idempotency_key", key).maybeSingle();
    if (existing.error) return json({ error: "TASK_SCHEDULE_IDEMPOTENCY_LOOKUP_FAILED" }, 503);
    if (existing.data) {
      if (existing.data.payload_version !== intent.version || hashHex(existing.data.payload_hash) !== intent.payloadHash) {
        return json({ error: "IDEMPOTENCY_KEY_REUSED" }, 409);
      }
      if (typeof existing.data.response_http_status !== "number" || !isRecord(existing.data.response_body)) {
        return json({ error: "TASK_SCHEDULE_RECEIPT_INCOMPLETE" }, 503);
      }
      return json({ ...existing.data.response_body, replayed: true }, existing.data.response_http_status);
    }

    let current: Record<string, unknown> | null = null;
    if (action !== "create") {
      const result = await ctx.supabaseAdmin.from("task_schedule")
        .select("id,owner_user_id,task_id,updated_at,time_zone,start_local,end_local,starts_at,ends_at,start_disambiguation,end_disambiguation,resolver_metadata,schedule_status,conflict_decisions")
        .eq("owner_user_id", profile.profileId).eq("id", taskScheduleId).maybeSingle();
      if (result.error) return json({ error: "TASK_SCHEDULE_LOOKUP_FAILED" }, 503);
      if (!result.data) return json({ error: "TASK_SCHEDULE_NOT_FOUND" }, 404);
      current = result.data as Record<string, unknown>;
    }

    let schedulePatch: Record<string, unknown> = {};
    let conflictDecisions: readonly Record<string, unknown>[] = [];
    let protectedSnapshot: readonly { id: string; updated_at: string }[] = [];
    let eventSnapshot: readonly { id: string; updated_at: string }[] = [];
    let scheduleSnapshot: readonly { id: string; updated_at: string }[] = [];

    if (action === "create" || action === "edit") {
      const resolution = resolveLocalDateTimeRange(buildTaskScheduleResolutionRequest(normalizedDraft!));
      schedulePatch = buildTaskSchedulePatch(normalizedDraft!, resolution) as unknown as Record<string, unknown>;
    }

    const needsConflictCheck = action === "confirm"
      || (action === "edit" && current?.schedule_status === "confirmed");
    if (needsConflictCheck) {
      const candidate = action === "edit"
        ? schedulePatch
        : current!;
      const candidateId = taskScheduleId;
      const previous = current?.conflict_decisions;
      const preservePrior = action === "edit" && current?.schedule_status === "confirmed"
        && sameWindow(current, schedulePatch);
      const priorInputs = priorDecisionInputs(previous);
      let supplied = input.conflictDecisions !== undefined
        ? mutation.conflictDecisions : preservePrior ? priorInputs : [];
      let assessment = await assessOwnerProtectedTimeConflicts({
        supabaseAdmin: ctx.supabaseAdmin,
        ownerProfileId: profile.profileId,
        event: {
          id: candidateId,
          temporal_kind: "fixed_instant",
          starts_at: action === "edit" ? schedulePatch.starts_at : candidate.starts_at,
          ends_at: action === "edit" ? schedulePatch.ends_at : candidate.ends_at,
        },
        suppliedDecisions: supplied,
        now,
        excludeTaskScheduleId: candidateId,
      });
      const previousMap = priorDecisionMap(previous);
      if (!assessment.ok && preservePrior) {
        const reusable = assessment.conflicts.flatMap((conflict) => {
          const row = previousMap.get(String(conflict.conflictKey));
          if (!row || row.blockUpdatedAt !== conflict.blockUpdatedAt || row.decision !== conflict.requiredDecision) return [];
          return [{
            blockId: conflict.blockId,
            blockUpdatedAt: conflict.blockUpdatedAt,
            occurrenceStartsAt: conflict.occurrenceStartsAt,
            decision: conflict.requiredDecision,
          }];
        });
        supplied = reusable;
        assessment = await assessOwnerProtectedTimeConflicts({
          supabaseAdmin: ctx.supabaseAdmin,
          ownerProfileId: profile.profileId,
          event: {
            id: candidateId, temporal_kind: "fixed_instant",
            starts_at: action === "edit" ? schedulePatch.starts_at : candidate.starts_at,
            ends_at: action === "edit" ? schedulePatch.ends_at : candidate.ends_at,
          },
          suppliedDecisions: supplied,
          now,
          excludeTaskScheduleId: candidateId,
        });
      }
      if (!assessment.ok) {
        return json({ error: assessment.code, conflicts: assessment.conflicts }, 409);
      }
      if (preservePrior) {
        conflictDecisions = assessment.assessment.conflicts.flatMap((conflict) => {
          const row = previousMap.get(String(conflict.conflictKey));
          return row ? [row] : [];
        });
      } else {
        conflictDecisions = assessment.assessment.decisions;
      }
      protectedSnapshot = assessment.assessment.snapshot.protectedTime;
      eventSnapshot = assessment.assessment.snapshot.calendarEvents;
      scheduleSnapshot = assessment.assessment.snapshot.taskSchedules;
    }

    const result = await ctx.supabaseAdmin.rpc("mutate_task_schedule_once", {
      p_owner_user_id: profile.profileId,
      p_task_schedule_id: taskScheduleId,
      p_idempotency_key: key,
      p_payload_version: intent.version,
      p_payload_hash_hex: intent.payloadHash,
      p_expected_updated_at: mutation.expectedUpdatedAt,
      p_mutation: mutation.action,
      p_schedule_patch: schedulePatch,
      p_conflict_decisions: conflictDecisions,
      p_protected_time_snapshot: protectedSnapshot,
      p_calendar_event_snapshot: eventSnapshot,
      p_task_schedule_snapshot: scheduleSnapshot,
      p_now: now,
    });
    if (result.error) return json({ error: "TASK_SCHEDULE_MUTATION_FAILED" }, 503);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!isRecord(row) || typeof row.http_status !== "number" || !isRecord(row.response_body)) {
      return json({ error: "TASK_SCHEDULE_MUTATION_RESULT_INVALID" }, 503);
    }
    return json({ ...row.response_body, replayed: row.replayed === true }, row.http_status);
  } catch (error) {
    if (error instanceof TzdbVersionError) return json({ error: "TIMEZONE_RULES_UNAVAILABLE" }, 503);
    if (error instanceof TypeError || error instanceof RangeError) {
      return json({ error: error.message }, 422);
    }
    if (error instanceof Error && [
      "AGENDA_TIME_ZONE_LOOKUP_FAILED", "PROTECTED_TIME_CONFLICT_LOOKUP_FAILED",
      "AGENDA_EVENT_CONFLICT_LOOKUP_FAILED", "TASK_SCHEDULE_CONFLICT_LOOKUP_FAILED",
    ].includes(error.message)) return json({ error: error.message }, 503);
    return json({ error: "TASK_SCHEDULE_MUTATION_FAILED" }, 500);
  }
}
