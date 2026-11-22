import {
  assessEventProtectedTimeConflicts,
  buildProtectedTimeSnapshot,
  decisionsMatchConflicts,
} from "../supabase/functions/_shared/agenda-protected-time-conflicts.ts";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

function oneOff(overrides: Record<string, unknown> = {}) {
  return {
    id: "0190f47a-7b2c-7abc-8def-0123456789b1",
    label: "Reserva puntual",
    category: "Personal",
    protection_mode: "hard" as const,
    pattern_kind: "one_off" as const,
    time_zone: "America/Havana",
    starts_at: "2026-11-24T04:00:00.000Z",
    ends_at: "2026-11-24T05:00:00.000Z",
    start_date: null,
    end_date_exclusive: null,
    weekdays: null,
    start_time_local: null,
    end_time_local: null,
    ends_next_day: null,
    updated_at: "2026-11-22T18:00:00.123456Z",
    ...overrides,
  };
}

function timedEvent(startsAt: string, endsAt: string) {
  return {
    temporal_kind: "fixed_instant" as const,
    starts_at: startsAt,
    ends_at: endsAt,
    start_date: null,
    end_date_exclusive: null,
  };
}

Deno.test("one-off conflicts use half-open [start,end) ranges", () => {
  const block = oneOff();
  const overlap = assessEventProtectedTimeConflicts({
    event: timedEvent("2026-11-24T04:59:00.000Z", "2026-11-24T05:30:00.000Z"),
    protectedBlocks: [block],
    viewerTimeZone: "America/Havana",
  });
  assertEquals(overlap.length, 1, "actual overlap");

  const touchesBoundary = assessEventProtectedTimeConflicts({
    event: timedEvent("2026-11-24T03:00:00.000Z", "2026-11-24T04:00:00.000Z"),
    protectedBlocks: [block],
    viewerTimeZone: "America/Havana",
  });
  assertEquals(touchesBoundary.length, 0, "exclusive end boundary");
});

Deno.test("weekly overnight recurrence resolves in the block timezone", () => {
  const block = oneOff({
    protection_mode: "flexible",
    pattern_kind: "weekly",
    time_zone: "America/Havana",
    starts_at: null,
    ends_at: null,
    start_date: "2026-11-01",
    end_date_exclusive: null,
    weekdays: [1],
    start_time_local: "22:00:00",
    end_time_local: "06:30:00",
    ends_next_day: true,
  });
  const conflicts = assessEventProtectedTimeConflicts({
    event: timedEvent("2026-11-24T04:00:00.000Z", "2026-11-24T05:00:00.000Z"),
    protectedBlocks: [block],
    viewerTimeZone: "America/Havana",
  });
  assertEquals(conflicts.length, 1, "Monday overnight overlap");
  assertEquals(conflicts[0].protectionMode, "flexible", "flexible mode carried to consent");
  assertEquals((conflicts[0].occurrences as unknown[]).length, 1, "one weekly occurrence");
});

Deno.test("weekly recurrence resolves a spring-forward gap with the pinned IANA resolver", () => {
  const block = oneOff({
    protection_mode: "hard",
    pattern_kind: "weekly",
    time_zone: "America/New_York",
    starts_at: null,
    ends_at: null,
    start_date: "2026-01-01",
    end_date_exclusive: null,
    weekdays: [7],
    start_time_local: "02:30:00",
    end_time_local: "03:30:00",
    ends_next_day: false,
  });
  const conflicts = assessEventProtectedTimeConflicts({
    event: timedEvent("2026-03-08T07:10:00.000Z", "2026-03-08T07:20:00.000Z"),
    protectedBlocks: [block],
    viewerTimeZone: "America/New_York",
  });
  assertEquals(conflicts.length, 1, "spring-forward gap occurrence");
  const occurrence = (conflicts[0].occurrences as Array<Record<string, unknown>>)[0];
  assertEquals(occurrence.startsAt, "2026-03-08T07:00:00.000Z", "gap advanced to first valid instant");
});

Deno.test("all-day Event boundaries are resolved at local midnight in the owner's timezone", () => {
  const block = oneOff({
    starts_at: "2026-11-24T04:30:00.000Z",
    ends_at: "2026-11-24T05:30:00.000Z",
  });
  const conflicts = assessEventProtectedTimeConflicts({
    event: {
      temporal_kind: "all_day",
      starts_at: null,
      ends_at: null,
      start_date: "2026-11-23",
      end_date_exclusive: "2026-11-24",
    },
    protectedBlocks: [block],
    viewerTimeZone: "America/Havana",
  });
  assertEquals(conflicts.length, 1, "all-day local midnight overlap");
});

Deno.test("consent must match every current conflict and carry the reviewed block version", () => {
  const block = oneOff();
  const conflicts = assessEventProtectedTimeConflicts({
    event: timedEvent("2026-11-24T04:15:00.000Z", "2026-11-24T04:45:00.000Z"),
    protectedBlocks: [block],
    viewerTimeZone: "America/Havana",
  });
  const conflict = conflicts[0] as Record<string, unknown>;
  const valid = [{
    blockId: block.id,
    blockUpdatedAt: block.updated_at,
    protectionMode: "hard",
    decision: "override",
  }];
  assertEquals(decisionsMatchConflicts(valid, conflicts as unknown as Array<Record<string, unknown>>), true, "exact consent");
  assertEquals(decisionsMatchConflicts([], conflicts as unknown as Array<Record<string, unknown>>), false, "missing consent");
  assertEquals(decisionsMatchConflicts([{ ...valid[0], blockUpdatedAt: "2026-11-22T18:00:00.123457Z" }], conflicts as unknown as Array<Record<string, unknown>>), false, "stale consent");
});

Deno.test("Protected Time snapshot is stable and owner block versions are preserved", () => {
  const blocks = [
    oneOff({ id: "0190f47a-7b2c-7abc-8def-0123456789b2" }),
    oneOff({ id: "0190f47a-7b2c-7abc-8def-0123456789b1" }),
  ];
  assertEquals(buildProtectedTimeSnapshot(blocks), [
    { id: "0190f47a-7b2c-7abc-8def-0123456789b1", updatedAt: "2026-11-22T18:00:00.123456Z" },
    { id: "0190f47a-7b2c-7abc-8def-0123456789b2", updatedAt: "2026-11-22T18:00:00.123456Z" },
  ], "deterministic full snapshot");
});
