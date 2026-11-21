import { EXPECTED_TZDB_VERSION, getTzdbVersion, resolveLocalDateTime } from "../supabase/functions/agenda-time-resolve/resolver.ts";

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
