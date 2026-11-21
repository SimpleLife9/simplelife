import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { EXPECTED_TZDB_VERSION, getTzdbVersion, resolveLocalDateTime } from "../supabase/functions/agenda-time-resolve/resolver.ts";

Deno.test("pinned IANA release is loaded", () => {
  assertEquals(getTzdbVersion(), EXPECTED_TZDB_VERSION);
  assertEquals(EXPECTED_TZDB_VERSION, "2026f");
});
Deno.test("Cuba stays at UTC-04 on 2026-11-01", () => {
  const r = resolveLocalDateTime({ localDateTime: "2026-11-01T01:30", timeZone: "America/Havana" });
  assertEquals(r.instant, "2026-11-01T05:30:00.000Z");
  assertEquals(r.resolution, "exact");
});
Deno.test("New York spring gap moves to first valid minute", () => {
  const r = resolveLocalDateTime({ localDateTime: "2026-03-08T02:30", timeZone: "America/New_York" });
  assertEquals(r.resolvedLocalDateTime, "2026-03-08T03:00:00.000");
  assertEquals(r.instant, "2026-03-08T07:00:00.000Z");
  assertEquals(r.adjustmentMinutes, 30);
});
Deno.test("New York repeated time chooses earlier unless later is explicit", () => {
  const earlier = resolveLocalDateTime({ localDateTime: "2026-11-01T01:30", timeZone: "America/New_York" });
  const later = resolveLocalDateTime({ localDateTime: "2026-11-01T01:30", timeZone: "America/New_York", disambiguation: "later" });
  assertEquals(earlier.instant, "2026-11-01T05:30:00.000Z");
  assertEquals(later.instant, "2026-11-01T06:30:00.000Z");
  assertThrows(() => resolveLocalDateTime({ localDateTime: "2026-11-01T01:30", timeZone: "America/New_York", disambiguation: "reject" }));
});
Deno.test("Lord Howe uses half-hour transitions", () => {
  const gap = resolveLocalDateTime({ localDateTime: "2026-10-04T02:15", timeZone: "Australia/Lord_Howe" });
  const early = resolveLocalDateTime({ localDateTime: "2026-04-05T01:45", timeZone: "Australia/Lord_Howe" });
  const late = resolveLocalDateTime({ localDateTime: "2026-04-05T01:45", timeZone: "Australia/Lord_Howe", disambiguation: "later" });
  assertEquals(gap.resolvedLocalDateTime, "2026-10-04T02:30:00.000");
  assertEquals(gap.adjustmentMinutes, 15);
  assertEquals(Date.parse(late.instant) - Date.parse(early.instant), 30 * 60_000);
});
Deno.test("Apia skipped civil date is handled within the 24h v1 bound", () => {
  const r = resolveLocalDateTime({ localDateTime: "2011-12-30T12:00", timeZone: "Pacific/Apia" });
  assertEquals(r.resolvedLocalDateTime, "2011-12-31T00:00:00.000");
  assertEquals(r.adjustmentMinutes, 720);
  assertEquals(r.instant, "2011-12-30T10:00:00.000Z");
});
Deno.test("invalid local values and zones fail closed", () => {
  assertThrows(() => resolveLocalDateTime({ localDateTime: "2026-02-29T10:00", timeZone: "America/Havana" }));
  assertThrows(() => resolveLocalDateTime({ localDateTime: "2026-11-01T01:30", timeZone: "Unknown/Zone" }));
  assertThrows(() => resolveLocalDateTime({ localDateTime: "2026-11-01T01:30-04:00", timeZone: "America/Havana" }));
});
