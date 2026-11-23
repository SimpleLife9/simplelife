import { normalizeEventIdempotencyKey } from "../../../src/features/agenda/domain/event-idempotency.js";
import { addRecurrenceCalendarDays } from "../../../src/features/agenda/domain/recurrence.js";
import { uuidv7 } from "../../../src/lib/uuidv7.js";
import { findProtectedTimeConflicts } from "../../../src/features/agenda/domain/protected-time-conflicts.js";
import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
} from "../_shared/agenda-event-profile.ts";
import {
  resolveLocalDateTimeRange,
  TzdbVersionError,
} from "../agenda-time-resolve/resolver.ts";

export const MAX_REQUEST_BYTES = 16 * 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = "recurring-occurrence-mutate-v1";

type AdminClient = {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
type Context = EventAuthenticatedContext & { supabaseAdmin: AdminClient };
type Occurrence = Record<string, any>;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function dateKey(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(label + " must be YYYY-MM-DD.");
  return addRecurrenceCalendarDays(value, 0);
}
function clock(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(label + " must be HH:mm[:ss[.SSS]].");
  const match = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:[.]([0-9]{1,3}))?)?$/.exec(value);
  if (!match) throw new RangeError(label + " must be HH:mm[:ss[.SSS]].");
  if (Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? 0) > 59) {
    throw new RangeError(label + " is outside the clock range.");
  }
  return match[1] + ":" + match[2] + ":" + String(Number(match[3] ?? 0)).padStart(2, "0")
    + "." + ((match[4] ?? "").padEnd(3, "0") || "000");
}
function localDateTime(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(label + " must be a local date-time.");
  const normalized = value.replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(normalized)) {
    throw new RangeError(label + " must use YYYY-MM-DDTHH:mm[:ss[.SSS]] without an offset.");
  }
  return dateKey(normalized.slice(0, 10), label) + "T" + clock(normalized.slice(11), label);
}
function daysBetween(start: string, end: string): number {
  const startDate = new Date(start + "T00:00:00.000Z");
  const endDate = new Date(end + "T00:00:00.000Z");
  return Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
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
async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function storedHash(value: unknown): string {
  if (value instanceof Uint8Array) {
    return Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return typeof value === "string" ? value.replace(/^\\x/, "") : "";
}
function replayReceipt(row: Record<string, unknown>): Response {
  if (typeof row.response_http_status !== "number"
    || !row.response_body || typeof row.response_body !== "object") {
    return json({ error: "OCCURRENCE_MUTATION_RECEIPT_INCOMPLETE" }, 503);
  }
  return json({
    ...(row.response_body as Record<string, unknown>),
    replayed: true,
  }, row.response_http_status);
}
function authoritativePatch(resolution: ReturnType<typeof resolveLocalDateTimeRange>) {
  return {
    starts_at: resolution.startsAt,
    ends_at: resolution.endsAt,
    time_zone: resolution.timeZone,
    start_local: resolution.start.resolvedLocalDateTime,
    end_local: resolution.end.resolvedLocalDateTime,
    start_disambiguation: resolution.start.resolution === "ambiguous-later" ? "later" : "earlier",
    end_disambiguation: resolution.end.resolution === "ambiguous-later" ? "later" : "earlier",
    start_gap_strategy: "next-valid",
    end_gap_strategy: "next-valid",
    resolver_metadata: {
      rulesSource: resolution.rulesSource,
      rulesVersion: resolution.rulesVersion,
      resolverVersion: resolution.resolverVersion,
      authoritative: true,
      start: resolution.start,
      end: resolution.end,
    },
  };
}

export async function handleRequest(
  request: Request,
  ctx: Context,
  dependencies: { now?: () => string; newOccurrenceId?: () => string } = {},
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "CONTENT_TYPE_MUST_BE_JSON" }, 415);
  }
  const profile = await resolveActiveEventProfile(ctx);
  if (!profile.ok) return json({ error: profile.code }, profile.status);

  let key: string;
  try { key = normalizeEventIdempotencyKey(request.headers.get("idempotency-key")); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "INVALID_IDEMPOTENCY_KEY" }, 422); }

  let raw: string | null;
  try { raw = await readBoundedBody(request); }
  catch { return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400); }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); }
  catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "OCCURRENCE_MUTATION_BODY_MUST_BE_AN_OBJECT" }, 422);
  }

  const input = body as Record<string, unknown>;
  const allowed = new Set([
    "occurrenceId", "expectedRowVersion", "action",
    "actualLocalDate", "actualLocalTime", "endLocalDateTime", "endDateExclusive",
  ]);
  if (Object.keys(input).some((field) => !allowed.has(field))
    || typeof input.occurrenceId !== "string" || !UUID_V7_PATTERN.test(input.occurrenceId)
    || !Number.isSafeInteger(input.expectedRowVersion) || Number(input.expectedRowVersion) < 1
    || !["cancel", "move", "modify"].includes(String(input.action))) {
    return json({ error: "OCCURRENCE_MUTATION_BODY_INVALID" }, 422);
  }

  try {
    const intent = {
      version: VERSION,
      ownerProfileId: profile.profileId,
      occurrenceId: input.occurrenceId.toLowerCase(),
      expectedRowVersion: Number(input.expectedRowVersion),
      action: input.action,
      ...(input.actualLocalDate == null ? {} : { actualLocalDate: input.actualLocalDate }),
      ...(input.actualLocalTime == null ? {} : { actualLocalTime: input.actualLocalTime }),
      ...(input.endLocalDateTime == null ? {} : { endLocalDateTime: input.endLocalDateTime }),
      ...(input.endDateExclusive == null ? {} : { endDateExclusive: input.endDateExclusive }),
    };
    const payloadHash = await sha256(intent);
    const existing = await ctx.supabaseAdmin.from("calendar_event_occurrence_mutation_request")
      .select("occurrence_id,payload_version,payload_hash,response_http_status,response_body")
      .eq("owner_user_id", profile.profileId)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (existing.error) return json({ error: "OCCURRENCE_MUTATION_IDEMPOTENCY_LOOKUP_FAILED" }, 503);
    if (existing.data) {
      if (existing.data.occurrence_id !== intent.occurrenceId
        || existing.data.payload_version !== VERSION
        || storedHash(existing.data.payload_hash) !== payloadHash) {
        return json({ error: "IDEMPOTENCY_KEY_REUSED" }, 409);
      }
      return replayReceipt(existing.data);
    }

    const occurrenceResult = await ctx.supabaseAdmin.from("calendar_event_occurrence")
      .select("*")
      .eq("owner_user_id", profile.profileId)
      .eq("id", intent.occurrenceId)
      .maybeSingle();
    if (occurrenceResult.error) return json({ error: "OCCURRENCE_LOOKUP_FAILED" }, 503);
    const occurrence = occurrenceResult.data as Occurrence | null;
    if (!occurrence) return json({ error: "OCCURRENCE_NOT_FOUND" }, 404);
    if (Number(occurrence.row_version) !== intent.expectedRowVersion) {
      return json({
        error: "OCCURRENCE_VERSION_CONFLICT",
        occurrenceId: occurrence.id,
        rowVersion: occurrence.row_version,
      }, 409);
    }
    if (occurrence.occurrence_status !== "scheduled" && occurrence.occurrence_status !== "needs_review") {
      return json({ error: "OCCURRENCE_IS_NOT_MUTABLE" }, 409);
    }

    const patch: Record<string, unknown> = {
      occurrence_status: "scheduled",
      override_kind: null,
      review_candidate: null,
    };
    if (input.action === "cancel") {
      patch.occurrence_status = "cancelled";
      patch.override_kind = "cancelled";
    } else if (input.action === "move" && occurrence.temporal_kind === "all_day") {
      const nextDate = dateKey(input.actualLocalDate, "actualLocalDate");
      if (nextDate === occurrence.actual_local_date) throw new RangeError("La ocurrencia ya está en esa fecha.");
      const durationDays = daysBetween(
        String(occurrence.start_date),
        String(occurrence.end_date_exclusive),
      );
      if (durationDays < 1 || durationDays > 31) throw new RangeError("La duración actual de la ocurrencia no es válida.");
      patch.override_kind = "moved";
      patch.actual_local_date = nextDate;
      patch.start_date = nextDate;
      patch.end_date_exclusive = addRecurrenceCalendarDays(nextDate, durationDays);
    } else if (input.action === "move" && occurrence.temporal_kind === "zoned_civil") {
      const nextDate = dateKey(input.actualLocalDate, "actualLocalDate");
      const nextTime = clock(input.actualLocalTime, "actualLocalTime");
      const oldDate = String(occurrence.start_local).slice(0, 10);
      const oldTime = String(occurrence.start_local).slice(11);
      if (nextDate === oldDate && nextTime === oldTime) throw new RangeError("La ocurrencia ya está en esa hora.");
      const existingEndDate = String(occurrence.end_local).slice(0, 10);
      const existingEndTime = String(occurrence.end_local).slice(11);
      const dayOffset = daysBetween(oldDate, existingEndDate);
      const end = input.endLocalDateTime == null
        ? addRecurrenceCalendarDays(nextDate, dayOffset) + "T" + existingEndTime
        : localDateTime(input.endLocalDateTime, "endLocalDateTime");
      const start = nextDate + "T" + nextTime;
      const resolution = resolveLocalDateTimeRange({
        timeZone: String(occurrence.time_zone),
        start: {
          localDateTime: start,
          disambiguation: occurrence.start_disambiguation || "earlier",
          gapStrategy: "next-valid",
        },
        end: {
          localDateTime: end,
          disambiguation: occurrence.end_disambiguation || "earlier",
          gapStrategy: "next-valid",
        },
      });
      patch.override_kind = "moved";
      patch.actual_local_date = resolution.start.resolvedLocalDateTime.slice(0, 10);
      patch.actual_local_time = resolution.start.resolvedLocalDateTime.slice(11);
      Object.assign(patch, authoritativePatch(resolution));
    } else if (input.action === "modify" && occurrence.temporal_kind === "all_day") {
      const nextEnd = dateKey(input.endDateExclusive, "endDateExclusive");
      if (nextEnd <= String(occurrence.start_date)) throw new RangeError("La fecha final exclusiva debe ser posterior al inicio.");
      if (nextEnd === occurrence.end_date_exclusive) throw new RangeError("La duración no cambió.");
      patch.override_kind = "modified";
      patch.end_date_exclusive = nextEnd;
    } else if (input.action === "modify" && occurrence.temporal_kind === "zoned_civil") {
      const end = localDateTime(input.endLocalDateTime, "endLocalDateTime");
      const start = localDateTime(String(occurrence.start_local).replace(" ", "T"), "startLocalDateTime");
      if (end <= start) throw new RangeError("El final debe ser posterior al inicio.");
      if (end === String(occurrence.end_local).replace(" ", "T")) throw new RangeError("La duración no cambió.");
      const resolution = resolveLocalDateTimeRange({
        timeZone: String(occurrence.time_zone),
        start: {
          localDateTime: start,
          disambiguation: occurrence.start_disambiguation || "earlier",
          gapStrategy: "next-valid",
        },
        end: {
          localDateTime: end,
          disambiguation: occurrence.end_disambiguation || "earlier",
          gapStrategy: "next-valid",
        },
      });
      patch.override_kind = "modified";
      Object.assign(patch, authoritativePatch(resolution));
    } else {
      throw new RangeError("La acción no es compatible con el tipo de esta ocurrencia.");
    }

    const [protectedResult, taskScheduleResult] = await Promise.all([
      ctx.supabaseAdmin.from("protected_time_block")
        .select("id,updated_at,label,category,protection_mode,pattern_kind,time_zone,starts_at,ends_at,start_date,end_date_exclusive,weekdays,start_time_local,end_time_local,ends_next_day,archived_at,deleted_at")
        .eq("owner_user_id", profile.profileId)
        .is("archived_at", null)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .limit(501),
      ctx.supabaseAdmin.from("task_schedule")
        .select("id,updated_at,starts_at,ends_at,time_zone,schedule_status")
        .eq("owner_user_id", profile.profileId)
        .in("schedule_status", ["proposed", "confirmed"])
        .order("id", { ascending: true })
        .limit(501),
    ]);
    if (protectedResult.error) return json({ error: "PROTECTED_TIME_CONFLICT_LOOKUP_FAILED" }, 503);
    if (taskScheduleResult.error) return json({ error: "TASK_SCHEDULE_CONFLICT_LOOKUP_FAILED" }, 503);
    const protectedBlocks = Array.isArray(protectedResult.data) ? protectedResult.data : [];
    const taskSchedules = Array.isArray(taskScheduleResult.data) ? taskScheduleResult.data : [];
    if (protectedBlocks.length > 500 || taskSchedules.length > 500) {
      return json({ error: "OCCURRENCE_CONFLICT_ANALYSIS_EXCEEDS_500_ACTIVE_ROWS" }, 422);
    }
    const protectedSnapshot = protectedBlocks.map((item: Record<string, unknown>) => ({
      id: String(item.id), updated_at: String(item.updated_at),
    }));
    const taskScheduleSnapshot = taskSchedules.map((item: Record<string, unknown>) => ({
      id: String(item.id), updated_at: String(item.updated_at),
    }));

    if (input.action !== "cancel") {
      let calendarTimeZone = "America/Havana";
      if (occurrence.temporal_kind === "all_day") {
        const preference = await ctx.supabaseAdmin.from("user_preference")
          .select("time_zone")
          .eq("user_id", profile.profileId)
          .maybeSingle();
        if (preference.error) return json({ error: "AGENDA_TIME_ZONE_LOOKUP_FAILED" }, 503);
        if (typeof preference.data?.time_zone === "string" && preference.data.time_zone.trim()) {
          calendarTimeZone = preference.data.time_zone;
        }
      }
      const candidateEvent = occurrence.temporal_kind === "all_day"
        ? {
          temporal_kind: "all_day",
          start_date: patch.start_date ?? occurrence.start_date,
          end_date_exclusive: patch.end_date_exclusive ?? occurrence.end_date_exclusive,
        }
        : {
          temporal_kind: "zoned_civil",
          starts_at: patch.starts_at ?? occurrence.starts_at,
          ends_at: patch.ends_at ?? occurrence.ends_at,
        };
      const analysis = findProtectedTimeConflicts({
        event: candidateEvent,
        protectedBlocks,
        calendarTimeZone,
        resolveRange: resolveLocalDateTimeRange,
      });
      if (analysis.conflicts.length > 0) {
        return json({
          error: "PROTECTED_TIME_CONFLICTS",
          conflicts: analysis.conflicts,
        }, 409);
      }
      const candidateStart = Date.parse(analysis.candidate.startsAt);
      const candidateEnd = Date.parse(analysis.candidate.endsAt);
      const taskConflicts = taskSchedules.flatMap((schedule: Record<string, unknown>) => {
        const start = Date.parse(String(schedule.starts_at));
        const end = Date.parse(String(schedule.ends_at));
        return Number.isFinite(start) && Number.isFinite(end)
          && candidateStart < end && start < candidateEnd
          ? [{
            taskScheduleId: schedule.id,
            taskScheduleUpdatedAt: schedule.updated_at,
            startsAt: schedule.starts_at,
            endsAt: schedule.ends_at,
          }]
          : [];
      });
      if (taskConflicts.length > 0) {
        return json({ error: "TASK_SCHEDULE_CONFLICTS", conflicts: taskConflicts }, 409);
      }
    }

    const result = await ctx.supabaseAdmin.rpc("mutate_calendar_event_occurrence_once", {
      p_owner_user_id: profile.profileId,
      p_occurrence_id: occurrence.id,
      p_idempotency_key: key,
      p_payload_hash_hex: payloadHash,
      p_expected_row_version: intent.expectedRowVersion,
      p_occurrence_patch: patch,
      p_protected_time_snapshot: protectedSnapshot,
      p_task_schedule_snapshot: taskScheduleSnapshot,
      p_now: (dependencies.now ?? (() => new Date().toISOString()))(),
    });
    if (result.error) {
      const code = (result.error as { code?: string })?.code;
      if (code === "40001") return json({ error: "OCCURRENCE_VERSION_CONFLICT" }, 409);
      return json({ error: "OCCURRENCE_MUTATION_FAILED" }, 503);
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row || typeof row !== "object") return json({ error: "OCCURRENCE_MUTATION_RESULT_INVALID" }, 503);
    const outcome = row as Record<string, unknown>;
    if (typeof outcome.http_status !== "number") return json({ error: "OCCURRENCE_MUTATION_RESULT_INVALID" }, 503);
    return json({
      ...(outcome.response_body as Record<string, unknown>),
      replayed: outcome.replayed === true,
    }, outcome.http_status);
  } catch (error) {
    if (error instanceof TzdbVersionError) return json({ error: "TIMEZONE_RULES_UNAVAILABLE" }, 503);
    if (error instanceof TypeError || error instanceof RangeError) {
      return json({ error: error.message }, 422);
    }
    return json({ error: "OCCURRENCE_MUTATION_FAILED" }, 500);
  }
}
