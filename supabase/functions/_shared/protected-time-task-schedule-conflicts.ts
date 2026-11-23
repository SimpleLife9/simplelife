import { findProtectedTimeConflicts } from "../../../src/features/agenda/domain/protected-time-conflicts.js";
import { resolveLocalDateTimeRange } from "../agenda-time-resolve/resolver.ts";

export const MAX_PROTECTED_TIME_TASK_SCHEDULE_ROWS = 500;
export const PROTECTED_TIME_TASK_SCHEDULE_DECISION_VERSION = "protected-time-task-schedule-decision-v1";
const DEFAULT_CALENDAR_TIME_ZONE = "America/Havana";

type AdminClient = { from(table: string): any };
type DecisionInput = {
  taskScheduleId: string;
  taskScheduleUpdatedAt: string;
  occurrenceStartsAt: string;
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

function normalizeDecisions(
  conflicts: readonly Record<string, unknown>[],
  supplied: unknown,
  now: string,
): { ok: true; decisions: readonly Record<string, unknown>[] } | {
  ok: false;
  reason: "TASK_SCHEDULE_DECISIONS_REQUIRED" | "TASK_SCHEDULE_DECISIONS_CHANGED";
} {
  assert(Array.isArray(supplied), "taskScheduleDecisions must be an array.");
  assert(supplied.length <= MAX_PROTECTED_TIME_TASK_SCHEDULE_ROWS,
    "taskScheduleDecisions cannot contain more than 500 entries.");
  const byKey = new Map<string, DecisionInput>();
  for (const value of supplied) {
    assert(value && typeof value === "object" && !Array.isArray(value),
      "Each TaskSchedule decision must be an object.");
    const item = value as Record<string, unknown>;
    const keys = ["taskScheduleId", "taskScheduleUpdatedAt", "occurrenceStartsAt", "decision"];
    assert(Object.keys(item).length === keys.length && Object.keys(item).every((key) => keys.includes(key)),
      "TaskSchedule decision contains unsupported or missing fields.");
    assert(typeof item.taskScheduleId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.taskScheduleId)
      && typeof item.taskScheduleUpdatedAt === "string"
      && Number.isFinite(Date.parse(item.taskScheduleUpdatedAt))
      && typeof item.occurrenceStartsAt === "string"
      && item.decision === "keep_overlap",
    "TaskSchedule decision must bind a UUIDv7, updated_at, occurrence and keep_overlap.");
    const key = item.taskScheduleId.toLowerCase() + ":" + instant(item.occurrenceStartsAt, "occurrenceStartsAt");
    assert(!byKey.has(key), "A TaskSchedule occurrence cannot receive duplicate decisions.");
    byKey.set(key, item as unknown as DecisionInput);
  }

  if (byKey.size !== conflicts.length) {
    return {
      ok: false,
      reason: conflicts.length > 0 ? "TASK_SCHEDULE_DECISIONS_REQUIRED" : "TASK_SCHEDULE_DECISIONS_CHANGED",
    };
  }

  const consentedAt = instant(now, "now");
  const decisions: Record<string, unknown>[] = [];
  for (const conflict of conflicts) {
    const id = String(conflict.taskScheduleId);
    const key = id.toLowerCase() + ":" + String(conflict.occurrenceStartsAt);
    const suppliedDecision = byKey.get(key);
    if (!suppliedDecision
      || suppliedDecision.taskScheduleUpdatedAt !== conflict.taskScheduleUpdatedAt
      || suppliedDecision.decision !== "keep_overlap") {
      return { ok: false, reason: "TASK_SCHEDULE_DECISIONS_CHANGED" };
    }
    decisions.push(Object.freeze({
      policyVersion: PROTECTED_TIME_TASK_SCHEDULE_DECISION_VERSION,
      taskScheduleId: id,
      taskScheduleUpdatedAt: conflict.taskScheduleUpdatedAt,
      startsAt: conflict.startsAt,
      endsAt: conflict.endsAt,
      occurrenceDate: conflict.occurrenceDate,
      occurrenceStartsAt: conflict.occurrenceStartsAt,
      occurrenceEndsAt: conflict.occurrenceEndsAt,
      overlapStartsAt: conflict.overlapStartsAt,
      overlapEndsAt: conflict.overlapEndsAt,
      protectionMode: conflict.protectionMode,
      timeZone: conflict.timeZone,
      decision: "keep_overlap",
      consentedAt,
    }));
  }
  return { ok: true, decisions: Object.freeze(decisions) };
}

/**
 * Checks a proposed Protected Time block against every active owner TaskSchedule.
 * Weekly Protected Time is expanded for each bounded TaskSchedule through the
 * same pinned IANA resolver used by Agenda. The complete owner snapshot is sent
 * to the SQL writer and compared under the shared Event/TaskSchedule lock.
 */
