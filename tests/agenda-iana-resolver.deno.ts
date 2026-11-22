import { EXPECTED_TZDB_VERSION, getTzdbVersion, MAX_RANGE_BATCH_ITEMS, resolveLocalDateTime, resolveLocalDateTimeRange, resolveLocalDateTimeRanges } from "../supabase/functions/agenda-time-resolve/resolver.ts";

function equal<T>(actual:T, expected:T, label:string):void {
  if (actual !== expected) throw new Error(label + ": expected " + String(expected) + ", received " + String(actual));
}
function throws(action:()=>unknown, label:string):void {
  let didThrow=false;
  try { action(); } catch { didThrow=true; }
  if (!didThrow) throw new Error("Expected an error: " + label);
}
Deno.test("pinned IANA release is loaded",()=>{
  equal(getTzdbVersion(),EXPECTED_TZDB_VERSION,"loaded TZDB version");
  equal(EXPECTED_TZDB_VERSION,"2026f","pinned TZDB version");
});
Deno.test("Cuba stays at UTC-04 on 2026-11-01",()=>{
  const r=resolveLocalDateTime({localDateTime:"2026-11-01T01:30",timeZone:"America/Havana"});
  equal(r.instant,"2026-11-01T05:30:00.000Z","Cuba UTC instant");
  equal(r.resolution,"exact","Cuba resolution");
});
Deno.test("New York spring gap moves to first valid minute",()=>{
  const r=resolveLocalDateTime({localDateTime:"2026-03-08T02:30",timeZone:"America/New_York"});
  equal(r.resolvedLocalDateTime,"2026-03-08T03:00:00.000","resolved local time");
  equal(r.instant,"2026-03-08T07:00:00.000Z","resolved instant");
  equal(r.adjustmentMinutes,30,"gap adjustment");
});
Deno.test("New York repeated time chooses earlier unless later is explicit",()=>{
  const earlier=resolveLocalDateTime({localDateTime:"2026-11-01T01:30",timeZone:"America/New_York"});
  const later=resolveLocalDateTime({localDateTime:"2026-11-01T01:30",timeZone:"America/New_York",disambiguation:"later"});
  equal(earlier.instant,"2026-11-01T05:30:00.000Z","earlier instant");
  equal(later.instant,"2026-11-01T06:30:00.000Z","later instant");
  throws(()=>resolveLocalDateTime({localDateTime:"2026-11-01T01:30",timeZone:"America/New_York",disambiguation:"reject"}),"ambiguous time");
});
Deno.test("Lord Howe uses half-hour transitions",()=>{
  const gap=resolveLocalDateTime({localDateTime:"2026-10-04T02:15",timeZone:"Australia/Lord_Howe"});
  const early=resolveLocalDateTime({localDateTime:"2026-04-05T01:45",timeZone:"Australia/Lord_Howe"});
  const late=resolveLocalDateTime({localDateTime:"2026-04-05T01:45",timeZone:"Australia/Lord_Howe",disambiguation:"later"});
  equal(gap.resolvedLocalDateTime,"2026-10-04T02:30:00.000","Lord Howe gap");
  equal(gap.adjustmentMinutes,15,"Lord Howe gap minutes");
  equal(Date.parse(late.instant)-Date.parse(early.instant),30*60_000,"Lord Howe fold duration");
});
Deno.test("Apia skipped civil date is handled within the 24h v1 bound",()=>{
  const r=resolveLocalDateTime({localDateTime:"2011-12-30T12:00",timeZone:"Pacific/Apia"});
  equal(r.resolvedLocalDateTime,"2011-12-31T00:00:00.000","Apia resolved local time");
  equal(r.adjustmentMinutes,720,"Apia adjustment");
  equal(r.instant,"2011-12-30T10:00:00.000Z","Apia UTC instant");
});
Deno.test("invalid local values and zones fail closed",()=>{
  throws(()=>resolveLocalDateTime({localDateTime:"2026-02-29T10:00",timeZone:"America/Havana"}),"invalid calendar date");
  throws(()=>resolveLocalDateTime({localDateTime:"2026-11-01T01:30",timeZone:"Unknown/Zone"}),"unknown zone");
  throws(()=>resolveLocalDateTime({localDateTime:"2026-11-01T01:30-04:00",timeZone:"America/Havana"}),"offset-bearing date-time");
});

