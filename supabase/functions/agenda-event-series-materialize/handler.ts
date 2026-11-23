import {
  addRecurrenceCalendarDays,
  planRecurrenceMaterializationBatch,
  validateRecurrenceRule,
} from "../../../src/features/agenda/domain/recurrence.js";
import {
  planOccurrenceMaterializationReconciliation,
} from "../../../src/features/agenda/domain/recurrence-materialization.js";
import {
  buildRecurrenceEndEndpoints,
} from "../../../src/features/agenda/domain/recurrence-endpoints.js";
import {
  planOccurrenceResolutionBatches,
  joinOccurrenceResolutionBatch,
} from "../../../src/features/agenda/domain/occurrence-resolution.js";
import {
  findProtectedTimeConflicts,
} from "../../../src/features/agenda/domain/protected-time-conflicts.js";
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

export const MAX_REQUEST_BYTES = 16 * 1024;
export const MAX_SERIES_PER_REQUEST = 5;
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
  newOccurrenceId?: () => string;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function normalizeClock(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(label + " must be a local clock time.");
  const match = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:[.]([0-9]{1,3}))?)?$/.exec(value);
  if (!match) throw new RangeError(label + " must use HH:mm[:ss[.SSS]].");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError(label + " is outside the local clock range.");
  const milliseconds = (match[4] ?? "").padEnd(3, "0") || "000";
  return match[1] + ":" + match[2] + ":" + String(second).padStart(2, "0") + "." + milliseconds;
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

