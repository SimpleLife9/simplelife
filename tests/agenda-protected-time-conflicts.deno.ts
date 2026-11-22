import { findProtectedTimeConflicts, normalizeProtectedTimeDecisions } from "../src/features/agenda/domain/protected-time-conflicts.js";
import { resolveLocalDateTimeRange } from "../supabase/functions/agenda-time-resolve/resolver.ts";

function weekly(overrides: Record<string, unknown> = {}) {
  return {
    id: "019a0000-0000-7000-8000-000000000121",
    updated_at: "2026-02-01T10:00:00.000000+00:00",
    label: "Entrenamiento",
    category: "salud",
    protection_mode: "hard",
    pattern_kind: "weekly",
    time_zone: "America/New_York",
    start_date: "2026-03-01",
    end_date_exclusive: null,
    weekdays: [7],
    start_time_local: "02:30:00",
    end_time_local: "04:00:00",
    ends_next_day: false,
    archived_at: null,
    deleted_at: null,
    ...overrides,
  };
}

Deno.test("expands weekly Protected Time through the real IANA resolver across a DST gap", () => {
  const result = findProtectedTimeConflicts({
    event: {
      temporal_kind: "fixed_instant",
      starts_at: "2026-03-08T07:15:00.000Z",
      ends_at: "2026-03-08T07:30:00.000Z",
    },
    protectedBlocks: [weekly()],
    calendarTimeZone: "America/New_York",
    resolveRange: resolveLocalDateTimeRange,
  });
  if (result.conflicts.length !== 1) throw new Error("Expected one DST-adjusted weekly conflict.");
  const conflict = result.conflicts[0];
  if (conflict.occurrenceStartsAt !== "2026-03-08T07:00:00.000Z") {
    throw new Error("Weekly gap policy must move 02:30 to the first valid local time.");
  }
  if (conflict.occurrenceEndsAt !== "2026-03-08T08:00:00.000Z") {
    throw new Error("Weekly occurrence must retain the 04:00 wall-time end.");
  }
  if (conflict.requiredDecision !== "override_hard") {
    throw new Error("Hard-protected DST overlap must require an explicit override.");
  }
});

Deno.test("uses the documented earlier occurrence policy for a weekly DST fold", () => {
  const result = findProtectedTimeConflicts({
    event: {
      temporal_kind: "fixed_instant",
      starts_at: "2026-11-01T05:25:00.000Z",
      ends_at: "2026-11-01T05:40:00.000Z",
    },
    protectedBlocks: [weekly({
      start_date: "2026-10-25",
      weekdays: [7],
      start_time_local: "01:15:00",
      end_time_local: "01:45:00",
      ends_next_day: false,
      protection_mode: "flexible",
    })],
    calendarTimeZone: "America/New_York",
    resolveRange: resolveLocalDateTimeRange,
  });
  if (result.conflicts.length !== 1) throw new Error("Expected one first-fold weekly occurrence.");
  const conflict = result.conflicts[0];
  if (conflict.occurrenceStartsAt !== "2026-11-01T05:15:00.000Z") {
    throw new Error("Weekly fold policy must choose the earlier occurrence.");
  }
  if (conflict.requiredDecision !== "keep_flexible") {
    throw new Error("Flexible-protected overlap must require an explicit keep choice.");
  }
  const decisions = normalizeProtectedTimeDecisions(result.conflicts, [{
    blockId: conflict.blockId,
    blockUpdatedAt: conflict.blockUpdatedAt,
    occurrenceStartsAt: conflict.occurrenceStartsAt,
    decision: "keep_flexible",
  }], "2026-10-31T12:00:00.000Z");
  if (!decisions.ok || decisions.decisions.length !== 1) {
    throw new Error("An explicit flexible choice must produce one auditable decision.");
  }
});
