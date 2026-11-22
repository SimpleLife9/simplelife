import moment from "moment-timezone";
import { assessProtectedTimeConflict } from "../../../src/features/agenda/domain/protected-time.js";
import { resolveLocalDateTimeRange } from "../agenda-time-resolve/resolver.ts";

export const MAX_PROTECTED_TIME_BLOCKS = 500;
export const MAX_CONFLICT_SCAN_DAYS = 370;

type ProtectedTimeRow = {
  id: string;
  label: string;
  category: string | null;
  protection_mode: "hard" | "flexible";
  pattern_kind: "one_off" | "weekly";
  time_zone: string;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date_exclusive: string | null;
  weekdays: number[] | null;
  start_time_local: string | null;
  end_time_local: string | null;
  ends_next_day: boolean | null;
  updated_at: string;
};

type EventRecord = {
  temporal_kind: "all_day" | "zoned_civil" | "fixed_instant";
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date_exclusive: string | null;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(message);
}

function addCalendarDate(value: string, days: number): string {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), "A valid YYYY-MM-DD date is required.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  const result = date.getUTCFullYear().toString().padStart(4, "0")
    + "-" + String(date.getUTCMonth() + 1).padStart(2, "0")
    + "-" + String(date.getUTCDate()).padStart(2, "0");
  assert(Number.isFinite(date.getTime()), "Calendar date arithmetic failed.");
  return result;
}

function weekdayIso(value: string): number {
  const day = new Date(value + "T12:00:00.000Z").getUTCDay();
  return day === 0 ? 7 : day;
}

function dateInZone(instant: string, timeZone: string): string {
  const parsed = Date.parse(instant);
  assert(Number.isFinite(parsed), "Event interval must contain valid UTC instants.");
  const zone = moment.tz.zone(timeZone);
  assert(zone, "Protected Time block has an unsupported IANA timezone: " + timeZone);
  return moment.utc(parsed).tz(timeZone).format("YYYY-MM-DD");
}

function timedCandidate(startsAt: string, endsAt: string) {
  return Object.freeze({ temporalKind: "timed" as const, startsAt, endsAt });
}

function resolveAllDayCandidate(event: EventRecord, viewerTimeZone: string) {
  assert(typeof event.start_date === "string" && typeof event.end_date_exclusive === "string",
    "All-day Event is missing its exclusive date range.");
  const resolution = resolveLocalDateTimeRange({
    timeZone: viewerTimeZone,
    start: {
      localDateTime: event.start_date + "T00:00:00.000",
      disambiguation: "earlier",
      gapStrategy: "next-valid",
    },
    end: {
      localDateTime: event.end_date_exclusive + "T00:00:00.000",
      disambiguation: "earlier",
      gapStrategy: "next-valid",
    },
  });
  return timedCandidate(resolution.startsAt, resolution.endsAt);
}

function resolveWeeklyOccurrence(block: ProtectedTimeRow, occurrenceDate: string) {
  assert(block.start_time_local && block.end_time_local && block.time_zone,
    "Weekly Protected Time rule is incomplete.");
  const endDate = block.ends_next_day
    ? addCalendarDate(occurrenceDate, 1)
    : occurrenceDate;
  const resolution = resolveLocalDateTimeRange({
    timeZone: block.time_zone,
    start: {
      localDateTime: occurrenceDate + "T" + block.start_time_local,
      disambiguation: "earlier",
      gapStrategy: "next-valid",
    },
    end: {
      localDateTime: endDate + "T" + block.end_time_local,
      disambiguation: "earlier",
      gapStrategy: "next-valid",
    },
  });
  return timedCandidate(resolution.startsAt, resolution.endsAt);
}

/**
 * Re-evaluates an Event interval against every active owner-scoped Protected
 * Time block using the pinned IANA resolver. Weekly rules remain civil-time
 * recurrences and are expanded only across the bounded candidate interval.
 */