Deno.test("atomic event range resolves exact endpoints under one TZDB release",()=>{
  const r=resolveLocalDateTimeRange({
    timeZone:"America/New_York",
    start:{localDateTime:"2026-11-02T09:00"},
    end:{localDateTime:"2026-11-02T10:30"},
  });
  equal(r.startsAt,"2026-11-02T14:00:00.000Z","range start instant");
  equal(r.endsAt,"2026-11-02T15:30:00.000Z","range end instant");
  equal(r.start.rulesVersion,EXPECTED_TZDB_VERSION,"start rules version");
  equal(r.end.rulesVersion,EXPECTED_TZDB_VERSION,"end rules version");
  equal(r.rulesVersion,EXPECTED_TZDB_VERSION,"range rules version");
  equal(r.start.resolverVersion,r.end.resolverVersion,"same resolver version");
  equal(r.timeZone,"America/New_York","canonical timezone");
});
Deno.test("range resolves fold disambiguation independently at each endpoint",()=>{
  const r=resolveLocalDateTimeRange({
    timeZone:"America/New_York",
    start:{localDateTime:"2026-11-01T01:15",disambiguation:"earlier"},
    end:{localDateTime:"2026-11-01T01:45",disambiguation:"later"},
  });
  equal(r.startsAt,"2026-11-01T05:15:00.000Z","fold start instant");
  equal(r.endsAt,"2026-11-01T06:45:00.000Z","fold end instant");
  equal(r.start.resolution,"ambiguous-first","start fold selection");
  equal(r.end.resolution,"ambiguous-later","end fold selection");
});
Deno.test("range adjusts a gap endpoint and keeps both results on the same TZDB",()=>{
  const r=resolveLocalDateTimeRange({
    timeZone:"America/New_York",
    start:{localDateTime:"2026-03-08T02:30"},
    end:{localDateTime:"2026-03-08T03:30"},
  });
  equal(r.start.resolution,"gap-adjusted-next-valid","gap start result");
  equal(r.start.resolvedLocalDateTime,"2026-03-08T03:00:00.000","gap start wall time");
  equal(r.start.adjustmentMinutes,30,"gap adjustment");
  equal(r.rulesVersion,r.end.rulesVersion,"range TZDB consistency");
  equal(r.endsAt,"2026-03-08T07:30:00.000Z","gap range end instant");
});
Deno.test("range rejects endpoints whose resolved UTC end is not after start",()=>{
  throws(()=>resolveLocalDateTimeRange({
    timeZone:"America/New_York",
    start:{localDateTime:"2026-11-01T01:45",disambiguation:"later"},
    end:{localDateTime:"2026-11-01T01:50",disambiguation:"earlier"},
  }),"UTC end before UTC start during fold");
  throws(()=>resolveLocalDateTimeRange({
    timeZone:"America/Havana",
    start:{localDateTime:"2026-11-02T10:00"},
    end:{localDateTime:"2026-11-02T10:00"},
  }),"zero duration");
});
Deno.test("range rejects missing endpoints and unsupported nested fields",()=>{
  throws(()=>resolveLocalDateTimeRange({timeZone:"America/Havana",start:{localDateTime:"2026-11-02T10:00"}}),"missing end");
  throws(()=>resolveLocalDateTimeRange({timeZone:"America/Havana",start:{localDateTime:"2026-11-02T10:00",offset:"-04:00"},end:{localDateTime:"2026-11-02T11:00"}}),"unsupported endpoint field");
});


Deno.test("bounded range batch resolves multiple zones under one pinned TZDB release", () => {
  const batch = resolveLocalDateTimeRanges({
    ranges: [
      {
        timeZone: "America/Havana",
        start: { localDateTime: "2026-10-30T09:00" },
        end: { localDateTime: "2026-10-30T10:00" },
      },
      {
        timeZone: "America/New_York",
        start: { localDateTime: "2026-11-02T09:00" },
        end: { localDateTime: "2026-11-02T10:30" },
      },
    ],
  });
  equal(batch.count, 2, "batch count");
  equal(batch.results[0].startsAt, "2026-10-30T13:00:00.000Z", "first start");
  equal(batch.results[0].endsAt, "2026-10-30T14:00:00.000Z", "first end");
  equal(batch.results[1].startsAt, "2026-11-02T14:00:00.000Z", "second start");
  equal(batch.results[1].endsAt, "2026-11-02T15:30:00.000Z", "second end");
  equal(batch.rulesVersion, EXPECTED_TZDB_VERSION, "batch TZDB version");
  equal(batch.resolverVersion, batch.results[0].resolverVersion, "batch resolver version");
  equal(batch.results[0].rulesVersion, batch.results[1].rulesVersion, "all result rules versions");
  equal(batch.authoritative, true, "batch authoritative marker");
});

Deno.test("range batch rejects empty, oversized, malformed and partially invalid batches", () => {
  throws(() => resolveLocalDateTimeRanges({ ranges: [] }), "empty batch");
  throws(() => resolveLocalDateTimeRanges({ ranges: Array.from({ length: MAX_RANGE_BATCH_ITEMS + 1 }, () => ({
    timeZone: "America/Havana",
    start: { localDateTime: "2026-11-02T09:00" },
    end: { localDateTime: "2026-11-02T10:00" },
  })) }), "oversized batch");
  throws(() => resolveLocalDateTimeRanges({ ranges: [{}] }), "invalid range entry");
  throws(() => resolveLocalDateTimeRanges({ ranges: [{
    timeZone: "America/Havana",
    start: { localDateTime: "2026-11-02T09:00" },
    end: { localDateTime: "2026-11-02T09:00" },
  }] }), "one invalid range rejects the full batch");
  throws(() => resolveLocalDateTimeRanges({ ranges: [], extra: true }), "unsupported batch field");
});
