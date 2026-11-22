import {
  findProtectedTimeConflicts,
  normalizeProtectedTimeDecisions,
} from "../../../src/features/agenda/domain/protected-time-conflicts.js";
import { resolveLocalDateTimeRange } from "../agenda-time-resolve/resolver.ts";

export const DEFAULT_TASK_SCHEDULE_TIME_ZONE = "America/Havana";
export const MAX_TASK_SCHEDULE_CONFLICT_ROWS = 500;
const EVENT_DECISION_VERSION = "task-schedule-event-decision-v1";
const TASK_SCHEDULE_OVERLAP_DECISION_VERSION = "task-schedule-overlap-decision-v1";

type AdminClient = { from(table: string): any };

type EventRecord = {
  id: string;
  updated_at: string;
  title: string;
  event_status: string;
  temporal_kind: "all_day" | "zoned_civil" | "fixed_instant";
  start_date?: string | null;
  end_date_exclusive?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};

type DecisionInput = {
  eventId: string;
  eventUpdatedAt: string;
  decision: "keep_overlap";
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(message);
}

function instant(value: unknown, label: string): string {
  assert(typeof value === "string" && Number.isFinite(Date.parse(value)),
    label + " must be a valid timestamp.");
  return new Date(Date.parse(value)).toISOString();
}

function overlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

function normalizeEventDecisions(
  conflicts: readonly Record<string, unknown>[],
  supplied: unknown,
  now: string,
): { ok: true; decisions: readonly Record<string, unknown>[] } | {
  ok: false;
  reason: "TASK_SCHEDULE_EVENT_DECISIONS_REQUIRED";
} {
  assert(Array.isArray(supplied), "eventDecisions must be an array.");
  assert(supplied.length <= MAX_TASK_SCHEDULE_CONFLICT_ROWS,
    "eventDecisions cannot contain more than 500 entries.");
  const byId = new Map<string, DecisionInput>();
  for (const value of supplied) {
    assert(value && typeof value === "object" && !Array.isArray(value),
      "Each Event conflict decision must be an object.");
    const item = value as Record<string, unknown>;
    const keys = ["eventId", "eventUpdatedAt", "decision"];
    assert(Object.keys(item).length === keys.length && Object.keys(item).every((key) => keys.includes(key)),
      "Event conflict decision contains unsupported or missing fields.");
    assert(typeof item.eventId === "string" && typeof item.eventUpdatedAt === "string"
      && item.decision === "keep_overlap",
    "Event conflict decision must contain an Event id/version and explicit keep_overlap choice.");
    const id = item.eventId.toLowerCase();
    assert(!byId.has(id), "An Event can receive only one TaskSchedule conflict decision.");
    byId.set(id, item as unknown as DecisionInput);
  }

  if (byId.size !== conflicts.length) {
    return { ok: false, reason: "TASK_SCHEDULE_EVENT_DECISIONS_REQUIRED" };
  }
  const timestamp = instant(now, "now");
  const decisions: Record<string, unknown>[] = [];
  for (const conflict of conflicts) {
    const id = String(conflict.eventId);
    const decision = byId.get(id);
    if (!decision || decision.eventUpdatedAt !== conflict.eventUpdatedAt
      || decision.decision !== "keep_overlap") {
      return { ok: false, reason: "TASK_SCHEDULE_EVENT_DECISIONS_REQUIRED" };
    }
    decisions.push(Object.freeze({
      policyVersion: EVENT_DECISION_VERSION,
      eventId: id,
      eventUpdatedAt: conflict.eventUpdatedAt,
      title: conflict.title,
      startsAt: conflict.startsAt,
      endsAt: conflict.endsAt,
      overlapStartsAt: conflict.overlapStartsAt,
      overlapEndsAt: conflict.overlapEndsAt,
      decision: "keep_overlap",
      consentedAt: timestamp,
    }));
  }
  return { ok: true, decisions: Object.freeze(decisions) };
}

