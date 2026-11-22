import { findProtectedTimeConflicts, normalizeProtectedTimeDecisions } from "../../../src/features/agenda/domain/protected-time-conflicts.js";
import { resolveLocalDateTimeRange } from "../agenda-time-resolve/resolver.ts";

export const DEFAULT_AGENDA_TIME_ZONE = "America/Havana";
export const MAX_ACTIVE_PROTECTED_TIME_BLOCKS = 500;
export const MAX_CONFIRMED_TASK_SCHEDULES = 500;
export const MAX_CONFIRMED_CALENDAR_EVENTS = 500;

type AdminClient = { from(table: string): any };
type EventRecord = {
  id?: string;
  temporal_kind: "all_day" | "zoned_civil" | "fixed_instant";
  start_date?: string | null;
  end_date_exclusive?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};
export type AgendaConflictSnapshot = {
  protectedTime: readonly { id: string; updated_at: string }[];
  calendarEvents: readonly { id: string; updated_at: string }[];
  taskSchedules: readonly { id: string; updated_at: string }[];
};
export type ProtectedTimeAssessment = {
  decisions: readonly Record<string, unknown>[];
  snapshot: AgendaConflictSnapshot;
  conflicts: readonly Record<string, unknown>[];
  calendarTimeZone: string;
};
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}
function normalizeInstant(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new RangeError(label + " must be a valid instant.");
  return new Date(Date.parse(value)).toISOString();
}
function eventWindow(event: Record<string, unknown>, timeZone: string) {
  if (event.temporal_kind === "all_day") {
    const resolved = resolveLocalDateTimeRange({
      timeZone,
      start: { localDateTime: String(event.start_date) + "T00:00", disambiguation: "earlier", gapStrategy: "next-valid" },
      end: { localDateTime: String(event.end_date_exclusive) + "T00:00", disambiguation: "earlier", gapStrategy: "next-valid" },
    });
    return { startsAt: normalizeInstant(resolved.startsAt, "all-day Event start"), endsAt: normalizeInstant(resolved.endsAt, "all-day Event end") };
  }
  if (event.temporal_kind !== "zoned_civil" && event.temporal_kind !== "fixed_instant") throw new RangeError("An existing Event has an unsupported temporal kind.");
  const startsAt = normalizeInstant(event.starts_at, "Event starts_at");
  const endsAt = normalizeInstant(event.ends_at, "Event ends_at");
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new RangeError("An existing Event has an invalid time range.");
  return { startsAt, endsAt };
}
function overlapConflict({
  sourceType, id, updatedAt, label, startsAt, endsAt, candidate, timeZone,
}: {
  sourceType: "calendar_event" | "task_schedule";
  id: string; updatedAt: string; label: string; startsAt: string; endsAt: string;
  candidate: { startsAt: string; endsAt: string }; timeZone: string;
}) {
  if (!overlap(Date.parse(candidate.startsAt), Date.parse(candidate.endsAt), Date.parse(startsAt), Date.parse(endsAt))) return null;
  return Object.freeze({
    conflictKey: id + ":" + startsAt, blockId: id, blockUpdatedAt: updatedAt,
    label, category: sourceType === "calendar_event" ? "Evento" : "Reserva de tarea",
    protectionMode: "schedule", patternKind: sourceType, occurrenceDate: null,
    occurrenceStartsAt: startsAt, occurrenceEndsAt: endsAt,
    overlapStartsAt: new Date(Math.max(Date.parse(candidate.startsAt), Date.parse(startsAt))).toISOString(),
    overlapEndsAt: new Date(Math.min(Date.parse(candidate.endsAt), Date.parse(endsAt))).toISOString(),
    timeZone, requiredDecision: "keep_overlap", sourceType,
  });
}

