import {
  applyAuthoritativeEventResolution,
  buildEventTimeResolutionRequest,
  createEventDraft,
} from "../../../src/features/agenda/domain/event.js";
import { buildEventInsertRecord } from "../../../src/features/agenda/domain/event-record.js";
import { normalizeEventIdempotencyKey } from "../../../src/features/agenda/domain/event-idempotency.js";
import {
  addRecurrenceCalendarDays,
  planRecurrenceMaterializationBatch,
  validateRecurrenceRule,
} from "../../../src/features/agenda/domain/recurrence.js";
import {
  buildRecurrenceEndEndpoints,
  validatePersistableTimedRecurrence,
} from "../../../src/features/agenda/domain/recurrence-endpoints.js";
import { planOccurrenceResolutionBatches, joinOccurrenceResolutionBatch } from "../../../src/features/agenda/domain/occurrence-resolution.js";
import { findProtectedTimeConflicts } from "../../../src/features/agenda/domain/protected-time-conflicts.js";
import { uuidv7 } from "../../../src/lib/uuidv7.js";
import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
} from "../_shared/agenda-event-profile.ts";
import {
  resolveLocalDateTimeRange,
  resolveLocalDateTimeRanges,
  TzdbVersionError,
} from "../agenda-time-resolve/resolver.ts";

export const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_ACTIVE_CONFLICT_ROWS = 500;
const DEFAULT_AGENDA_TIME_ZONE = "America/Havana";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type AdminClient = {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
type Context = EventAuthenticatedContext & { supabaseAdmin: AdminClient };
type Dependencies = {
  now?: () => string;
  newEventId?: () => string;
  newOccurrenceId?: () => string;
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

function normalizeOffset(value: unknown): number {
  const offset = value == null ? 0 : value;
  if (!Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > 30) {
    throw new RangeError("endDayOffset must be an integer from 0 to 30.");
  }
  return Number(offset);
}

function normalizeClock(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(label + " must be a local clock time.");
  const match = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:[.]([0-9]{1,3}))?)?$/.exec(value);
  if (!match) throw new RangeError(label + " must use HH:mm[:ss[.SSS]].");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError(label + " is outside the local clock range.");
  const millisecond = (match[4] ?? "").padEnd(3, "0") || "000";
  return match[1] + ":" + match[2] + ":" + String(second).padStart(2, "0") + "." + millisecond;
}