export function assessEventProtectedTimeConflicts({
  event,
  protectedBlocks,
  viewerTimeZone,
}: {
  event: EventRecord;
  protectedBlocks: ProtectedTimeRow[];
  viewerTimeZone: string;
}) {
  assert(Array.isArray(protectedBlocks), "protectedBlocks must be an array.");
  assert(protectedBlocks.length <= MAX_PROTECTED_TIME_BLOCKS,
    "Too many active Protected Time blocks to evaluate safely.");

  const candidate = event.temporal_kind === "all_day"
    ? resolveAllDayCandidate(event, viewerTimeZone)
    : timedCandidate(String(event.starts_at || ""), String(event.ends_at || ""));

  const startDate = candidate.startsAt.slice(0, 10);
  const endDate = candidate.endsAt.slice(0, 10);
  if (endDate < startDate) throw new RangeError("Resolved Event interval dates are invalid.");

  const conflicts = new Map<string, Record<string, unknown>>();
  for (const block of protectedBlocks) {
    if (!block.id || !block.updated_at || !block.time_zone) {
      throw new RangeError("Active Protected Time row is missing its identity, version or timezone.");
    }
    if (block.pattern_kind === "one_off") {
      if (!block.starts_at || !block.ends_at) throw new RangeError("One-off Protected Time range is incomplete.");
      const assessment = assessProtectedTimeConflict({
        candidate,
        protectedBlock: {
          temporalKind: "timed",
          startsAt: block.starts_at,
          endsAt: block.ends_at,
          protectionMode: block.protection_mode,
        },
      });
      if (assessment.overlapping) {
        conflicts.set(block.id, {
          blockId: block.id,
          label: block.label,
          category: block.category,
          protectionMode: block.protection_mode,
          patternKind: block.pattern_kind,
          timeZone: block.time_zone,
          blockUpdatedAt: block.updated_at,
          occurrences: [{ startsAt: block.starts_at, endsAt: block.ends_at }],
        });
      }
      continue;
    }

    if (block.pattern_kind !== "weekly" || !block.start_date || !block.weekdays?.length
      || !block.start_time_local || !block.end_time_local
      || typeof block.ends_next_day !== "boolean") {
      throw new RangeError("Weekly Protected Time rule is incomplete.");
    }

    // Expand one local date before and after the candidate's local dates. This
    // safely includes overnight recurrences and UTC/local date-boundary shifts.
    const first = addCalendarDate(dateInZone(candidate.startsAt, block.time_zone), -1);
    const last = addCalendarDate(dateInZone(candidate.endsAt, block.time_zone), 1);
    const dayCount = Math.round((Date.parse(last + "T12:00:00Z") - Date.parse(first + "T12:00:00Z")) / 86_400_000);
    if (dayCount < 0 || dayCount > MAX_CONFLICT_SCAN_DAYS) {
      throw new RangeError("Event interval is too wide for a safe weekly Protected Time conflict scan.");
    }

    for (let offset = 0; offset <= dayCount; offset += 1) {
      const occurrenceDate = addCalendarDate(first, offset);
      if (occurrenceDate < block.start_date) continue;
      if (block.end_date_exclusive && occurrenceDate >= block.end_date_exclusive) continue;
      if (!block.weekdays.includes(weekdayIso(occurrenceDate))) continue;
      const occurrence = resolveWeeklyOccurrence(block, occurrenceDate);
      const assessment = assessProtectedTimeConflict({
        candidate,
        protectedBlock: {
          temporalKind: "timed",
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          protectionMode: block.protection_mode,
        },
      });
      if (!assessment.overlapping) continue;
      const existing = conflicts.get(block.id) as { occurrences?: Array<{ startsAt: string; endsAt: string }> } | undefined;
      if (existing) existing.occurrences?.push({ startsAt: occurrence.startsAt, endsAt: occurrence.endsAt });
      else {
        conflicts.set(block.id, {
          blockId: block.id,
          label: block.label,
          category: block.category,
          protectionMode: block.protection_mode,
          patternKind: block.pattern_kind,
          timeZone: block.time_zone,
          blockUpdatedAt: block.updated_at,
          occurrences: [{ startsAt: occurrence.startsAt, endsAt: occurrence.endsAt }],
        });
      }
    }
  }

  return Object.freeze([...conflicts.values()]
    .sort((a, b) => String(a.blockId).localeCompare(String(b.blockId)))
    .map((item) => Object.freeze({
      ...item,
      occurrences: Object.freeze((item.occurrences as Array<{ startsAt: string; endsAt: string }>).slice(0, 10)),
    })));
}

export function buildProtectedTimeSnapshot(protectedBlocks: ProtectedTimeRow[]) {
  return Object.freeze([...protectedBlocks]
    .map((block) => Object.freeze({ id: block.id, updatedAt: block.updated_at }))
    .sort((a, b) => a.id.localeCompare(b.id)));
}

export function decisionsMatchConflicts(decisions: Array<Record<string, unknown>>, conflicts: Array<Record<string, unknown>>) {
  if (decisions.length !== conflicts.length) return false;
  const expected = conflicts.map((conflict) => ({
    blockId: conflict.blockId,
    blockUpdatedAt: conflict.blockUpdatedAt,
    protectionMode: conflict.protectionMode,
    decision: conflict.protectionMode === "hard" ? "override" : "keep",
  })).sort((a, b) => String(a.blockId).localeCompare(String(b.blockId)));
  return JSON.stringify(decisions) === JSON.stringify(expected);
}