/** Compare the candidate with Protected Time, confirmed Events and confirmed TaskSchedules. */
export async function assessOwnerProtectedTimeConflicts({
  supabaseAdmin, ownerProfileId, event, suppliedDecisions, now,
  excludeEventId = null, excludeTaskScheduleId = null,
}: {
  supabaseAdmin: AdminClient; ownerProfileId: string; event: EventRecord;
  suppliedDecisions?: unknown; now: string;
  excludeEventId?: string | null; excludeTaskScheduleId?: string | null;
}): Promise<{ ok: true; assessment: ProtectedTimeAssessment } | {
  ok: false; code: "PROTECTED_TIME_CONFLICTS" | "PROTECTED_TIME_CONFLICTS_CHANGED";
  conflicts: readonly Record<string, unknown>[]; snapshot: AgendaConflictSnapshot;
}> {
  const preference = await supabaseAdmin.from("user_preference").select("time_zone")
    .eq("user_id", ownerProfileId).maybeSingle();
  if (preference.error) throw new Error("AGENDA_TIME_ZONE_LOOKUP_FAILED");
  const calendarTimeZone = typeof preference.data?.time_zone === "string" && preference.data.time_zone.trim()
    ? preference.data.time_zone : DEFAULT_AGENDA_TIME_ZONE;

  const protectedResult = await supabaseAdmin.from("protected_time_block")
    .select("id,updated_at,label,category,protection_mode,pattern_kind,time_zone,starts_at,ends_at,start_date,end_date_exclusive,weekdays,start_time_local,end_time_local,ends_next_day,archived_at,deleted_at")
    .eq("owner_user_id", ownerProfileId).is("archived_at", null).is("deleted_at", null)
    .order("id", { ascending: true }).limit(MAX_ACTIVE_PROTECTED_TIME_BLOCKS + 1);
  if (protectedResult.error) throw new Error("PROTECTED_TIME_CONFLICT_LOOKUP_FAILED");
  const protectedBlocks = Array.isArray(protectedResult.data) ? protectedResult.data : [];
  if (protectedBlocks.length > MAX_ACTIVE_PROTECTED_TIME_BLOCKS) throw new RangeError("More than 500 active Protected Time blocks; conflict analysis cannot safely truncate.");

  const eventResult = await supabaseAdmin.from("calendar_event")
    .select("id,updated_at,title,event_status,temporal_kind,start_date,end_date_exclusive,starts_at,ends_at,time_zone,archived_at,deleted_at")
    .eq("owner_user_id", ownerProfileId).eq("event_status", "confirmed")
    .is("archived_at", null).is("deleted_at", null).order("id", { ascending: true })
    .limit(MAX_CONFIRMED_CALENDAR_EVENTS + 1);
  if (eventResult.error) throw new Error("AGENDA_EVENT_CONFLICT_LOOKUP_FAILED");
  const confirmedEvents = Array.isArray(eventResult.data) ? eventResult.data : [];
  if (confirmedEvents.length > MAX_CONFIRMED_CALENDAR_EVENTS) throw new RangeError("More than 500 confirmed Events; conflict analysis cannot safely truncate.");

  const scheduleResult = await supabaseAdmin.from("task_schedule")
    .select("id,task_id,updated_at,starts_at,ends_at,time_zone,schedule_status,task:task!task_schedule_task_owner_fkey(action)")
    .eq("owner_user_id", ownerProfileId).eq("schedule_status", "confirmed")
    .order("id", { ascending: true }).limit(MAX_CONFIRMED_TASK_SCHEDULES + 1);
  if (scheduleResult.error) throw new Error("TASK_SCHEDULE_CONFLICT_LOOKUP_FAILED");
  const confirmedSchedules = Array.isArray(scheduleResult.data) ? scheduleResult.data : [];
  if (confirmedSchedules.length > MAX_CONFIRMED_TASK_SCHEDULES) throw new RangeError("More than 500 confirmed TaskSchedules; conflict analysis cannot safely truncate.");

  const analyzed = findProtectedTimeConflicts({ event, protectedBlocks, calendarTimeZone, resolveRange: resolveLocalDateTimeRange });
  const candidate = analyzed.candidate;
  const conflicts: Record<string, unknown>[] = [...analyzed.conflicts];
  for (const row of confirmedEvents) {
    if (excludeEventId && row.id === excludeEventId) continue;
    const range = eventWindow(row, calendarTimeZone);
    const conflict = overlapConflict({
      sourceType: "calendar_event", id: row.id, updatedAt: row.updated_at, label: row.title,
      startsAt: range.startsAt, endsAt: range.endsAt, candidate, timeZone: row.time_zone || calendarTimeZone,
    });
    if (conflict) conflicts.push(conflict);
  }
  for (const row of confirmedSchedules) {
    if (excludeTaskScheduleId && row.id === excludeTaskScheduleId) continue;
    const startsAt = normalizeInstant(row.starts_at, "TaskSchedule starts_at");
    const endsAt = normalizeInstant(row.ends_at, "TaskSchedule ends_at");
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new RangeError("An existing TaskSchedule has an invalid time range.");
    const task = Array.isArray(row.task) ? row.task[0] : row.task;
    const conflict = overlapConflict({
      sourceType: "task_schedule", id: row.id, updatedAt: row.updated_at,
      label: typeof task?.action === "string" ? task.action : "Tarea reservada",
      startsAt, endsAt, candidate, timeZone: row.time_zone || calendarTimeZone,
    });
    if (conflict) conflicts.push(conflict);
  }
  conflicts.sort((a, b) => String(a.occurrenceStartsAt).localeCompare(String(b.occurrenceStartsAt))
    || String(a.blockId).localeCompare(String(b.blockId)));
  if (suppliedDecisions !== undefined && !Array.isArray(suppliedDecisions)) throw new RangeError("AGENDA_CONFLICT_DECISIONS_MUST_BE_AN_ARRAY");
  const normalized = normalizeProtectedTimeDecisions(conflicts, suppliedDecisions === undefined ? [] : suppliedDecisions, now);
  const snapshot: AgendaConflictSnapshot = Object.freeze({
    protectedTime: Object.freeze(protectedBlocks.map((x) => Object.freeze({ id: x.id, updated_at: x.updated_at })).sort((a,b) => a.id.localeCompare(b.id))),
    calendarEvents: Object.freeze(confirmedEvents.filter((x) => x.id !== excludeEventId).map((x) => Object.freeze({ id: x.id, updated_at: x.updated_at })).sort((a,b) => a.id.localeCompare(b.id))),
    taskSchedules: Object.freeze(confirmedSchedules.filter((x) => x.id !== excludeTaskScheduleId).map((x) => Object.freeze({ id: x.id, updated_at: x.updated_at })).sort((a,b) => a.id.localeCompare(b.id))),
  });
  if (!normalized.ok) return { ok: false, code: conflicts.length ? "PROTECTED_TIME_CONFLICTS" : "PROTECTED_TIME_CONFLICTS_CHANGED", conflicts, snapshot };
  return { ok: true, assessment: { decisions: normalized.decisions, snapshot, conflicts: Object.freeze(conflicts), calendarTimeZone } };
}