function normalizeTaskScheduleDecisions(
  conflicts: readonly Record<string, unknown>[],
  supplied: unknown,
  now: string,
): { ok: true; decisions: readonly Record<string, unknown>[] } | {
  ok: false;
  reason: "TASK_SCHEDULE_OVERLAP_DECISIONS_REQUIRED";
} {
  assert(Array.isArray(supplied), "taskScheduleDecisions must be an array.");
  assert(supplied.length <= MAX_TASK_SCHEDULE_CONFLICT_ROWS,
    "taskScheduleDecisions cannot contain more than 500 entries.");
  const byId = new Map<string, {
    taskScheduleId: string;
    taskScheduleUpdatedAt: string;
    decision: "keep_overlap";
  }>();
  for (const value of supplied) {
    assert(value && typeof value === "object" && !Array.isArray(value),
      "Each TaskSchedule conflict decision must be an object.");
    const item = value as Record<string, unknown>;
    const keys = ["taskScheduleId", "taskScheduleUpdatedAt", "decision"];
    assert(Object.keys(item).length === keys.length && Object.keys(item).every((key) => keys.includes(key)),
      "TaskSchedule conflict decision contains unsupported or missing fields.");
    assert(typeof item.taskScheduleId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.taskScheduleId)
      && typeof item.taskScheduleUpdatedAt === "string"
      && Number.isFinite(Date.parse(item.taskScheduleUpdatedAt))
      && item.decision === "keep_overlap",
    "TaskSchedule conflict decision must be a UUIDv7, an updated_at version and keep_overlap.");
    const id = item.taskScheduleId.toLowerCase();
    assert(!byId.has(id), "A TaskSchedule can receive only one overlap decision.");
    byId.set(id, item as unknown as {
      taskScheduleId: string;
      taskScheduleUpdatedAt: string;
      decision: "keep_overlap";
    });
  }

  if (byId.size !== conflicts.length) {
    return { ok: false, reason: "TASK_SCHEDULE_OVERLAP_DECISIONS_REQUIRED" };
  }
  const timestamp = instant(now, "now");
  const decisions: Record<string, unknown>[] = [];
  for (const conflict of conflicts) {
    const id = String(conflict.taskScheduleId);
    const decision = byId.get(id);
    if (!decision || decision.taskScheduleUpdatedAt !== conflict.taskScheduleUpdatedAt
      || decision.decision !== "keep_overlap") {
      return { ok: false, reason: "TASK_SCHEDULE_OVERLAP_DECISIONS_REQUIRED" };
    }
    decisions.push(Object.freeze({
      policyVersion: TASK_SCHEDULE_OVERLAP_DECISION_VERSION,
      taskScheduleId: id,
      taskScheduleUpdatedAt: conflict.taskScheduleUpdatedAt,
      startsAt: conflict.startsAt,
      endsAt: conflict.endsAt,
      overlapStartsAt: conflict.overlapStartsAt,
      overlapEndsAt: conflict.overlapEndsAt,
      decision: "keep_overlap",
      consentedAt: timestamp,
    }));
  }
  return { ok: true, decisions: Object.freeze(decisions) };
}

/**
 * Read the full owner-scoped conflict set and calculate exact overlaps for a
 * TaskSchedule. The Edge handler passes the complete snapshot to the atomic
 * writer RPC, which checks it under the shared owner advisory lock.
 */
