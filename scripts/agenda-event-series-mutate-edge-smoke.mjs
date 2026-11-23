import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const base = "http://127.0.0.1:54321";
const password = randomBytes(32).toString("base64url") + "aA1!";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) { throw new Error(message); }
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) fail(command + " failed:\n" + result.stdout + "\n" + result.stderr);
  return (result.stdout + result.stderr).trim();
}
function sqlScalar(sql) {
  return run("docker", [
    "exec", "-i", "supabase_db_simplelife",
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-Atqc", sql,
  ]);
}
function parseJson(value, label) {
  try { return JSON.parse(value); } catch { fail(label + " returned invalid JSON: " + value); }
}
function equal(actual, expected, label) {
  if (actual !== expected) fail(label + ": expected " + expected + ", received " + actual);
}
function assertUuid(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) fail(label + " is not a valid UUID: " + String(value));
}
function newUuid() {
  const value = sqlScalar("SELECT private.uuidv7()");
  assertUuid(value, UUID_V7_PATTERN, "Generated UUIDv7");
  return value;
}
function addDays(value, count) {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + count));
  return [next.getUTCFullYear(), String(next.getUTCMonth() + 1).padStart(2, "0"), String(next.getUTCDate()).padStart(2, "0")].join("-");
}
function todayInHavana() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Havana", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return value.year + "-" + value.month + "-" + value.day;
}
function sqlLiteral(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
function startServer(name) {
  const child = spawn("supabase", ["functions", "serve", name, "--no-verify-jwt"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  let logs = "";
  let exitCode = null;
  const capture = (chunk) => { logs = (logs + chunk.toString()).slice(-12000); };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("exit", (code) => { exitCode = code; });
  return { child, get logs() { return logs; }, get exitCode() { return exitCode; } };
}
async function waitReady(server, functionName, publishable) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) fail(functionName + " Edge server exited early: " + server.exitCode + "\n" + server.logs);
    try {
      const probe = await fetch(base + "/functions/v1/" + functionName, {
        method: "GET",
        headers: { apikey: publishable, authorization: "Bearer " + publishable },
        signal: AbortSignal.timeout(2000),
      });
      if (probe.status === 401) return;
      await probe.body?.cancel().catch(() => {});
    } catch { /* bounded readiness retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(functionName + " Edge Runtime did not become ready.\n" + server.logs);
}
async function readJson(response, status, label) {
  const value = parseJson(await response.text(), label);
  equal(response.status, status, label + " HTTP status");
  return value;
}

const status = run("supabase", ["status"]);
const publishable = status.match(/Publishable\s*[│|]\s*(sb_publishable_[A-Za-z0-9_-]+)/i)?.[1];
const secret = status.match(/Secret\s*[│|]\s*(sb_secret_[A-Za-z0-9_-]+)/i)?.[1];
if (!publishable || !secret) fail("Local Supabase status did not expose publishable/secret keys.");

const email = "agenda-series-edit-qa+" + Date.now() + "@example.invalid";
const created = await fetch(base + "/auth/v1/admin/users", {
  method: "POST",
  headers: { apikey: secret, authorization: "Bearer " + secret, "content-type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true }),
  signal: AbortSignal.timeout(10000),
});
if (![200, 201].includes(created.status)) fail("Could not create temporary Auth user: " + await created.text());
const auth = parseJson(await created.text(), "Auth Admin create user");
const authUserId = auth.id ?? auth.user?.id;
assertUuid(authUserId, UUID_PATTERN, "Auth user ID");

const profileId = newUuid();
const seriesId = newUuid();
const occurrenceIds = [newUuid(), newUuid(), newUuid()];
const startDate = addDays(todayInHavana(), 1);
const sql = `
INSERT INTO public.user_profile (id, auth_user_id, display_name, account_status)
VALUES (${sqlLiteral(profileId)}::uuid, ${sqlLiteral(authUserId)}::uuid, 'Series Edit QA', 'active');

INSERT INTO public.calendar_event (
  id, owner_user_id, created_by_user_id, updated_by_user_id,
  title, event_status, temporal_kind, start_date, end_date_exclusive,
  recurrence_rule, recurrence_end_local_time, recurrence_end_day_offset,
  recurrence_effective_from, recurrence_effective_through,
  recurrence_parent_event_id, recurrence_inherited_occurrence_id,
  protected_time_decisions, task_schedule_conflict_decisions
) VALUES (
  ${sqlLiteral(seriesId)}::uuid, ${sqlLiteral(profileId)}::uuid,
  ${sqlLiteral(profileId)}::uuid, ${sqlLiteral(profileId)}::uuid,
  'Series Edit Edge Smoke', 'confirmed', 'all_day',
  ${sqlLiteral(startDate)}::date, (${sqlLiteral(startDate)}::date + 1),
  jsonb_build_object(
    'version', 1, 'frequency', 'DAILY', 'interval', 1,
    'startDate', ${sqlLiteral(startDate)}, 'temporalKind', 'all_day',
    'count', 3, 'excludedDates', '[]'::jsonb
  ),
  NULL, 0, ${sqlLiteral(startDate)}::date, NULL, NULL, NULL, '[]'::jsonb, '[]'::jsonb
);

INSERT INTO public.calendar_event_occurrence (
  id, owner_user_id, created_by_user_id, updated_by_user_id,
  calendar_event_id, occurrence_key, original_local_date, original_local_time,
  actual_local_date, actual_local_time, temporal_kind,
  start_date, end_date_exclusive, occurrence_status, override_kind,
  review_candidate, row_version
)
SELECT
  ids.id,
  ${sqlLiteral(profileId)}::uuid,
  ${sqlLiteral(profileId)}::uuid,
  ${sqlLiteral(profileId)}::uuid,
  ${sqlLiteral(seriesId)}::uuid,
  'v1:' || ${sqlLiteral(seriesId)} || ':' || dates.local_date::text || ':ALL_DAY',
  dates.local_date, NULL, dates.local_date, NULL, 'all_day',
  dates.local_date, dates.local_date + 1, 'scheduled', NULL, NULL, 1
FROM (VALUES
  (${sqlLiteral(occurrenceIds[0])}::uuid, ${sqlLiteral(startDate)}::date),
  (${sqlLiteral(occurrenceIds[1])}::uuid, (${sqlLiteral(startDate)}::date + 1)),
  (${sqlLiteral(occurrenceIds[2])}::uuid, (${sqlLiteral(startDate)}::date + 2))
) AS ids(id, local_date)
JOIN LATERAL (SELECT ids.local_date) AS dates ON true;
`;
run("docker", ["exec", "-i", "supabase_db_simplelife", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", sql]);

const login = await fetch(base + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: publishable, "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
  signal: AbortSignal.timeout(10000),
});
if (login.status !== 200) fail("Could not obtain temporary user JWT: " + await login.text());
const session = await login.json();

let server = null;
try {
  server = startServer("agenda-event-series-mutate");
  await waitReady(server, "agenda-event-series-mutate", publishable);

  const parent = await fetch(base + "/rest/v1/calendar_event?id=eq." + seriesId + "&owner_user_id=eq." + profileId + "&select=updated_at", {
    headers: { apikey: secret, authorization: "Bearer " + secret },
    signal: AbortSignal.timeout(10000),
  });
  if (parent.status !== 200) fail("Could not load temporary parent series: " + await parent.text());
  const parentRows = await parent.json();
  if (!Array.isArray(parentRows) || parentRows.length !== 1) fail("Expected exactly one temporary parent series.");
  const expectedUpdatedAt = parentRows[0].updated_at;

  const key = newUuid();
  const selectedDate = addDays(startDate, 1);
  const payload = {
    seriesId,
    expectedUpdatedAt,
    selectedOccurrenceId: occurrenceIds[1],
    scope: "this_and_following",
    event: {
      title: "Series Edit Edge Smoke · split",
      eventStatus: "confirmed",
      temporalKind: "all_day",
      startDate: selectedDate,
      endDateExclusive: addDays(selectedDate, 1),
    },
    recurrenceRule: {
      version: 1,
      frequency: "DAILY",
      interval: 1,
      startDate: selectedDate,
      temporalKind: "all_day",
      count: 3,
    },
    endLocalTime: null,
    endDayOffset: 0,
  };
  async function invoke(token) {
    return await fetch(base + "/functions/v1/agenda-event-series-mutate", {
      method: "POST",
      headers: {
        apikey: publishable,
        authorization: "Bearer " + token,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
  }

  equal((await invoke(publishable)).status, 401, "Invalid API-key Bearer is rejected");
  const first = await readJson(await invoke(session.access_token), 200, "Authenticated series split");
  equal(first.scope, "this_and_following", "Scope returned by server");
  assertUuid(first.childSeriesEventId, UUID_V7_PATTERN, "Child series ID");
  const replay = await readJson(await invoke(session.access_token), 200, "Series split idempotent retry");
  equal(replay.childSeriesEventId, first.childSeriesEventId, "Replay preserves child series ID");
  equal(replay.replayed, true, "Replay marker");

  const selected = await fetch(base + "/rest/v1/calendar_event_occurrence?id=eq." + occurrenceIds[1] + "&select=calendar_event_id,occurrence_status", {
    headers: { apikey: secret, authorization: "Bearer " + secret },
    signal: AbortSignal.timeout(10000),
  });
  const selectedRows = await selected.json();
  if (selected.status !== 200 || selectedRows.length !== 1) fail("Selected inherited occurrence could not be verified.");
  equal(selectedRows[0].calendar_event_id, seriesId, "Selected occurrence remains in parent");
  equal(selectedRows[0].occurrence_status, "scheduled", "Selected occurrence remains active");

  const child = await fetch(base + "/rest/v1/calendar_event?id=eq." + first.childSeriesEventId + "&select=recurrence_parent_event_id,recurrence_inherited_occurrence_id,recurrence_effective_from,recurrence_rule", {
    headers: { apikey: secret, authorization: "Bearer " + secret },
    signal: AbortSignal.timeout(10000),
  });
  const childRows = await child.json();
  if (child.status !== 200 || childRows.length !== 1) fail("Child series was not persisted.");
  equal(childRows[0].recurrence_parent_event_id, seriesId, "Child parent link");
  equal(childRows[0].recurrence_inherited_occurrence_id, occurrenceIds[1], "Child inherited occurrence link");
  equal(childRows[0].recurrence_effective_from, selectedDate, "Child effective boundary");
  equal(childRows[0].recurrence_rule.excludedDates.includes(selectedDate), true, "Child rule excludes inherited date");

  const childOccurrences = await fetch(base + "/rest/v1/calendar_event_occurrence?calendar_event_id=eq." + first.childSeriesEventId + "&select=original_local_date,calendar_event_id&order=original_local_date.asc", {
    headers: { apikey: secret, authorization: "Bearer " + secret },
    signal: AbortSignal.timeout(10000),
  });
  const childOccurrenceRows = await childOccurrences.json();
  if (childOccurrences.status !== 200) fail("Child occurrences could not be inspected.");
  equal(childOccurrenceRows.length, 2, "Child future occurrences count");
  if (childOccurrenceRows.some((row) => row.original_local_date <= selectedDate || row.calendar_event_id !== first.childSeriesEventId)) {
    fail("Child materialized an inherited date twice or attached an occurrence to the wrong segment.");
  }

  const parentBoundaryResponse = await fetch(base + "/rest/v1/calendar_event?id=eq." + seriesId + "&select=recurrence_effective_through", {
    headers: { apikey: secret, authorization: "Bearer " + secret },
    signal: AbortSignal.timeout(10000),
  });
  const parentRowsAfter = await parentBoundaryResponse.json();
  equal(parentRowsAfter[0].recurrence_effective_through, selectedDate, "Parent effective-through date");

  console.log("PASS: real Auth JWT executes recurring series scope mutation in local Edge Runtime.");
  console.log("PASS: invalid API-key Bearer is rejected.");
  console.log("PASS: selected occurrence stays with parent; child lineage and following occurrences are persisted.");
  console.log("PASS: same-key retry replays the winning child ID.");
} finally {
  server?.child.kill("SIGTERM");
  if (server) {
    await new Promise((resolve) => {
      if (server.child.exitCode !== null) return resolve();
      const timeout = setTimeout(resolve, 5000);
      server.child.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
}
