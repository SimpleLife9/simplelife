import {
  addRecurrenceCalendarDays,
  expandRecurrenceDates,
  validateRecurrenceRule,
} from "../../../src/features/agenda/domain/recurrence.js";
import {
  buildRecurrenceEndEndpoints,
  validatePersistableTimedRecurrence,
} from "../../../src/features/agenda/domain/recurrence-endpoints.js";
import {
  planOccurrenceResolutionBatches,
  joinOccurrenceResolutionBatch,
} from "../../../src/features/agenda/domain/occurrence-resolution.js";
import {
  applyAuthoritativeEventResolution,
  buildEventTimeResolutionRequest,
  createEventDraft,
} from "../../../src/features/agenda/domain/event.js";
import { buildEventInsertRecord } from "../../../src/features/agenda/domain/event-record.js";
import { normalizeEventIdempotencyKey } from "../../../src/features/agenda/domain/event-idempotency.js";
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
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  newSeriesId?: () => string;
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
  return match[1] + ":" + match[2] + ":" + String(second).padStart(2, "0")
    + "." + ((match[4] ?? "").padEnd(3, "0") || "000");
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
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function storedHash(value: unknown): string {
  if (value instanceof Uint8Array) {
    return Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return typeof value === "string" ? value.replace(/^\\x/, "") : "";
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
      original_local_time: occurrence.temporalKind === "all_day"
        ? null
        : normalizeClock(occurrence.localTime, "localTime"),
      actual_local_date: occurrence.actualLocalDate,
      actual_local_time: occurrence.temporalKind === "all_day"
        ? null
        : normalizeClock(occurrence.actualLocalTime, "actualLocalTime"),
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
    if (!resolved || !endLocalTime) throw new RangeError("A timed recurrence is missing authoritative IANA resolution or its explicit end clock.");
    const endDate = addRecurrenceCalendarDays(occurrence.actualLocalDate, endDayOffset);
    return {
      ...base,
      start_date: null,
      end_date_exclusive: null,
      start_local: occurrence.actualLocalDate + "T" + normalizeClock(occurrence.actualLocalTime, "actualLocalTime"),
      end_local: endDate + "T" + endLocalTime,
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

function conflictEvent(row: Record<string, unknown>) {
  return {
    temporal_kind: row.temporal_kind,
    start_date: row.start_date ?? null,
    end_date_exclusive: row.end_date_exclusive ?? null,
    starts_at: row.starts_at ?? null,
    ends_at: row.ends_at ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Authenticated atomic edit of an existing recurring series. The selected
 * scheduled occurrence defines the effective boundary. "Entire series"
 * reconciles only future nonterminal rows; "this and following" creates a
 * child series and retains the selected occurrence as its inherited identity.
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
  try { idempotencyKey = normalizeEventIdempotencyKey(request.headers.get("idempotency-key")); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "INVALID_IDEMPOTENCY_KEY" }, 422); }

  let raw: string | null;
  try { raw = await readBoundedBody(request); }
  catch { return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400); }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);

  let body: unknown;
  try { body = JSON.parse(raw); }
  catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  const allowed = [
    "seriesId", "expectedUpdatedAt", "selectedOccurrenceId", "scope",
    "event", "recurrenceRule", "endLocalTime", "endDayOffset",
  ];
  if (!isRecord(body) || Object.keys(body).some((key) => !allowed.includes(key))
    || allowed.some((key) => !(key in body))) {
    return json({ error: "SERIES_EDIT_BODY_HAS_UNSUPPORTED_OR_MISSING_FIELDS" }, 422);
  }
  if (typeof body.seriesId !== "string" || !UUID_V7_PATTERN.test(body.seriesId)
    || typeof body.selectedOccurrenceId !== "string" || !UUID_V7_PATTERN.test(body.selectedOccurrenceId)
    || typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))
    || !["entire_series", "this_and_following"].includes(String(body.scope))) {
    return json({ error: "SERIES_EDIT_ID_SCOPE_OR_VERSION_INVALID" }, 422);
  }

  try {
    const now = (dependencies.now ?? (() => new Date().toISOString()))();
    const existingReceipt = await ctx.supabaseAdmin.from("calendar_event_series_edit_request")
      .select("series_event_id,payload_version,payload_hash,response_http_status,response_body")
      .eq("owner_user_id", profile.profileId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingReceipt.error) return json({ error: "SERIES_EDIT_IDEMPOTENCY_LOOKUP_FAILED" }, 503);

    const eventDraft = createEventDraft(body.event);
    const seriesResult = await ctx.supabaseAdmin.from("calendar_event")
      .select("*")
      .eq("owner_user_id", profile.profileId)
      .eq("id", body.seriesId)
      .maybeSingle();
    if (seriesResult.error) return json({ error: "RECURRING_SERIES_LOOKUP_FAILED" }, 503);
    const currentSeries = seriesResult.data as Record<string, any> | null;
    if (!currentSeries || !currentSeries.recurrence_rule) return json({ error: "RECURRING_SERIES_NOT_FOUND" }, 404);

    const occurrenceResult = await ctx.supabaseAdmin.from("calendar_event_occurrence")
      .select("*")
      .eq("owner_user_id", profile.profileId)
      .eq("calendar_event_id", body.seriesId)
      .eq("id", body.selectedOccurrenceId)
      .maybeSingle();
    if (occurrenceResult.error) return json({ error: "SELECTED_OCCURRENCE_LOOKUP_FAILED" }, 503);
    const selected = occurrenceResult.data as Record<string, any> | null;
    if (!selected) return json({ error: "SELECTED_OCCURRENCE_NOT_FOUND" }, 404);
    const selectedDate = String(selected.original_local_date);
    if (selected.occurrence_status !== "scheduled" || selected.override_kind != null
      || selected.review_candidate != null) {
      return json({ error: "SERIES_EDIT_OCCURRENCE_NOT_EDITABLE" }, 409);
    }

    let ruleInput = body.recurrenceRule as Record<string, unknown>;
    if (!isRecord(ruleInput)) throw new TypeError("recurrenceRule must be an object.");
    ruleInput = { ...ruleInput, startDate: selectedDate };
    if (body.scope === "this_and_following") {
      const exclusions = Array.isArray(ruleInput.excludedDates) ? ruleInput.excludedDates : [];
      ruleInput.excludedDates = [...new Set([...exclusions, selectedDate])];
    }
    const rule = validateRecurrenceRule(ruleInput);
    const endDayOffset = normalizeOffset(body.endDayOffset);
    const endLocalTime = rule.temporalKind === "zoned_civil"
      ? validatePersistableTimedRecurrence({
        ...ruleInput,
        endLocalTime: body.endLocalTime,
        endDayOffset,
      }).endLocalTime
      : null;

    if (rule.temporalKind !== eventDraft.temporal.kind) {
      throw new RangeError("La serie no puede cambiar entre eventos de día completo y eventos con hora.");
    }
    if (rule.temporalKind === "zoned_civil") {
      const timed = validatePersistableTimedRecurrence({
        ...ruleInput,
        endLocalTime: body.endLocalTime,
        endDayOffset,
      });
      if (eventDraft.temporal.kind !== "zoned_civil"
        || eventDraft.temporal.startLocalDateTime.slice(0, 10) !== selectedDate
        || typeof rule.localTime !== "string"
        || eventDraft.temporal.startLocalDateTime.slice(11, 19) !== rule.localTime.slice(0, 8)
        || eventDraft.temporal.timeZone !== rule.timeZone
        || eventDraft.temporal.endLocalDateTime.slice(0, 10) !== addRecurrenceCalendarDays(selectedDate, timed.endDayOffset)
        || normalizeClock(eventDraft.temporal.endLocalDateTime.slice(11), "Event end") !== timed.endLocalTime) {
        throw new RangeError("El evento debe coincidir con la fecha seleccionada, la hora inicial y el extremo final explícito de la nueva regla.");
      }
    } else {
      if (eventDraft.temporal.kind !== "all_day"
        || eventDraft.temporal.startDate !== selectedDate
        || eventDraft.temporal.endDateExclusive !== addRecurrenceCalendarDays(selectedDate, endDayOffset + 1)
        || body.endLocalTime != null) {
        throw new RangeError("El evento de día completo debe comenzar en la ocurrencia seleccionada y conservar el intervalo exclusivo indicado.");
      }
    }

    const intent = {
      version: "recurring-series-edit-v1",
      seriesId: body.seriesId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      selectedOccurrenceId: body.selectedOccurrenceId,
      scope: body.scope,
      eventDraft,
      recurrenceRule: rule,
      endLocalTime,
      endDayOffset,
    };
    const payloadHash = await sha256(intent);
    if (existingReceipt.data) {
      if (existingReceipt.data.series_event_id !== body.seriesId
        || existingReceipt.data.payload_version !== "recurring-series-edit-v1"
        || storedHash(existingReceipt.data.payload_hash) !== payloadHash) {
        return json({ error: "IDEMPOTENCY_KEY_REUSED" }, 409);
      }
      if (typeof existingReceipt.data.response_http_status !== "number"
        || !isRecord(existingReceipt.data.response_body)) {
        return json({ error: "SERIES_EDIT_RECEIPT_INCOMPLETE" }, 503);
      }
      return json({ ...existingReceipt.data.response_body, replayed: true }, existingReceipt.data.response_http_status);
    }

    if (currentSeries.updated_at !== body.expectedUpdatedAt) {
      return json({ error: "RECURRING_SERIES_VERSION_CONFLICT", updatedAt: currentSeries.updated_at }, 409);
    }

    const preference = await ctx.supabaseAdmin.from("user_preference")
      .select("time_zone").eq("user_id", profile.profileId).maybeSingle();
    if (preference.error) return json({ error: "AGENDA_TIME_ZONE_LOOKUP_FAILED" }, 503);
    const calendarTimeZone = typeof preference.data?.time_zone === "string" && preference.data.time_zone.trim()
      ? preference.data.time_zone
      : DEFAULT_AGENDA_TIME_ZONE;
    const materializationTimeZone = rule.temporalKind === "zoned_civil" ? rule.timeZone : calendarTimeZone;
    const materializationDate = localDateAt(now, materializationTimeZone);
    const horizonEnd = addRecurrenceCalendarDays(materializationDate, 89);
    const firstCandidateDate = selectedDate > materializationDate ? selectedDate : materializationDate;
    // A split child identity is generated exactly once before deriving keys.
    // On an idempotent retry the receipt path above returns before this point.
    const childSeriesId = body.scope === "this_and_following"
      ? (dependencies.newSeriesId ?? uuidv7)()
      : null;
    const seriesIdForRows = body.scope === "entire_series" ? String(body.seriesId) : childSeriesId!;
    const plannedOccurrences = firstCandidateDate > horizonEnd
      ? []
      : expandRecurrenceDates({
        rule,
        seriesId: seriesIdForRows,
        rangeStart: firstCandidateDate,
        rangeEnd: horizonEnd,
        maxOccurrences: 500,
      });

    const resolutionPlan = rule.temporalKind === "zoned_civil"
      ? planOccurrenceResolutionBatches({
        occurrences: plannedOccurrences,
        endByOccurrenceKey: buildRecurrenceEndEndpoints({
          occurrences: plannedOccurrences,
          endLocalTime,
          endDayOffset,
        }),
      })
      : null;
    const joined: Record<string, any>[] = [];
    if (resolutionPlan) {
      for (const batch of resolutionPlan.batches) {
        const resolved = await resolveLocalDateTimeRanges(batch.payload);
        joined.push(...joinOccurrenceResolutionBatch(batch, resolved));
      }
    }

    let resolvedMasterDraft = eventDraft;
    if (rule.temporalKind === "zoned_civil") {
      const masterResolution = resolveLocalDateTimeRange(buildEventTimeResolutionRequest(eventDraft));
      resolvedMasterDraft = applyAuthoritativeEventResolution(eventDraft, masterResolution);
    }

    const newRows = occurrenceRows({
      occurrences: plannedOccurrences,
      seriesId: seriesIdForRows,
      ownerProfileId: profile.profileId,
      now,
      endLocalTime,
      endDayOffset,
      joined,
      newOccurrenceId: dependencies.newOccurrenceId ?? uuidv7,
    });

    const [protectedResult, taskScheduleResult] = await Promise.all([
      ctx.supabaseAdmin.from("protected_time_block")
        .select("id,updated_at,label,category,protection_mode,pattern_kind,time_zone,starts_at,ends_at,start_date,end_date_exclusive,weekdays,start_time_local,end_time_local,ends_next_day,archived_at,deleted_at")
        .eq("owner_user_id", profile.profileId).is("archived_at", null).is("deleted_at", null)
        .order("id", { ascending: true }).limit(MAX_ACTIVE_CONFLICT_ROWS + 1),
      ctx.supabaseAdmin.from("task_schedule")
        .select("id,updated_at,starts_at,ends_at,time_zone,schedule_status")
        .eq("owner_user_id", profile.profileId).in("schedule_status", ["proposed", "confirmed"])
        .order("id", { ascending: true }).limit(MAX_ACTIVE_CONFLICT_ROWS + 1),
    ]);
    if (protectedResult.error || taskScheduleResult.error) return json({ error: "SERIES_EDIT_CONFLICT_LOOKUP_FAILED" }, 503);
    const protectedBlocks = Array.isArray(protectedResult.data) ? protectedResult.data : [];
    const taskSchedules = Array.isArray(taskScheduleResult.data) ? taskScheduleResult.data : [];
    if (protectedBlocks.length > MAX_ACTIVE_CONFLICT_ROWS || taskSchedules.length > MAX_ACTIVE_CONFLICT_ROWS) {
      return json({ error: "SERIES_EDIT_CONFLICT_ANALYSIS_EXCEEDS_500_ROWS" }, 422);
    }
    const protectedSnapshot = protectedBlocks.map((item: Record<string, unknown>) => ({ id: String(item.id), updated_at: String(item.updated_at) }));
    const taskSnapshot = taskSchedules.map((item: Record<string, unknown>) => ({ id: String(item.id), updated_at: String(item.updated_at) }));

    let firstWindow: { startsAt: string; endsAt: string } | null = null;
    for (let index = 0; index < newRows.length; index += 1) {
      const row = newRows[index];
      const analysis = findProtectedTimeConflicts({
        event: conflictEvent(row),
        protectedBlocks,
        calendarTimeZone,
        resolveRange: resolveLocalDateTimeRange,
      });
      if (!firstWindow) firstWindow = analysis.candidate as { startsAt: string; endsAt: string };
      if (analysis.conflicts.length > 0) {
        return json({ error: "PROTECTED_TIME_CONFLICTS", occurrenceKey: row.occurrence_key, conflicts: analysis.conflicts }, 409);
      }
      const starts = Date.parse(analysis.candidate.startsAt);
      const ends = Date.parse(analysis.candidate.endsAt);
      const taskConflicts = taskSchedules.flatMap((schedule: Record<string, unknown>) => {
        const start = Date.parse(String(schedule.starts_at));
        const end = Date.parse(String(schedule.ends_at));
        return Number.isFinite(start) && Number.isFinite(end) && starts < end && start < ends
          ? [{ taskScheduleId: schedule.id, taskScheduleUpdatedAt: schedule.updated_at, startsAt: schedule.starts_at, endsAt: schedule.ends_at }]
          : [];
      });
      if (taskConflicts.length) return json({ error: "TASK_SCHEDULE_CONFLICTS", occurrenceKey: row.occurrence_key, conflicts: taskConflicts }, 409);
    }

    const eventIdForRecord = body.scope === "entire_series" ? String(body.seriesId) : childSeriesId!;
    const taskScheduleWindow = firstWindow ?? undefined;
    const baseRecord = buildEventInsertRecord({
      eventDraft: resolvedMasterDraft,
      eventId: eventIdForRecord,
      ownerProfileId: profile.profileId,
      now,
      protectedTimeDecisions: [],
      protectedTimeSnapshot: protectedSnapshot,
      taskScheduleDecisions: [],
      taskScheduleSnapshot: taskSnapshot,
      taskScheduleWindow,
    });
    const recurrenceFields = {
      recurrence_rule: rule,
      recurrence_end_local_time: endLocalTime,
      recurrence_end_day_offset: endDayOffset,
      recurrence_effective_from: selectedDate,
    };

    const seriesPatch = body.scope === "entire_series"
      ? {
        ...baseRecord,
        ...recurrenceFields,
        recurrence_effective_through: currentSeries.recurrence_effective_through ?? null,
      }
      : {
        recurrence_effective_through: selectedDate,
        updated_by_user_id: profile.profileId,
      };

    const newSeriesRecord = body.scope === "this_and_following"
      ? {
        ...baseRecord,
        ...recurrenceFields,
        recurrence_effective_through: currentSeries.recurrence_effective_through ?? null,
        recurrence_parent_event_id: body.seriesId,
        recurrence_inherited_occurrence_id: body.selectedOccurrenceId,
      }
      : null;

    const result = await ctx.supabaseAdmin.rpc("mutate_recurring_calendar_event_once", {
      p_owner_user_id: profile.profileId,
      p_series_event_id: body.seriesId,
      p_idempotency_key: idempotencyKey,
      p_payload_hash_hex: payloadHash,
      p_expected_updated_at: body.expectedUpdatedAt,
      p_scope: body.scope,
      p_selected_occurrence_id: body.selectedOccurrenceId,
      p_materialization_date: materializationDate,
      p_series_patch: seriesPatch,
      p_new_series_record: newSeriesRecord,
      p_occurrence_rows: newRows,
      p_protected_time_snapshot: protectedSnapshot,
      p_task_schedule_snapshot: taskSnapshot,
      p_now: now,
    });
    if (result.error) {
      const code = (result.error as { code?: string })?.code;
      if (code === "40001") return json({ error: "SERIES_EDIT_CONFLICT_SNAPSHOT_CHANGED" }, 409);
      return json({ error: "RECURRING_SERIES_EDIT_FAILED" }, 503);
    }
    const outcome = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!isRecord(outcome) || typeof outcome.http_status !== "number" || !isRecord(outcome.response_body)) {
      return json({ error: "RECURRING_SERIES_EDIT_RESULT_INVALID" }, 503);
    }
    return json({ ...outcome.response_body, replayed: outcome.replayed === true }, outcome.http_status);
  } catch (error) {
    if (error instanceof TzdbVersionError) return json({ error: "TIMEZONE_RULES_UNAVAILABLE" }, 503);
    if (error instanceof TypeError || error instanceof RangeError) {
      return json({ error: error.message }, 422);
    }
    return json({ error: "RECURRING_SERIES_EDIT_FAILED" }, 500);
  }
}
