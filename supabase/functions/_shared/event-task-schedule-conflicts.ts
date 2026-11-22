import { findProtectedTimeConflicts } from "../../../src/features/agenda/domain/protected-time-conflicts.js";
import { resolveLocalDateTimeRange } from "../agenda-time-resolve/resolver.ts";

const DEFAULT_AGENDA_TIME_ZONE = "America/Havana";
const MAX_ACTIVE_TASK_SCHEDULES = 500;
const TASK_SCHEDULE_EVENT_DECISION_VERSION = "event-task-schedule-decision-v1";

type AdminClient = { from(table: string): any };
type EventRecord = {
  temporal_kind: "all_day" | "zoned_civil" | "fixed_instant";
  start_date?: string | null;
  end_date_exclusive?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};
type Snapshot = readonly { id: string; updated_at: string }[];

function instant(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new RangeError(label + " must be a valid timestamp.");
  }
  return new Date(Date.parse(value)).toISOString();
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

function normalizeTaskScheduleEventDecisions(
  conflicts: readonly Record<string, unknown>[],
  supplied: unknown,
  now: string,
): { ok: true; decisions: readonly Record<string, unknown>[] } | {
  ok: false;
  code: "TASK_SCHEDULE_CONFLICTS" | "TASK_SCHEDULE_CONFLICTS_CHANGED";
} {
  if (!Array.isArray(supplied) || supplied.length > MAX_ACTIVE_TASK_SCHEDULES) {
    throw new RangeError("TASK_SCHEDULE_DECISIONS_MUST_BE_AN_ARRAY");
  }
  const byId = new Map<string, { updatedAt: string; decision: string }>();
  for (const value of supplied) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RangeError("Each TaskSchedule decision must be an object.");
    }
    const item = value as Record<string, unknown>;
    const allowed = ["taskScheduleId", "taskScheduleUpdatedAt", "decision"];
    if (Object.keys(item).length !== 3 || Object.keys(item).some((key) => !allowed.includes(key))
      || typeof item.taskScheduleId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.taskScheduleId)
      || typeof item.taskScheduleUpdatedAt !== "string"
      || !Number.isFinite(Date.parse(item.taskScheduleUpdatedAt))
      || item.decision !== "keep_overlap") {
      throw new RangeError("TaskSchedule decision must bind UUIDv7, updated_at and keep_overlap.");
    }
    const id = item.taskScheduleId.toLowerCase();
    if (byId.has(id)) throw new RangeError("TaskSchedule decisions cannot contain duplicate IDs.");
    byId.set(id, { updatedAt: item.taskScheduleUpdatedAt, decision: "keep_overlap" });
  }

  if (byId.size === 0 && conflicts.length > 0) {
    return { ok: false, code: "TASK_SCHEDULE_CONFLICTS" };
  }
  if (byId.size !== conflicts.length) {
    return { ok: false, code: "TASK_SCHEDULE_CONFLICTS" };
  }

  const timestamp = instant(now, "now");
  const decisions: Record<string, unknown>[] = [];
  for (const conflict of conflicts) {
    const id = String(conflict.taskScheduleId);
    const suppliedDecision = byId.get(id);
    if (!suppliedDecision
      || suppliedDecision.updatedAt !== conflict.taskScheduleUpdatedAt
      || suppliedDecision.decision !== "keep_overlap") {
      return { ok: false, code: "TASK_SCHEDULE_CONFLICTS_CHANGED" };
    }
    decisions.push(Object.freeze({
      policyVersion: TASK_SCHEDULE_EVENT_DECISION_VERSION,
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
 * Reads the complete active TaskSchedule set for the authenticated Event owner,
 * identifies interval overlaps and validates explicit, version-bound consent.
 * The returned snapshot must be rechecked by the Event RPC while holding the
 * same owner advisory transaction lock used by TaskSchedule and Protected Time.
 */
export async function assessOwnerEventTaskScheduleConflicts({
  supabaseAdmin,
  ownerProfileId,
  event,
  suppliedDecisions,
  now,
}: {
  supabaseAdmin: AdminClient;
  ownerProfileId: string;
  event: EventRecord;
  suppliedDecisions?: unknown;
  now: string;
}): Promise<{ ok: true; assessment: {
  decisions: readonly Record<string, unknown>[];
  conflicts: readonly Record<string, unknown>[];
  snapshot: Snapshot;
  candidate: { startsAt: string; endsAt: string };
} } | {
  ok: false;
  code: "TASK_SCHEDULE_CONFLICTS" | "TASK_SCHEDULE_CONFLICTS_CHANGED";
  conflicts: readonly Record<string, unknown>[];
  snapshot: Snapshot;
}> {
  let calendarTimeZone = DEFAULT_AGENDA_TIME_ZONE;
  if (event.temporal_kind === "all_day") {
    const preference = await supabaseAdmin
      .from("user_preference")
      .select("time_zone")
      .eq("user_id", ownerProfileId)
      .maybeSingle();
    if (preference.error) throw new Error("AGENDA_TIME_ZONE_LOOKUP_FAILED");
    if (typeof preference.data?.time_zone === "string" && preference.data.time_zone.trim()) {
      calendarTimeZone = preference.data.time_zone;
    }
  }

  const candidate = findProtectedTimeConflicts({
    event,
    protectedBlocks: [],
    calendarTimeZone,
    resolveRange: resolveLocalDateTimeRange,
  }).candidate;

  const result = await supabaseAdmin
    .from("task_schedule")
    .select("id,updated_at,starts_at,ends_at,time_zone,schedule_status")
    .eq("owner_user_id", ownerProfileId)
    .in("schedule_status", ["proposed", "confirmed"])
    .order("id", { ascending: true })
    .limit(MAX_ACTIVE_TASK_SCHEDULES + 1);
  if (result.error) throw new Error("TASK_SCHEDULE_CONFLICT_LOOKUP_FAILED");
  const schedules = Array.isArray(result.data) ? result.data : [];
  if (schedules.length > MAX_ACTIVE_TASK_SCHEDULES) {
    throw new RangeError("The owner has more than 500 active TaskSchedules; conflict analysis cannot safely truncate the set.");
  }

  const snapshot = Object.freeze(schedules.map((schedule: Record<string, unknown>) => {
    if (typeof schedule.id !== "string" || typeof schedule.updated_at !== "string"
      || !Number.isFinite(Date.parse(schedule.updated_at))) {
      throw new RangeError("An active TaskSchedule has an invalid snapshot version.");
    }
    return Object.freeze({ id: schedule.id, updated_at: schedule.updated_at });
  }));
  const conflicts: Record<string, unknown>[] = [];
  for (const schedule of schedules) {
    const startsAt = instant(schedule.starts_at, "TaskSchedule starts_at");
    const endsAt = instant(schedule.ends_at, "TaskSchedule ends_at");
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new RangeError("An active TaskSchedule has an invalid interval.");
    }
    if (!overlaps(candidate.startsAt, candidate.endsAt, startsAt, endsAt)) continue;
    conflicts.push(Object.freeze({
      taskScheduleId: schedule.id,
      taskScheduleUpdatedAt: schedule.updated_at,
      startsAt,
      endsAt,
      timeZone: typeof schedule.time_zone === "string" ? schedule.time_zone : null,
      overlapStartsAt: new Date(Math.max(Date.parse(candidate.startsAt), Date.parse(startsAt))).toISOString(),
      overlapEndsAt: new Date(Math.min(Date.parse(candidate.endsAt), Date.parse(endsAt))).toISOString(),
      requiredDecision: "keep_overlap",
    }));
  }

  const normalized = normalizeTaskScheduleEventDecisions(conflicts, suppliedDecisions ?? [], now);
  if (!normalized.ok) {
    return { ok: false, code: normalized.code, conflicts: Object.freeze(conflicts), snapshot };
  }
  return {
    ok: true,
    assessment: {
      decisions: normalized.decisions,
      conflicts: Object.freeze(conflicts),
      snapshot,
      candidate,
    },
  };
}