export async function assessOwnerTaskScheduleConflicts({
  supabaseAdmin,
  ownerProfileId,
  startsAt,
  endsAt,
  taskScheduleId = null,
  suppliedEventDecisions = [],
  suppliedProtectedTimeDecisions = [],
  suppliedTaskScheduleDecisions = [],
  now,
}: {
  supabaseAdmin: AdminClient;
  ownerProfileId: string;
  startsAt: string;
  endsAt: string;
  taskScheduleId?: string | null;
  suppliedEventDecisions?: unknown;
  suppliedProtectedTimeDecisions?: unknown;
  suppliedTaskScheduleDecisions?: unknown;
  now: string;
}): Promise<{ ok: true; assessment: {
  decisions: readonly Record<string, unknown>[];
  snapshot: readonly Record<string, unknown>[];
  eventConflicts: readonly Record<string, unknown>[];
  protectedTimeConflicts: readonly Record<string, unknown>[];
  taskScheduleConflicts: readonly Record<string, unknown>[];
  calendarTimeZone: string;
} } | {
  ok: false;
  code: string;
  eventConflicts: readonly Record<string, unknown>[];
  protectedTimeConflicts: readonly Record<string, unknown>[];
  taskScheduleConflicts: readonly Record<string, unknown>[];
}> {
  const candidateStart = instant(startsAt, "TaskSchedule startsAt");
  const candidateEnd = instant(endsAt, "TaskSchedule endsAt");
  assert(Date.parse(candidateEnd) > Date.parse(candidateStart),
    "TaskSchedule end must be after its start.");

  const preference = await supabaseAdmin
    .from("user_preference")
    .select("time_zone")
    .eq("user_id", ownerProfileId)
    .maybeSingle();
  if (preference.error) throw new Error("TASK_SCHEDULE_TIME_ZONE_LOOKUP_FAILED");
  const calendarTimeZone = typeof preference.data?.time_zone === "string"
    && preference.data.time_zone.trim()
    ? preference.data.time_zone
    : DEFAULT_TASK_SCHEDULE_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: calendarTimeZone }).format(new Date());
  } catch {
    throw new RangeError("The owner's saved calendar timezone is invalid.");
  }

  const eventResult = await supabaseAdmin
    .from("calendar_event")
    .select("id,updated_at,title,event_status,temporal_kind,start_date,end_date_exclusive,starts_at,ends_at,archived_at,deleted_at")
    .eq("owner_user_id", ownerProfileId)
    .is("archived_at", null)
    .is("deleted_at", null)
    .in("event_status", ["preparing", "proposed", "confirmed"])
    .order("id", { ascending: true })
    .limit(MAX_TASK_SCHEDULE_CONFLICT_ROWS + 1);
  if (eventResult.error) throw new Error("TASK_SCHEDULE_EVENT_LOOKUP_FAILED");
  const events = Array.isArray(eventResult.data) ? eventResult.data as EventRecord[] : [];
  if (events.length > MAX_TASK_SCHEDULE_CONFLICT_ROWS) {
    throw new RangeError("The owner has more than 500 active Events; conflict analysis cannot safely truncate the set.");
  }

  const protectedResult = await supabaseAdmin
    .from("protected_time_block")
    .select("id,updated_at,label,category,protection_mode,pattern_kind,time_zone,starts_at,ends_at,start_date,end_date_exclusive,weekdays,start_time_local,end_time_local,ends_next_day,archived_at,deleted_at")
    .eq("owner_user_id", ownerProfileId)
    .is("archived_at", null)
    .is("deleted_at", null)
    .order("id", { ascending: true })
    .limit(MAX_TASK_SCHEDULE_CONFLICT_ROWS + 1);
  if (protectedResult.error) throw new Error("TASK_SCHEDULE_PROTECTED_TIME_LOOKUP_FAILED");
  const protectedBlocks = Array.isArray(protectedResult.data) ? protectedResult.data : [];
  if (protectedBlocks.length > MAX_TASK_SCHEDULE_CONFLICT_ROWS) {
    throw new RangeError("The owner has more than 500 active Protected Time blocks; conflict analysis cannot safely truncate the set.");
  }

  const scheduleResult = await supabaseAdmin
    .from("task_schedule")
    .select("id,updated_at,starts_at,ends_at,time_zone,schedule_status")
    .eq("owner_user_id", ownerProfileId)
    .in("schedule_status", ["proposed", "confirmed"])
    .order("id", { ascending: true })
    .limit(MAX_TASK_SCHEDULE_CONFLICT_ROWS + 1);
  if (scheduleResult.error) throw new Error("TASK_SCHEDULE_EXISTING_LOOKUP_FAILED");
  const schedules = Array.isArray(scheduleResult.data) ? scheduleResult.data : [];
  if (schedules.length > MAX_TASK_SCHEDULE_CONFLICT_ROWS) {
    throw new RangeError("The owner has more than 500 active TaskSchedules; conflict analysis cannot safely truncate the set.");
  }

  const taskScheduleConflicts: Record<string, unknown>[] = [];
  for (const schedule of schedules) {
    if (schedule.id === taskScheduleId) continue;
    const scheduleStart = instant(schedule.starts_at, "Existing TaskSchedule starts_at");
    const scheduleEnd = instant(schedule.ends_at, "Existing TaskSchedule ends_at");
    if (Date.parse(scheduleEnd) <= Date.parse(scheduleStart)) {
      throw new RangeError("An existing TaskSchedule has an invalid temporal interval.");
    }
    if (!overlap(candidateStart, candidateEnd, scheduleStart, scheduleEnd)) continue;
    taskScheduleConflicts.push(Object.freeze({
      taskScheduleId: schedule.id,
      taskScheduleUpdatedAt: schedule.updated_at,
      startsAt: scheduleStart,
      endsAt: scheduleEnd,
      timeZone: typeof schedule.time_zone === "string" ? schedule.time_zone : calendarTimeZone,
      overlapStartsAt: new Date(Math.max(Date.parse(candidateStart), Date.parse(scheduleStart))).toISOString(),
      overlapEndsAt: new Date(Math.min(Date.parse(candidateEnd), Date.parse(scheduleEnd))).toISOString(),
      requiredDecision: "keep_overlap",
    }));
  }

  const eventConflicts: Record<string, unknown>[] = [];
  for (const event of events) {
    let eventStart: string;
    let eventEnd: string;
    if (event.temporal_kind === "all_day") {
      assert(typeof event.start_date === "string" && typeof event.end_date_exclusive === "string",
        "An all-day Event has an incomplete date range.");
      const resolved = resolveLocalDateTimeRange({
        timeZone: calendarTimeZone,
        start: { localDateTime: event.start_date + "T00:00", disambiguation: "earlier", gapStrategy: "next-valid" },
        end: { localDateTime: event.end_date_exclusive + "T00:00", disambiguation: "earlier", gapStrategy: "next-valid" },
      });
      eventStart = instant(resolved.startsAt, "all-day Event start");
      eventEnd = instant(resolved.endsAt, "all-day Event end");
    } else {
      eventStart = instant(event.starts_at, "Event starts_at");
      eventEnd = instant(event.ends_at, "Event ends_at");
    }
    if (Date.parse(eventEnd) <= Date.parse(eventStart)) {
      throw new RangeError("An Event has an invalid temporal interval.");
    }
    if (!overlap(candidateStart, candidateEnd, eventStart, eventEnd)) continue;
    const overlapStartsAt = new Date(Math.max(Date.parse(candidateStart), Date.parse(eventStart))).toISOString();
    const overlapEndsAt = new Date(Math.min(Date.parse(candidateEnd), Date.parse(eventEnd))).toISOString();
    eventConflicts.push(Object.freeze({
      eventId: event.id,
      eventUpdatedAt: event.updated_at,
      title: event.title,
      eventStatus: event.event_status,
      startsAt: eventStart,
      endsAt: eventEnd,
      overlapStartsAt,
      overlapEndsAt,
      requiredDecision: "keep_overlap",
    }));
  }

  const protectedAssessment = findProtectedTimeConflicts({
    event: {
      temporal_kind: "fixed_instant",
      starts_at: candidateStart,
      ends_at: candidateEnd,
    },
    protectedBlocks,
    calendarTimeZone,
    resolveRange: resolveLocalDateTimeRange,
  });
  if (!Array.isArray(suppliedProtectedTimeDecisions)) {
    throw new RangeError("PROTECTED_TIME_DECISIONS_MUST_BE_AN_ARRAY");
  }
  const protectedDecisionResult = normalizeProtectedTimeDecisions(
    protectedAssessment.conflicts,
    suppliedProtectedTimeDecisions,
    now,
  );
  const eventDecisionResult = normalizeEventDecisions(eventConflicts, suppliedEventDecisions, now);
  const taskScheduleDecisionResult = normalizeTaskScheduleDecisions(
    taskScheduleConflicts,
    suppliedTaskScheduleDecisions,
    now,
  );

  if (!eventDecisionResult.ok || !protectedDecisionResult.ok || !taskScheduleDecisionResult.ok) {
    return {
      ok: false,
      code: eventConflicts.length > 0 && !eventDecisionResult.ok
        ? "TASK_SCHEDULE_CONFLICTS"
        : !protectedDecisionResult.ok
          ? "PROTECTED_TIME_CONFLICTS"
          : !taskScheduleDecisionResult.ok && taskScheduleConflicts.length === 0
            && Array.isArray(suppliedTaskScheduleDecisions) && suppliedTaskScheduleDecisions.length > 0
            ? "TASK_SCHEDULE_CONFLICTS_CHANGED"
            : "TASK_SCHEDULE_OVERLAPS",
      eventConflicts,
      protectedTimeConflicts: protectedAssessment.conflicts,
      taskScheduleConflicts,
    };
  }

  const snapshot = [
    ...events.map((item) => ({ resource_type: "calendar_event", id: item.id, updated_at: item.updated_at })),
    ...protectedBlocks.map((item: Record<string, unknown>) => ({
      resource_type: "protected_time_block", id: item.id, updated_at: item.updated_at,
    })),
    ...schedules
      .filter((item: Record<string, unknown>) => item.id !== taskScheduleId)
      .map((item: Record<string, unknown>) => ({
        resource_type: "task_schedule", id: item.id, updated_at: item.updated_at,
      })),
  ].sort((a, b) => String(a.resource_type).localeCompare(String(b.resource_type))
    || String(a.id).localeCompare(String(b.id)));

  return {
    ok: true,
    assessment: {
      decisions: Object.freeze([
        ...eventDecisionResult.decisions,
        ...protectedDecisionResult.decisions,
        ...taskScheduleDecisionResult.decisions,
      ]),
      snapshot: Object.freeze(snapshot),
      eventConflicts: Object.freeze(eventConflicts),
      protectedTimeConflicts: protectedAssessment.conflicts,
      taskScheduleConflicts: Object.freeze(taskScheduleConflicts),
      calendarTimeZone,
    },
  };
}
