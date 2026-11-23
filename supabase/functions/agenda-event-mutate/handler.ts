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
import { assessOwnerProtectedTimeConflicts } from "../_shared/protected-time-conflicts.ts";
import { assessOwnerEventTaskScheduleConflicts } from "../_shared/event-task-schedule-conflicts.ts";

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
  "protected_time_decisions",
  "task_schedule_decisions",
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
  patch.protected_time_snapshot = record.protected_time_snapshot;
  patch.task_schedule_snapshot = record.task_schedule_snapshot;
  return patch;
}

function sameEventWindow(current: Record<string, unknown>, candidate: Record<string, unknown>): boolean {
  if (current.temporal_kind !== candidate.temporal_kind) return false;
  if (current.temporal_kind === "all_day") {
    return current.start_date === candidate.start_date
      && current.end_date_exclusive === candidate.end_date_exclusive;
  }
  return typeof current.starts_at === "string"
    && typeof current.ends_at === "string"
    && Date.parse(current.starts_at) === Date.parse(String(candidate.starts_at))
    && Date.parse(current.ends_at) === Date.parse(String(candidate.ends_at));
}

function storedDecisionInputs(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const decision = item as Record<string, unknown>;
    return {
      blockId: decision.blockId,
      blockUpdatedAt: decision.blockUpdatedAt,
      occurrenceStartsAt: decision.occurrenceStartsAt,
      decision: decision.decision,
    };
  });
}