export async function assessOwnerProtectedTimeTaskScheduleConflicts({
  supabaseAdmin,
  ownerProfileId,
  block,
  suppliedDecisions = [],
  now,
}: {
  supabaseAdmin: AdminClient;
  ownerProfileId: string;
  block: Record<string, unknown>;
  suppliedDecisions?: unknown;
  now: string;
}): Promise<{ ok: true; assessment: {
  decisions: readonly Record<string, unknown>[];
  snapshot: readonly { id: string; updated_at: string }[];
  conflicts: readonly Record<string, unknown>[];
} } | {
  ok: false;
  code: "TASK_SCHEDULE_CONFLICTS" | "TASK_SCHEDULE_CONFLICTS_CHANGED";
  conflicts: readonly Record<string, unknown>[];
  snapshot: readonly { id: string; updated_at: string }[];
}> {
  const result = await supabaseAdmin
    .from("task_schedule")
    .select("id,updated_at,starts_at,ends_at,time_zone,schedule_status")
    .eq("owner_user_id", ownerProfileId)
    .in("schedule_status", ["proposed", "confirmed"])
    .order("id", { ascending: true })
    .limit(MAX_PROTECTED_TIME_TASK_SCHEDULE_ROWS + 1);
  if (result.error) throw new Error("PROTECTED_TIME_TASK_SCHEDULE_LOOKUP_FAILED");
  const schedules = Array.isArray(result.data) ? result.data as Record<string, unknown>[] : [];
  if (schedules.length > MAX_PROTECTED_TIME_TASK_SCHEDULE_ROWS) {
    throw new RangeError("The owner has more than 500 active TaskSchedules; conflict analysis cannot safely truncate the set.");
  }

  const candidateBlock = {
    ...block,
    id: String(block.id ?? "019a0000-0000-7000-8000-000000000000"),
    updated_at: String(block.updated_at ?? now),
    label: String(block.label ?? "Tiempo protegido"),
    pattern_kind: String(block.pattern_kind ?? ""),
    archived_at: null,
    deleted_at: null,
  };
  const conflicts: Record<string, unknown>[] = [];
  for (const schedule of schedules) {
    const startsAt = instant(schedule.starts_at, "TaskSchedule starts_at");
    const endsAt = instant(schedule.ends_at, "TaskSchedule ends_at");
    assert(Date.parse(endsAt) > Date.parse(startsAt),
      "An existing TaskSchedule has an invalid temporal interval.");
    const timeZone = typeof schedule.time_zone === "string" && schedule.time_zone.trim()
      ? schedule.time_zone
      : DEFAULT_CALENDAR_TIME_ZONE;
    const analyzed = findProtectedTimeConflicts({
      event: { temporal_kind: "fixed_instant", starts_at: startsAt, ends_at: endsAt },
      protectedBlocks: [candidateBlock],
      calendarTimeZone: timeZone,
      resolveRange: resolveLocalDateTimeRange,
    });
    for (const conflict of analyzed.conflicts) {
      conflicts.push(Object.freeze({
        conflictKey: String(schedule.id) + ":" + String(conflict.occurrenceStartsAt),
        taskScheduleId: schedule.id,
        taskScheduleUpdatedAt: schedule.updated_at,
        startsAt,
        endsAt,
        overlapStartsAt: conflict.overlapStartsAt,
        overlapEndsAt: conflict.overlapEndsAt,
        occurrenceDate: conflict.occurrenceDate,
        occurrenceStartsAt: conflict.occurrenceStartsAt,
        occurrenceEndsAt: conflict.occurrenceEndsAt,
        protectionMode: conflict.protectionMode,
        protectedTimeLabel: candidateBlock.label,
        patternKind: candidateBlock.pattern_kind,
        timeZone: conflict.timeZone,
        requiredDecision: "keep_overlap",
      }));
      if (conflicts.length > MAX_PROTECTED_TIME_TASK_SCHEDULE_ROWS) {
        throw new RangeError("Protected Time produced more than 500 TaskSchedule overlaps.");
      }
    }
  }

  conflicts.sort((a, b) => String(a.occurrenceStartsAt).localeCompare(String(b.occurrenceStartsAt))
    || String(a.taskScheduleId).localeCompare(String(b.taskScheduleId)));
  const normalized = normalizeDecisions(conflicts, suppliedDecisions, now);
  const snapshot = Object.freeze(schedules.map((schedule) => Object.freeze({
    id: String(schedule.id),
    updated_at: String(schedule.updated_at),
  })).sort((a, b) => a.id.localeCompare(b.id)));

  if (!normalized.ok) {
    return {
      ok: false,
      code: normalized.reason === "TASK_SCHEDULE_DECISIONS_CHANGED"
        ? "TASK_SCHEDULE_CONFLICTS_CHANGED"
        : "TASK_SCHEDULE_CONFLICTS",
      conflicts: Object.freeze(conflicts),
      snapshot,
    };
  }
  return {
    ok: true,
    assessment: {
      decisions: normalized.decisions,
      snapshot,
      conflicts: Object.freeze(conflicts),
    },
  };
}