function localDateAt(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new RangeError("now must be a valid timestamp.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

async function sha256(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function storedHash(value: unknown): string {
  if (value instanceof Uint8Array) {
    return Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return typeof value === "string" ? value.replace(/^\\x/, "") : "";
}

function sameSnapshot(
  left: readonly { id: string; updated_at: string }[],
  right: readonly { id: string; updated_at: string }[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function makeConflictEvent(candidate: Record<string, unknown>, temporalKind: "all_day" | "zoned_civil") {
  return {
    temporal_kind: temporalKind,
    start_date: candidate.start_date ?? null,
    end_date_exclusive: candidate.end_date_exclusive ?? null,
    starts_at: candidate.starts_at ?? null,
    ends_at: candidate.ends_at ?? null,
  };
}

function occurrenceRows({
  occurrences,
  seriesId,
  ownerProfileId,
  now,
  endLocalTime,
  endDayOffset,
  joined,
  newOccurrenceId,
}: {
  occurrences: readonly Record<string, any>[];
  seriesId: string;
  ownerProfileId: string;
  now: string;
  endLocalTime: string | null;
  endDayOffset: number;
  joined: readonly Record<string, any>[];
  newOccurrenceId: () => string;
}): Record<string, unknown>[] {
  const byKey = new Map(joined.map((item) => [item.occurrenceKey, item]));
  return occurrences.map((occurrence) => {
    const base = {
      id: newOccurrenceId(),
      owner_user_id: ownerProfileId,
      created_by_user_id: ownerProfileId,
      updated_by_user_id: ownerProfileId,
      calendar_event_id: seriesId,
      occurrence_key: occurrence.occurrenceKey,
      original_local_date: occurrence.originalLocalDate,
      original_local_time: occurrence.temporalKind === "all_day" ? null : normalizeClock(occurrence.localTime, "localTime"),
      actual_local_date: occurrence.actualLocalDate,
      actual_local_time: occurrence.temporalKind === "all_day" ? null : normalizeClock(occurrence.actualLocalTime, "actualLocalTime"),
      temporal_kind: occurrence.temporalKind,
      occurrence_status: "scheduled",
      override_kind: null,
      review_candidate: null,
      row_version: 1,
      created_at: now,
      updated_at: now,
    };
    if (occurrence.temporalKind === "all_day") {
      return {
        ...base,
        start_date: occurrence.actualLocalDate,
        end_date_exclusive: addRecurrenceCalendarDays(occurrence.actualLocalDate, endDayOffset + 1),
        start_local: null,
        end_local: null,
        time_zone: null,
        starts_at: null,
        ends_at: null,
        start_disambiguation: null,
        end_disambiguation: null,
        start_gap_strategy: null,
        end_gap_strategy: null,
        resolver_metadata: null,
      };
    }
    const resolved = byKey.get(occurrence.occurrenceKey);
    if (!resolved) throw new RangeError("Missing authoritative IANA resolution for " + occurrence.occurrenceKey);
    const endDate = addRecurrenceCalendarDays(occurrence.actualLocalDate, endDayOffset);
    const endLocalDateTime = endDate + "T" + endLocalTime;
    return {
      ...base,
      start_date: null,
      end_date_exclusive: null,
      start_local: occurrence.actualLocalDate + "T" + normalizeClock(occurrence.actualLocalTime, "actualLocalTime"),
      end_local: endLocalDateTime,
      time_zone: resolved.timeZone,
      starts_at: resolved.startsAt,
      ends_at: resolved.endsAt,
      start_disambiguation: occurrence.disambiguation ?? "earlier",
      end_disambiguation: resolved.endResolution?.disambiguation ?? occurrence.disambiguation ?? "earlier",
      start_gap_strategy: occurrence.gapStrategy ?? "next-valid",
      end_gap_strategy: "next-valid",
      resolver_metadata: {
        rulesSource: resolved.rulesSource,
        rulesVersion: resolved.rulesVersion,
        resolverVersion: resolved.resolverVersion,
        authoritative: true,
        start: resolved.startResolution,
        end: resolved.endResolution,
      },
    };
  });
}

/**
 * Creates a recurring Event's master row and all eligible occurrences for the
 * approved rolling 90-day horizon in one owner-scoped idempotent RPC.
 *
 * This first server slice rejects any protected-time or TaskSchedule collision.
 * It does not silently consent to overlaps; a future UI action can add explicit,
 * version-bound decisions without changing the persistence contract.
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
  try { raw = await readBoundedBody(request); }
  catch { return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400); }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => !["event", "recurrenceRule", "endLocalTime", "endDayOffset"].includes(key))
    || !("event" in body) || !("recurrenceRule" in body)) {
    return json({ error: "BODY_MUST_CONTAIN_EVENT_AND_RECURRENCERULE" }, 422);
  }

  try {
    const input = body as Record<string, unknown>;
    const eventDraft = createEventDraft(input.event);
    const ruleInput = input.recurrenceRule;
    const endDayOffset = normalizeOffset(input.endDayOffset);
    const rule = validateRecurrenceRule(ruleInput);
    if (rule.temporalKind === "zoned_civil") {
      const timed = validatePersistableTimedRecurrence({
        ...(ruleInput as Record<string, unknown>),
        endLocalTime: input.endLocalTime,
        endDayOffset,
      });
      if (eventDraft.temporal.kind !== "zoned_civil") {
        throw new RangeError("A timed recurrence rule requires a zoned-civil Event.");
      }
      const temporal = eventDraft.temporal;
      if (rule.startDate !== temporal.startLocalDateTime.slice(0, 10)
        || rule.localTime !== normalizeClock(temporal.startLocalDateTime.slice(11), "Event start")
        || rule.timeZone !== temporal.timeZone
        || normalizeClock(input.endLocalTime, "endLocalTime") !== timed.endLocalTime) {
        throw new RangeError("Recurring rule start date/time and timezone must match the Event draft.");
      }
      const expectedEndDate = addRecurrenceCalendarDays(rule.startDate, timed.endDayOffset);
      if (temporal.endLocalDateTime.slice(0, 10) !== expectedEndDate
        || normalizeClock(temporal.endLocalDateTime.slice(11), "Event end") !== timed.endLocalTime) {
        throw new RangeError("The Event draft end must match endLocalTime/endDayOffset.");
      }
    } else {
      if (eventDraft.temporal.kind !== "all_day") {
        throw new RangeError("An all-day recurrence rule requires an all-day Event.");
      }
      if (input.endLocalTime != null) throw new RangeError("All-day recurrence cannot contain endLocalTime.");
      const temporal = eventDraft.temporal;
      const expectedEndExclusive = addRecurrenceCalendarDays(rule.startDate, endDayOffset + 1);
      if (rule.startDate !== temporal.startDate || temporal.endDateExclusive !== expectedEndExclusive) {
        throw new RangeError("All-day Event end range must match endDayOffset.");
      }
    }
    if (rule.temporalKind !== eventDraft.temporal.kind || eventDraft.temporal.kind === "fixed_instant") {
      throw new RangeError("Recurring Events support only all-day or zoned-civil temporal rules.");
    }

    const endLocalTime = rule.temporalKind === "zoned_civil"
      ? validatePersistableTimedRecurrence({
        ...(ruleInput as Record<string, unknown>),
        endLocalTime: input.endLocalTime,
        endDayOffset,
      }).endLocalTime
      : null;
    const now = (dependencies.now ?? (() => new Date().toISOString()))();
    const intent = {
      version: "recurring-event-create-v1",
      event: eventDraft,
      recurrenceRule: rule,
      endLocalTime,
      endDayOffset,
    };
    const payloadHash = await sha256(intent);

    // Fast replay before generating IDs, expanding dates or depending on TZDB.
    const existing = await ctx.supabaseAdmin
      .from("calendar_event_series_mutation_request")
      .select("payload_version,payload_hash,response_http_status,response_body")
      .eq("owner_user_id", profile.profileId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing.error) return json({ error: "RECURRING_EVENT_IDEMPOTENCY_LOOKUP_FAILED" }, 503);
    if (existing.data) {
      if (existing.data.payload_version !== "recurring-event-create-v1"
        || storedHash(existing.data.payload_hash) !== payloadHash) {
        return json({ error: "IDEMPOTENCY_KEY_REUSED" }, 409);
      }
      if (typeof existing.data.response_http_status !== "number"
        || !existing.data.response_body || typeof existing.data.response_body !== "object") {
        return json({ error: "RECURRING_EVENT_RECEIPT_INCOMPLETE" }, 503);
      }
      return json({ ...(existing.data.response_body as Record<string, unknown>), replayed: true },
        existing.data.response_http_status);
    }

    const eventId = (dependencies.newEventId ?? uuidv7)();
    const materializationTimeZone = rule.temporalKind === "zoned_civil"
      ? rule.timeZone
      : await (async () => {
        const preference = await ctx.supabaseAdmin.from("user_preference")
          .select("time_zone").eq("user_id", profile.profileId).maybeSingle();
        if (preference.error) throw new Error("AGENDA_TIME_ZONE_LOOKUP_FAILED");
        return typeof preference.data?.time_zone === "string" && preference.data.time_zone.trim()
          ? preference.data.time_zone
          : DEFAULT_AGENDA_TIME_ZONE;
      })();
    const anchorDate = localDateAt(now, materializationTimeZone);
    const batch = planRecurrenceMaterializationBatch({
      rule,
      seriesId: eventId,
      anchorDate: rule.startDate > anchorDate ? rule.startDate : anchorDate,
    });
    const occurrences = batch.occurrences;
    if (occurrences.length === 0) {
      throw new RangeError("The recurrence rule has no eligible occurrence inside the current 90-day horizon.");
    }

    let joined: Record<string, unknown>[] = [];
    let resolvedMasterDraft = eventDraft;
    if (rule.temporalKind === "zoned_civil") {
      const masterResolution = resolveLocalDateTimeRange(buildEventTimeResolutionRequest(eventDraft));
      resolvedMasterDraft = applyAuthoritativeEventResolution(eventDraft, masterResolution);
      const ends = buildRecurrenceEndEndpoints({
        occurrences,
        endLocalTime,
        endDayOffset,
      });
      const resolutionPlan = planOccurrenceResolutionBatches({
        occurrences,
        endByOccurrenceKey: ends,
      });
      for (const planned of resolutionPlan.batches) {
        const response = resolveLocalDateTimeRanges(planned.payload);
        joined.push(...joinOccurrenceResolutionBatch(planned, response));
      }
    }

    const createdAt = now;
    const rows = occurrenceRows({
      occurrences,
      seriesId: eventId,
      ownerProfileId: profile.profileId,
      now: createdAt,
      endLocalTime,
      endDayOffset,
      joined,
      newOccurrenceId: dependencies.newOccurrenceId ?? uuidv7,
    });

    const [protectedResult, taskScheduleResult] = await Promise.all([
      ctx.supabaseAdmin.from("protected_time_block")
        .select("id,updated_at,label,category,protection_mode,pattern_kind,time_zone,starts_at,ends_at,start_date,end_date_exclusive,weekdays,start_time_local,end_time_local,ends_next_day,archived_at,deleted_at")
        .eq("owner_user_id", profile.profileId)
        .is("archived_at", null)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .limit(MAX_ACTIVE_CONFLICT_ROWS + 1),
      ctx.supabaseAdmin.from("task_schedule")
        .select("id,updated_at,starts_at,ends_at,time_zone,schedule_status")
        .eq("owner_user_id", profile.profileId)
        .in("schedule_status", ["proposed", "confirmed"])
        .order("id", { ascending: true })
        .limit(MAX_ACTIVE_CONFLICT_ROWS + 1),
    ]);
    if (protectedResult.error) throw new Error("PROTECTED_TIME_CONFLICT_LOOKUP_FAILED");
    if (taskScheduleResult.error) throw new Error("TASK_SCHEDULE_CONFLICT_LOOKUP_FAILED");
    const protectedBlocks = Array.isArray(protectedResult.data) ? protectedResult.data : [];
    const taskSchedules = Array.isArray(taskScheduleResult.data) ? taskScheduleResult.data : [];
    if (protectedBlocks.length > MAX_ACTIVE_CONFLICT_ROWS || taskSchedules.length > MAX_ACTIVE_CONFLICT_ROWS) {
      throw new RangeError("Conflict analysis is capped at 500 active Protected Time blocks and TaskSchedules.");
    }

    const protectedSnapshot = protectedBlocks.map((item: Record<string, unknown>) => ({
      id: String(item.id), updated_at: String(item.updated_at),
    }));
    const taskSnapshot = taskSchedules.map((item: Record<string, unknown>) => ({
      id: String(item.id), updated_at: String(item.updated_at),
    }));
    const calendarTimeZone = materializationTimeZone;
    let firstTaskWindow: { startsAt: string; endsAt: string } | null = null;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const analysis = findProtectedTimeConflicts({
        event: makeConflictEvent(row, rule.temporalKind),
        protectedBlocks,
        calendarTimeZone,
        resolveRange: resolveLocalDateTimeRange,
      });
      const candidate = analysis.candidate as { startsAt: string; endsAt: string };
      if (!firstTaskWindow) firstTaskWindow = { startsAt: candidate.startsAt, endsAt: candidate.endsAt };
      if (analysis.conflicts.length > 0) {
        return json({
          error: "PROTECTED_TIME_CONFLICTS",
          occurrenceKey: occurrences[index].occurrenceKey,
          conflicts: analysis.conflicts,
        }, 409);
      }
      const scheduleConflicts = taskSchedules.flatMap((schedule: Record<string, unknown>) => {
        const startsAt = Date.parse(String(schedule.starts_at));
        const endsAt = Date.parse(String(schedule.ends_at));
        return Number.isFinite(startsAt) && Number.isFinite(endsAt)
          && Date.parse(candidate.startsAt) < endsAt && startsAt < Date.parse(candidate.endsAt)
          ? [{
            taskScheduleId: schedule.id,
            taskScheduleUpdatedAt: schedule.updated_at,
            startsAt: schedule.starts_at,
            endsAt: schedule.ends_at,
            overlapStartsAt: new Date(Math.max(startsAt, Date.parse(candidate.startsAt))).toISOString(),
            overlapEndsAt: new Date(Math.min(endsAt, Date.parse(candidate.endsAt))).toISOString(),
            requiredDecision: "keep_overlap",
          }]
          : [];
      });
      if (scheduleConflicts.length > 0) {
        return json({
          error: "TASK_SCHEDULE_CONFLICTS",
          occurrenceKey: occurrences[index].occurrenceKey,
          conflicts: scheduleConflicts,
        }, 409);
      }
    }

    const firstWindow = firstTaskWindow;
    if (!firstWindow) throw new RangeError("No materialized recurrence window is available.");
    const baseRecord = buildEventInsertRecord({
      eventDraft: resolvedMasterDraft,
      eventId,
      ownerProfileId: profile.profileId,
      now,
      protectedTimeDecisions: [],
      protectedTimeSnapshot: protectedSnapshot,
      taskScheduleDecisions: [],
      taskScheduleSnapshot: taskSnapshot,
      taskScheduleWindow: firstWindow,
    });
    const eventRecord = {
      ...baseRecord,
      recurrence_rule: rule,
      recurrence_end_local_time: endLocalTime,
      recurrence_end_day_offset: endDayOffset,
    };
    const result = await ctx.supabaseAdmin.rpc("create_recurring_calendar_event_once", {
      p_owner_user_id: profile.profileId,
      p_idempotency_key: idempotencyKey,
      p_payload_hash_hex: payloadHash,
      p_event_record: eventRecord,
      p_occurrence_rows: rows,
      p_now: now,
    });
    if (result.error) return json({ error: "RECURRING_EVENT_CREATE_FAILED" }, 503);
    const outcome = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!outcome || typeof outcome !== "object") return json({ error: "RECURRING_EVENT_CREATE_RESULT_INVALID" }, 503);
    const response = outcome as Record<string, unknown>;
    if (typeof response.http_status !== "number"
      || !response.response_body || typeof response.response_body !== "object") {
      return json({ error: "RECURRING_EVENT_CREATE_RESULT_INVALID" }, 503);
    }
    return json({
      ...(response.response_body as Record<string, unknown>),
      replayed: response.replayed === true,
    }, response.http_status);
  } catch (error) {
    if (error instanceof TzdbVersionError) return json({ error: "TIMEZONE_RULES_UNAVAILABLE" }, 503);
    if (error instanceof TypeError || error instanceof RangeError) {
      return json({ error: error.message }, 422);
    }
    if (error instanceof Error && (
      error.message === "AGENDA_TIME_ZONE_LOOKUP_FAILED"
      || error.message === "PROTECTED_TIME_CONFLICT_LOOKUP_FAILED"
      || error.message === "TASK_SCHEDULE_CONFLICT_LOOKUP_FAILED"
    )) return json({ error: error.message }, 503);
    return json({ error: "RECURRING_EVENT_CREATE_FAILED" }, 500);
  }
}