function storedDecisionMap(value: unknown): Map<string, Record<string, unknown>> {
  if (!Array.isArray(value)) return new Map();
  const entries: Array<[string, Record<string, unknown>]> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const decision = item as Record<string, unknown>;
    if (typeof decision.blockId !== "string"
      || typeof decision.occurrenceStartsAt !== "string"
      || !Number.isFinite(Date.parse(decision.occurrenceStartsAt))) continue;
    const key = decision.blockId + ":" + new Date(decision.occurrenceStartsAt).toISOString();
    entries.push([key, decision]);
  }
  return new Map(entries);
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
  const requiredKeys = input.action === "edit"
    ? ["action", "event", "eventId", "expectedUpdatedAt"]
    : ["action", "eventId", "expectedUpdatedAt"];
  const allowedKeys = input.action === "edit"
    ? [...requiredKeys, "protectedTimeDecisions", "taskScheduleDecisions"]
    : requiredKeys;
  if (requiredKeys.some((key) => !(key in input))
    || Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    return json({ error: "EVENT_MUTATION_BODY_HAS_UNSUPPORTED_FIELDS" }, 422);
  }

  const requestedProtectedTimeDecisions = input.protectedTimeDecisions ?? [];
  if (!Array.isArray(requestedProtectedTimeDecisions)) {
    return json({ error: "PROTECTED_TIME_DECISIONS_MUST_BE_AN_ARRAY" }, 422);
  }
  const requestedTaskScheduleDecisions = input.taskScheduleDecisions ?? [];
  if (!Array.isArray(requestedTaskScheduleDecisions)) {
    return json({ error: "TASK_SCHEDULE_DECISIONS_MUST_BE_AN_ARRAY" }, 422);
  }

  try {
    const mutation = normalizeEventMutation({
      eventId: input.eventId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      action: String(input.action),
      eventDraft: input.action === "edit"
        ? createEventDraft(input.event)
        : null,
      protectedTimeDecisions: requestedProtectedTimeDecisions as Record<string, unknown>[],
      taskScheduleDecisions: requestedTaskScheduleDecisions as Record<string, unknown>[],
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
      const currentResult = await ctx.supabaseAdmin
        .from("calendar_event")
        .select("temporal_kind,start_date,end_date_exclusive,starts_at,ends_at,protected_time_decisions,task_schedule_decisions")
        .eq("owner_user_id", profile.profileId)
        .eq("id", mutation.eventId)
        .maybeSingle();
      if (currentResult.error) return json({ error: "EVENT_CONFLICT_CONTEXT_LOOKUP_FAILED" }, 503);
      if (!currentResult.data) return json({ error: "EVENT_NOT_FOUND" }, 404);

      const candidateRecord = buildEventInsertRecord({
        eventDraft: readyDraft,
        eventId: mutation.eventId,
        ownerProfileId: profile.profileId,
        now,
      });
      const sameWindow = sameEventWindow(currentResult.data, candidateRecord);
      const retainExistingConsent = input.protectedTimeDecisions === undefined && sameWindow;
      const previousDecisionRecords = Array.isArray(currentResult.data.protected_time_decisions)
        ? currentResult.data.protected_time_decisions as Record<string, unknown>[]
        : [];
      const previousDecisionMap = storedDecisionMap(previousDecisionRecords);
      const priorDecisions = storedDecisionInputs(previousDecisionRecords);
      let decisionInputs = input.protectedTimeDecisions !== undefined
        ? input.protectedTimeDecisions
        : retainExistingConsent ? priorDecisions : [];
      let conflictAssessment = await assessOwnerProtectedTimeConflicts({
        supabaseAdmin: ctx.supabaseAdmin,
        ownerProfileId: profile.profileId,
        event: candidateRecord,
        suppliedDecisions: decisionInputs,
        now,
      });

      // When only Event details change, preserve the original consent timestamp
      // for occurrences that are still identical and backed by the same block
      // version. Drop approvals for removed occurrences. A new/changed overlap
      // remains incomplete and is returned to the user for a fresh decision.
      if (!conflictAssessment.ok && retainExistingConsent) {
        const reusable = conflictAssessment.conflicts.flatMap((conflict) => {
          const previous = previousDecisionMap.get(
            typeof conflict.conflictKey === "string" ? conflict.conflictKey : "",
          );
          if (!previous || previous.blockUpdatedAt !== conflict.blockUpdatedAt
            || previous.decision !== conflict.requiredDecision) return [];
          return [{
            blockId: conflict.blockId,
            blockUpdatedAt: conflict.blockUpdatedAt,
            occurrenceStartsAt: conflict.occurrenceStartsAt,
            decision: conflict.requiredDecision,
          }];
        });
        decisionInputs = reusable;
        conflictAssessment = await assessOwnerProtectedTimeConflicts({
          supabaseAdmin: ctx.supabaseAdmin,
          ownerProfileId: profile.profileId,
          event: candidateRecord,
          suppliedDecisions: decisionInputs,
          now,
        });
      }

      if (!conflictAssessment.ok) {
        return json({
          error: conflictAssessment.code,
          conflicts: conflictAssessment.conflicts,
        }, 409);
      }
      const decisionsToPersist = retainExistingConsent
        ? conflictAssessment.assessment.conflicts.flatMap((conflict) => {
          const previous = previousDecisionMap.get(
            typeof conflict.conflictKey === "string" ? conflict.conflictKey : "",
          );
          return previous ? [previous] : [];
        })
        : conflictAssessment.assessment.decisions;
      const taskScheduleDecisionRecords = Array.isArray(currentResult.data.task_schedule_decisions)
        ? currentResult.data.task_schedule_decisions as Record<string, unknown>[]
        : [];
      const taskScheduleDecisionMap = new Map(taskScheduleDecisionRecords
        .filter((item) => typeof item.taskScheduleId === "string")
        .map((item) => [String(item.taskScheduleId), item]));
      const priorTaskScheduleInputs = taskScheduleDecisionRecords.map((item) => ({
        taskScheduleId: item.taskScheduleId,
        taskScheduleUpdatedAt: item.taskScheduleUpdatedAt,
        decision: item.decision,
      }));
      const retainTaskScheduleConsent = input.taskScheduleDecisions === undefined && sameWindow;
      let taskScheduleDecisionInputs = input.taskScheduleDecisions !== undefined
        ? requestedTaskScheduleDecisions
        : retainTaskScheduleConsent ? priorTaskScheduleInputs : [];
      let taskScheduleAssessment = await assessOwnerEventTaskScheduleConflicts({
        supabaseAdmin: ctx.supabaseAdmin,
        ownerProfileId: profile.profileId,
        event: candidateRecord,
        suppliedDecisions: taskScheduleDecisionInputs,
        now,
      });
      if (!taskScheduleAssessment.ok && retainTaskScheduleConsent) {
        const reusable = taskScheduleAssessment.conflicts.flatMap((conflict) => {
          const previous = taskScheduleDecisionMap.get(String(conflict.taskScheduleId));
          if (!previous || previous.taskScheduleUpdatedAt !== conflict.taskScheduleUpdatedAt
            || previous.decision !== conflict.requiredDecision) return [];
          return [{
            taskScheduleId: conflict.taskScheduleId,
            taskScheduleUpdatedAt: conflict.taskScheduleUpdatedAt,
            decision: conflict.requiredDecision,
          }];
        });
        taskScheduleDecisionInputs = reusable;
        taskScheduleAssessment = await assessOwnerEventTaskScheduleConflicts({
          supabaseAdmin: ctx.supabaseAdmin,
          ownerProfileId: profile.profileId,
          event: candidateRecord,
          suppliedDecisions: taskScheduleDecisionInputs,
          now,
        });
      }
      if (!taskScheduleAssessment.ok) {
        return json({
          error: taskScheduleAssessment.code,
          conflicts: taskScheduleAssessment.conflicts,
        }, 409);
      }
      const taskScheduleDecisionsToPersist = retainTaskScheduleConsent
        ? taskScheduleAssessment.assessment.conflicts.flatMap((conflict) => {
          const previous = taskScheduleDecisionMap.get(String(conflict.taskScheduleId));
          return previous ? [previous] : [];
        })
        : taskScheduleAssessment.assessment.decisions;
      const record = buildEventInsertRecord({
        eventDraft: readyDraft,
        eventId: mutation.eventId,
        ownerProfileId: profile.profileId,
        now,
        protectedTimeDecisions: [...decisionsToPersist],
        protectedTimeSnapshot: [...conflictAssessment.assessment.snapshot],
        taskScheduleDecisions: [...taskScheduleDecisionsToPersist],
        taskScheduleSnapshot: [...taskScheduleAssessment.assessment.snapshot],
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
    if (error instanceof Error && (error.message === "AGENDA_TIME_ZONE_LOOKUP_FAILED"
      || error.message === "PROTECTED_TIME_CONFLICT_LOOKUP_FAILED"
      || error.message === "TASK_SCHEDULE_CONFLICT_LOOKUP_FAILED")) {
      return json({ error: error.message }, 503);
    }
    return json({ error: "EVENT_MUTATION_FAILED" }, 500);
  }
}