function buildOccurrenceRows({
  occurrences,
  seriesId,
  ownerProfileId,
  now,
  event,
  joined,
  newOccurrenceId,
}: {
  occurrences: readonly Record<string, any>[];
  seriesId: string;
  ownerProfileId: string;
  now: string;
  event: Record<string, any>;
  joined: readonly Record<string, any>[];
  newOccurrenceId: () => string;
}): Record<string, unknown>[] {
  const byKey = new Map(joined.map((item) => [item.occurrenceKey, item]));
  const endLocalTime = event.recurrence_end_local_time == null
    ? null
    : normalizeClock(String(event.recurrence_end_local_time), "recurrence_end_local_time");
  const endDayOffset = Number(event.recurrence_end_day_offset ?? 0);

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
    if (!resolved) throw new RangeError("Missing authoritative IANA resolution for " + occurrence.occurrenceKey);
    if (!endLocalTime) throw new RangeError("Timed recurrence is missing its explicit local end clock.");
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

function mapExistingOccurrence(row: Record<string, any>): Record<string, unknown> {
  const metadata = row.resolver_metadata && typeof row.resolver_metadata === "object"
    ? row.resolver_metadata
    : {};
  return {
    occurrenceKey: row.occurrence_key,
    originalLocalDate: row.original_local_date,
    temporalKind: row.temporal_kind,
    status: row.occurrence_status,
    overrideKind: row.override_kind,
    hasOverride: row.override_kind != null,
    reviewState: row.review_candidate == null ? null : "needs_review",
    startDate: row.start_date,
    endDateExclusive: row.end_date_exclusive,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timeZone: row.time_zone,
    rulesSource: metadata.rulesSource,
    authoritative: metadata.authoritative === true,
    rulesVersion: metadata.rulesVersion,
    resolverVersion: metadata.resolverVersion,
    updatedAt: row.updated_at,
  };
}

function makeConflictEvent(row: Record<string, unknown>) {
  return {
    temporal_kind: row.temporal_kind,
    start_date: row.start_date ?? null,
    end_date_exclusive: row.end_date_exclusive ?? null,
    starts_at: row.starts_at ?? null,
    ends_at: row.ends_at ?? null,
  };
}

/**
 * Authenticated, bounded top-up of a recurring series' rolling 90-day
 * materialization horizon. Repeated reads are safe: the planner preserves
 * history, overrides, terminal rows and unresolved review rows; the SQL writer
 * uses a shared owner lock and unique occurrence keys to prevent duplicates.
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

  let raw: string | null;
  try { raw = await readBoundedBody(request); }
  catch { return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400); }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);

  let body: unknown;
  try { body = JSON.parse(raw); }
  catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || Object.keys(body)[0] !== "seriesIds"
    || !Array.isArray((body as Record<string, unknown>).seriesIds)) {
    return json({ error: "BODY_MUST_CONTAIN_ONLY_SERIES_IDS" }, 422);
  }
  const seriesIds = (body as { seriesIds: unknown[] }).seriesIds;
  if (seriesIds.length < 1 || seriesIds.length > MAX_SERIES_PER_REQUEST
    || !seriesIds.every((id) => typeof id === "string" && UUID_V7_PATTERN.test(id))) {
    return json({ error: "SERIES_IDS_MUST_CONTAIN_1_TO_5_UUIDV7_VALUES" }, 422);
  }
  if (new Set(seriesIds.map((id) => String(id).toLowerCase())).size !== seriesIds.length) {
    return json({ error: "SERIES_IDS_MUST_BE_UNIQUE" }, 422);
  }

  try {
    const now = (dependencies.now ?? (() => new Date().toISOString()))();
    const preference = await ctx.supabaseAdmin.from("user_preference")
      .select("time_zone")
      .eq("user_id", profile.profileId)
      .maybeSingle();
    if (preference.error) return json({ error: "AGENDA_TIME_ZONE_LOOKUP_FAILED" }, 503);
    const calendarTimeZone = typeof preference.data?.time_zone === "string"
      && preference.data.time_zone.trim()
      ? preference.data.time_zone
      : DEFAULT_AGENDA_TIME_ZONE;

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
    if (protectedResult.error) return json({ error: "PROTECTED_TIME_CONFLICT_LOOKUP_FAILED" }, 503);
    if (taskScheduleResult.error) return json({ error: "TASK_SCHEDULE_CONFLICT_LOOKUP_FAILED" }, 503);
    const protectedBlocks = Array.isArray(protectedResult.data) ? protectedResult.data : [];
    const taskSchedules = Array.isArray(taskScheduleResult.data) ? taskScheduleResult.data : [];
    if (protectedBlocks.length > MAX_ACTIVE_CONFLICT_ROWS || taskSchedules.length > MAX_ACTIVE_CONFLICT_ROWS) {
      return json({ error: "CONFLICT_ANALYSIS_EXCEEDS_500_ACTIVE_ROWS" }, 422);
    }
    const protectedSnapshot = protectedBlocks.map((item: Record<string, unknown>) => ({
      id: String(item.id), updated_at: String(item.updated_at),
    }));
    const taskSnapshot = taskSchedules.map((item: Record<string, unknown>) => ({
      id: String(item.id), updated_at: String(item.updated_at),
    }));

    let materializedCount = 0;
    for (const seriesId of seriesIds as string[]) {
      const seriesResult = await ctx.supabaseAdmin.from("calendar_event")
        .select("*")
        .eq("owner_user_id", profile.profileId)
        .eq("id", seriesId)
        .maybeSingle();
      if (seriesResult.error) return json({ error: "RECURRING_SERIES_LOOKUP_FAILED" }, 503);
      const event = seriesResult.data as Record<string, any> | null;
      if (!event || !event.recurrence_rule || event.archived_at != null || event.deleted_at != null
        || ["cancelled", "finished"].includes(event.event_status)) {
        return json({ error: "RECURRING_SERIES_NOT_FOUND" }, 404);
      }

      const rule = validateRecurrenceRule(event.recurrence_rule);
      if (rule.temporalKind !== event.temporal_kind) {
        throw new RangeError("Recurring master temporal kind does not match its versioned rule.");
      }
      const seriesTimeZone = rule.temporalKind === "zoned_civil" ? rule.timeZone : calendarTimeZone;
      const materializationDate = localDateAt(now, seriesTimeZone);
      const batch = planRecurrenceMaterializationBatch({
        rule,
        seriesId,
        anchorDate: materializationDate,
        batchSize: 500,
      });
      const horizonEndExclusive = addRecurrenceCalendarDays(materializationDate, 90);

      const existingResult = await ctx.supabaseAdmin.from("calendar_event_occurrence")
        .select("*")
        .eq("owner_user_id", profile.profileId)
        .eq("calendar_event_id", seriesId)
        .gte("original_local_date", materializationDate)
        .lt("original_local_date", horizonEndExclusive)
        .order("original_local_date", { ascending: true })
        .order("occurrence_key", { ascending: true })
        .limit(MAX_ACTIVE_CONFLICT_ROWS + 1);
      if (existingResult.error) return json({ error: "RECURRING_OCCURRENCE_LOOKUP_FAILED" }, 503);
      const existingRows = Array.isArray(existingResult.data) ? existingResult.data : [];
      if (existingRows.length > MAX_ACTIVE_CONFLICT_ROWS) {
        throw new RangeError("A recurring series has more than 500 materialized rows in its 90-day horizon.");
      }

      const reconciliation = planOccurrenceMaterializationReconciliation({
        candidates: batch.occurrences,
        existingOccurrences: existingRows.map((row: Record<string, any>) => mapExistingOccurrence(row)),
        materializationDate,
      });
      const insertOccurrences = reconciliation.actions
        .filter((action) => action.action === "insert")
        .map((action) => action.occurrence as Record<string, any>);
      if (insertOccurrences.length === 0) continue;

      const endByOccurrenceKey = buildRecurrenceEndEndpoints({
        occurrences: insertOccurrences,
        endLocalTime: event.recurrence_end_local_time,
        endDayOffset: Number(event.recurrence_end_day_offset ?? 0),
      });
      const resolutionPlan = planOccurrenceResolutionBatches({
        occurrences: insertOccurrences,
        endByOccurrenceKey,
      });
      const joined: Record<string, any>[] = [];
      for (const planned of resolutionPlan.batches) {
        const response = await resolveLocalDateTimeRanges(planned.payload);
        joined.push(...joinOccurrenceResolutionBatch(planned, response));
      }

      const rows = buildOccurrenceRows({
        occurrences: insertOccurrences,
        seriesId,
        ownerProfileId: profile.profileId,
        now,
        event,
        joined,
        newOccurrenceId: dependencies.newOccurrenceId ?? uuidv7,
      });

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const analysis = findProtectedTimeConflicts({
          event: makeConflictEvent(row),
          protectedBlocks,
          calendarTimeZone,
          resolveRange: resolveLocalDateTimeRange,
        });
        if (analysis.conflicts.length > 0) {
          return json({
            error: "PROTECTED_TIME_CONFLICTS",
            occurrenceKey: row.occurrence_key,
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
              overlapStartsAt: new Date(Math.max(candidateStart, start)).toISOString(),
              overlapEndsAt: new Date(Math.min(candidateEnd, end)).toISOString(),
            }]
            : [];
        });
        if (taskConflicts.length > 0) {
          return json({
            error: "TASK_SCHEDULE_CONFLICTS",
            occurrenceKey: row.occurrence_key,
            conflicts: taskConflicts,
          }, 409);
        }
      }

      const result = await ctx.supabaseAdmin.rpc("materialize_recurring_calendar_event_once", {
        p_owner_user_id: profile.profileId,
        p_series_event_id: seriesId,
        p_materialization_date: materializationDate,
        p_occurrence_rows: rows,
        p_protected_time_snapshot: protectedSnapshot,
        p_task_schedule_snapshot: taskSnapshot,
      });
      if (result.error) {
        const code = (result.error as { code?: string })?.code;
        if (code === "40001") return json({ error: "RECURRING_MATERIALIZATION_SNAPSHOT_CHANGED" }, 409);
        return json({ error: "RECURRING_MATERIALIZATION_FAILED" }, 503);
      }
      const inserted = Number(result.data);
      if (!Number.isInteger(inserted) || inserted < 0 || inserted > rows.length) {
        return json({ error: "RECURRING_MATERIALIZATION_RESULT_INVALID" }, 503);
      }
      materializedCount += inserted;
    }

    return json({
      processedSeriesCount: seriesIds.length,
      materializedCount,
      horizonDays: 90,
    }, 200);
  } catch (error) {
    if (error instanceof TzdbVersionError) return json({ error: "TIMEZONE_RULES_UNAVAILABLE" }, 503);
    if (error instanceof TypeError || error instanceof RangeError) {
      return json({ error: error.message }, 422);
    }
    return json({ error: "RECURRING_MATERIALIZATION_FAILED" }, 500);
  }
}
