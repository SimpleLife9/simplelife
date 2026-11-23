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
  return result.stdout + result.stderr;
}
function sqlScalar(sql) {
  return run("docker", [
    "exec", "-i", "supabase_db_simplelife",
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-Atqc", sql,
  ]).trim();
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
function dateInHavana() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Havana", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return value.year + "-" + value.month + "-" + value.day;
}
function addCalendarDay(value) {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [next.getUTCFullYear(), String(next.getUTCMonth() + 1).padStart(2, "0"), String(next.getUTCDate()).padStart(2, "0")].join("-");
}

const status = run("supabase", ["status"]);
const publishable = status.match(/Publishable\s*[│|]\s*(sb_publishable_[A-Za-z0-9_-]+)/i)?.[1];
const secret = status.match(/Secret\s*[│|]\s*(sb_secret_[A-Za-z0-9_-]+)/i)?.[1];
if (!publishable || !secret) fail("Local Supabase status did not expose publishable/secret keys.");

const email = "agenda-series-qa+" + Date.now() + "@example.invalid";
const created = await fetch(base + "/auth/v1/admin/users", {
  method: "POST",
  headers: { apikey: secret, authorization: "Bearer " + secret, "content-type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true }),
  signal: AbortSignal.timeout(10000),
});
if (![200, 201].includes(created.status)) fail("Could not create temporary Auth user: " + await created.text());
const authUser = parseJson(await created.text(), "Auth Admin create user");
const authUserId = authUser.id ?? authUser.user?.id;
assertUuid(authUserId, UUID_PATTERN, "Auth user id");
const profileId = newUuid();
const profileSql = "INSERT INTO public.user_profile (id, auth_user_id, display_name, account_status) VALUES ('"
  + profileId + "'::uuid, '" + authUserId + "'::uuid, 'Recurring series QA', 'active')";
run("docker", [
  "exec", "-i", "supabase_db_simplelife", "psql", "-v", "ON_ERROR_STOP=1",
  "-U", "postgres", "-d", "postgres", "-c", profileSql,
]);
const login = await fetch(base + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: publishable, "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
  signal: AbortSignal.timeout(10000),
});
if (login.status !== 200) fail("Could not obtain temporary user JWT: " + await login.text());
const session = await login.json();

const server = spawn("supabase", ["functions", "serve", "agenda-event-series-create", "--no-verify-jwt"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NO_COLOR: "1" },
});
let logs = "";
const capture = (chunk) => { logs = (logs + chunk.toString()).slice(-16000); };
server.stdout.on("data", capture);
server.stderr.on("data", capture);
let exitCode = null;
server.on("exit", (code) => { exitCode = code; });
let materializerServer = null;
let materializerExitCode = null;
let materializerLogs = "";
let occurrenceMutationServer = null;
let occurrenceMutationExitCode = null;
let occurrenceMutationLogs = "";
let seriesMutationServer = null;
let seriesMutationExitCode = null;
let seriesMutationLogs = "";

async function invoke(token, key, payload) {
  return await fetch(base + "/functions/v1/agenda-event-series-create", {
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
async function expectJson(response, expected, label) {
  const body = parseJson(await response.text(), label);
  equal(response.status, expected, label + " HTTP status");
  return body;
}

try {
  let ready = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (exitCode !== null) fail("Recurring Event Edge server exited early: " + exitCode + "\n" + logs);
    try {
      const probe = await fetch(base + "/functions/v1/agenda-event-series-create", {
        method: "GET",
        headers: { apikey: publishable, authorization: "Bearer " + publishable },
        signal: AbortSignal.timeout(2000),
      });
      if (probe.status === 401) { ready = true; break; }
      await probe.body?.cancel().catch(() => {});
    } catch { /* bounded readiness retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) fail("Recurring Event Edge Runtime did not become ready.\n" + logs);

  const key = newUuid();
  const startDate = dateInHavana();
  const endDateExclusive = addCalendarDay(startDate);
  const payload = {
    event: {
      title: "Recurring Event Edge runtime smoke",
      eventStatus: "confirmed",
      temporalKind: "all_day",
      startDate,
      endDateExclusive,
    },
    recurrenceRule: {
      version: 1,
      frequency: "DAILY",
      interval: 1,
      startDate,
      temporalKind: "all_day",
      count: 3,
    },
    endDayOffset: 0,
  };

  const invalidBearer = await invoke(publishable, newUuid(), payload);
  equal(invalidBearer.status, 401, "Publishable key as Bearer");

  const first = await expectJson(
    await invoke(session.access_token, key, payload),
    201,
    "Authenticated recurring Event create",
  );
  assertUuid(first.seriesEventId, UUID_V7_PATTERN, "Created series Event id");
  equal(first.materializedCount, 3, "Materialized occurrence count");
  equal(first.replayed, false, "First create replay marker");

  const replay = await expectJson(
    await invoke(session.access_token, key, payload),
    201,
    "Idempotent recurring Event retry",
  );
  equal(replay.seriesEventId, first.seriesEventId, "Replay preserves series identity");
  equal(replay.replayed, true, "Replay marker");

  const storedEvents = sqlScalar(
    "SELECT count(*) FROM public.calendar_event WHERE id = '" + first.seriesEventId + "'::uuid AND owner_user_id = '" + profileId + "'::uuid",
  );
  equal(storedEvents, "1", "One owner-scoped series master");
  const storedOccurrences = sqlScalar(
    "SELECT count(*) FROM public.calendar_event_occurrence WHERE calendar_event_id = '" + first.seriesEventId + "'::uuid AND owner_user_id = '" + profileId + "'::uuid",
  );
  equal(storedOccurrences, "3", "Exactly three persisted occurrences after retry");

  // Simulate one missing future slot in disposable CI data. The authenticated
  // top-up must restore exactly that key, and a second retry must insert zero.
  const missingDate = addCalendarDay(startDate);
  const deleted = sqlScalar(
    "DELETE FROM public.calendar_event_occurrence WHERE calendar_event_id = '" + first.seriesEventId
      + "'::uuid AND owner_user_id = '" + profileId + "'::uuid AND original_local_date = '" + missingDate + "' RETURNING id",
  );
  assertUuid(deleted, UUID_V7_PATTERN, "Disposable missing occurrence id");

  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });

  materializerServer = spawn("supabase", ["functions", "serve", "agenda-event-series-materialize", "--no-verify-jwt"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  materializerServer.stdout.on("data", (chunk) => { materializerLogs = (materializerLogs + chunk.toString()).slice(-16000); });
  materializerServer.stderr.on("data", (chunk) => { materializerLogs = (materializerLogs + chunk.toString()).slice(-16000); });
  materializerServer.on("exit", (code) => { materializerExitCode = code; });

  let materializerReady = false;
  const materializerDeadline = Date.now() + 60000;
  while (Date.now() < materializerDeadline) {
    if (materializerExitCode !== null) fail("Recurring materializer Edge server exited early: " + materializerExitCode + "\\n" + materializerLogs);
    try {
      const probe = await fetch(base + "/functions/v1/agenda-event-series-materialize", {
        method: "GET",
        headers: { apikey: publishable, authorization: "Bearer " + publishable },
        signal: AbortSignal.timeout(2000),
      });
      if (probe.status === 401) { materializerReady = true; break; }
      await probe.body?.cancel().catch(() => {});
    } catch { /* bounded readiness retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!materializerReady) fail("Recurring materializer Edge Runtime did not become ready.\\n" + materializerLogs);

  async function invokeMaterializer(token) {
    return await fetch(base + "/functions/v1/agenda-event-series-materialize", {
      method: "POST",
      headers: {
        apikey: publishable,
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ seriesIds: [first.seriesEventId] }),
      signal: AbortSignal.timeout(20000),
    });
  }

  const invalidMaterializerBearer = await invokeMaterializer(publishable);
  equal(invalidMaterializerBearer.status, 401, "Materializer rejects publishable API key as Bearer");
  const topUp = await expectJson(await invokeMaterializer(session.access_token), 200, "Authenticated recurring top-up");
  equal(topUp.processedSeriesCount, 1, "Top-up processed one series");
  equal(topUp.materializedCount, 1, "Top-up restored one missing occurrence");
  const topUpRetry = await expectJson(await invokeMaterializer(session.access_token), 200, "Idempotent recurring top-up retry");
  equal(topUpRetry.materializedCount, 0, "Top-up retry inserts no duplicate rows");
  const finalOccurrenceCount = sqlScalar(
    "SELECT count(*) FROM public.calendar_event_occurrence WHERE calendar_event_id = '" + first.seriesEventId + "'::uuid AND owner_user_id = '" + profileId + "'::uuid",
  );
  equal(finalOccurrenceCount, "3", "Top-up restores exactly three occurrence rows");

  materializerServer.kill("SIGTERM");
  await new Promise((resolve) => {
    if (materializerServer.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    materializerServer.once("exit", () => { clearTimeout(timeout); resolve(); });
  });

  occurrenceMutationServer = spawn("supabase", ["functions", "serve", "agenda-event-occurrence-mutate", "--no-verify-jwt"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  occurrenceMutationServer.stdout.on("data", (chunk) => { occurrenceMutationLogs = (occurrenceMutationLogs + chunk.toString()).slice(-16000); });
  occurrenceMutationServer.stderr.on("data", (chunk) => { occurrenceMutationLogs = (occurrenceMutationLogs + chunk.toString()).slice(-16000); });
  occurrenceMutationServer.on("exit", (code) => { occurrenceMutationExitCode = code; });

  let occurrenceMutationReady = false;
  const mutationDeadline = Date.now() + 60000;
  while (Date.now() < mutationDeadline) {
    if (occurrenceMutationExitCode !== null) fail("Occurrence mutation Edge server exited early: " + occurrenceMutationExitCode + "\\n" + occurrenceMutationLogs);
    try {
      const probe = await fetch(base + "/functions/v1/agenda-event-occurrence-mutate", {
        method: "GET",
        headers: { apikey: publishable, authorization: "Bearer " + publishable },
        signal: AbortSignal.timeout(2000),
      });
      if (probe.status === 401) { occurrenceMutationReady = true; break; }
      await probe.body?.cancel().catch(() => {});
    } catch { /* bounded readiness retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!occurrenceMutationReady) fail("Occurrence mutation Edge Runtime did not become ready.\\n" + occurrenceMutationLogs);

  const occurrenceVersionRow = sqlScalar(
    "SELECT id::text || '|' || row_version::text FROM public.calendar_event_occurrence "
      + "WHERE calendar_event_id = '" + first.seriesEventId + "'::uuid "
      + "AND owner_user_id = '" + profileId + "'::uuid "
      + "ORDER BY original_local_date ASC LIMIT 1",
  );
  const [occurrenceId, rowVersionText] = occurrenceVersionRow.split("|");
  assertUuid(occurrenceId, UUID_V7_PATTERN, "Occurrence selected for exception mutation");
  const occurrenceMutationKey = newUuid();
  const occurrenceMutationPayload = {
    occurrenceId,
    expectedRowVersion: Number(rowVersionText),
    action: "cancel",
  };
  async function invokeOccurrenceMutation(token) {
    return await fetch(base + "/functions/v1/agenda-event-occurrence-mutate", {
      method: "POST",
      headers: {
        apikey: publishable,
        authorization: "Bearer " + token,
        "content-type": "application/json",
        "idempotency-key": occurrenceMutationKey,
      },
      body: JSON.stringify(occurrenceMutationPayload),
      signal: AbortSignal.timeout(20000),
    });
  }
  const invalidMutationBearer = await invokeOccurrenceMutation(publishable);
  equal(invalidMutationBearer.status, 401, "Occurrence mutation rejects publishable API key as Bearer");
  const mutation = await expectJson(
    await invokeOccurrenceMutation(session.access_token),
    200,
    "Authenticated occurrence cancellation",
  );
  equal(mutation.occurrenceStatus, "cancelled", "Occurrence cancellation status");
  equal(mutation.overrideKind, "cancelled", "Occurrence cancellation override");
  const mutationReplay = await expectJson(
    await invokeOccurrenceMutation(session.access_token),
    200,
    "Idempotent occurrence cancellation retry",
  );
  equal(mutationReplay.occurrenceId, occurrenceId, "Occurrence mutation replay identity");
  equal(mutationReplay.replayed, true, "Occurrence mutation replay marker");
  const finalMutationState = sqlScalar(
    "SELECT occurrence_status || '|' || row_version::text FROM public.calendar_event_occurrence "
      + "WHERE id = '" + occurrenceId + "'::uuid AND owner_user_id = '" + profileId + "'::uuid",
  );
  equal(finalMutationState, "cancelled|2", "One CAS update and one audited occurrence exception");
  const mutationAudit = sqlScalar(
    "SELECT count(*) FROM public.audit_event WHERE account_user_id = '" + profileId + "'::uuid "
      + "AND entity_type = 'calendar_event_occurrence' AND entity_id = '" + occurrenceId + "'::uuid "
      + "AND action = 'calendar_event_occurrence.updated'",
  );
  equal(mutationAudit, "1", "Exactly one append-only exception audit row");

  occurrenceMutationServer.kill("SIGTERM");
  await new Promise((resolve) => {
    if (occurrenceMutationServer.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    occurrenceMutationServer.once("exit", () => { clearTimeout(timeout); resolve(); });
  });

  // Exercise the two-scope series editor through the authenticated local Edge Runtime.
  // The canceled first slot stays on the parent; split from the next scheduled slot.
  const splitTarget = sqlScalar(
    "SELECT id::text || '|' || original_local_date::text FROM public.calendar_event_occurrence "
      + "WHERE calendar_event_id = '" + first.seriesEventId + "'::uuid "
      + "AND owner_user_id = '" + profileId + "'::uuid "
      + "AND occurrence_status = 'scheduled' AND override_kind IS NULL "
      + "ORDER BY original_local_date ASC LIMIT 1",
  );
  const [selectedOccurrenceId, selectedDate] = splitTarget.split("|");
  assertUuid(selectedOccurrenceId, UUID_V7_PATTERN, "Occurrence selected for series split");
  const masterResponse = await fetch(
    base + "/rest/v1/calendar_event?id=eq." + first.seriesEventId + "&select=updated_at",
    { headers: { apikey: publishable, authorization: "Bearer " + session.access_token } },
  );
  if (masterResponse.status !== 200) fail("Could not read owner-scoped series version: " + await masterResponse.text());
  const masterRows = await masterResponse.json();
  if (!Array.isArray(masterRows) || masterRows.length !== 1 || typeof masterRows[0].updated_at !== "string") {
    fail("Owner-scoped series version response was malformed.");
  }
  const seriesEditKey = newUuid();
  const seriesEditPayload = {
    seriesId: first.seriesEventId,
    expectedUpdatedAt: masterRows[0].updated_at,
    selectedOccurrenceId,
    scope: "this_and_following",
    event: {
      title: "Recurring series split from authenticated Edge smoke",
      eventStatus: "confirmed",
      temporalKind: "all_day",
      startDate: selectedDate,
      endDateExclusive: addCalendarDay(selectedDate),
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
  seriesMutationServer = spawn("supabase", ["functions", "serve", "agenda-event-series-mutate", "--no-verify-jwt"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  seriesMutationServer.stdout.on("data", (chunk) => { seriesMutationLogs = (seriesMutationLogs + chunk.toString()).slice(-16000); });
  seriesMutationServer.stderr.on("data", (chunk) => { seriesMutationLogs = (seriesMutationLogs + chunk.toString()).slice(-16000); });
  seriesMutationServer.on("exit", (code) => { seriesMutationExitCode = code; });

  let seriesMutationReady = false;
  const seriesMutationDeadline = Date.now() + 60000;
  while (Date.now() < seriesMutationDeadline) {
    if (seriesMutationExitCode !== null) {
      fail("Recurring series mutation Edge server exited early: " + seriesMutationExitCode + "\\n" + seriesMutationLogs);
    }
    try {
      const probe = await fetch(base + "/functions/v1/agenda-event-series-mutate", {
        method: "GET",
        headers: { apikey: publishable, authorization: "Bearer " + publishable },
        signal: AbortSignal.timeout(2000),
      });
      if (probe.status === 401) { seriesMutationReady = true; break; }
      await probe.body?.cancel().catch(() => {});
    } catch { /* bounded readiness retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!seriesMutationReady) {
    fail("Recurring series mutation Edge Runtime did not become ready.\\n" + seriesMutationLogs);
  }
  async function invokeSeriesMutation(token) {
    return await fetch(base + "/functions/v1/agenda-event-series-mutate", {
      method: "POST",
      headers: {
        apikey: publishable,
        authorization: "Bearer " + token,
        "content-type": "application/json",
        "idempotency-key": seriesEditKey,
      },
      body: JSON.stringify(seriesEditPayload),
      signal: AbortSignal.timeout(20000),
    });
  }
  const invalidSeriesMutationBearer = await invokeSeriesMutation(publishable);
  equal(invalidSeriesMutationBearer.status, 401, "Series edit rejects publishable API key as Bearer");
  const seriesEdit = await expectJson(
    await invokeSeriesMutation(session.access_token),
    200,
    "Authenticated this-and-following series edit",
  );
  assertUuid(seriesEdit.childSeriesEventId, UUID_V7_PATTERN, "Split child series id");
  equal(seriesEdit.scope, "this_and_following", "Series split scope");
  equal(seriesEdit.selectedOccurrenceId, selectedOccurrenceId, "Inherited selected occurrence identity");
  const seriesEditReplay = await expectJson(
    await invokeSeriesMutation(session.access_token),
    200,
    "Idempotent recurring series split retry",
  );
  equal(seriesEditReplay.childSeriesEventId, seriesEdit.childSeriesEventId, "Replay preserves child series id");
  equal(seriesEditReplay.replayed, true, "Series split replay marker");

  const parentBoundary = sqlScalar(
    "SELECT recurrence_effective_through::text FROM public.calendar_event "
      + "WHERE id = '" + first.seriesEventId + "'::uuid AND owner_user_id = '" + profileId + "'::uuid",
  );
  equal(parentBoundary, selectedDate, "Previous series segment effective-through boundary");
  const childLineage = sqlScalar(
    "SELECT count(*) FROM public.calendar_event WHERE id = '" + seriesEdit.childSeriesEventId
      + "'::uuid AND owner_user_id = '" + profileId + "'::uuid "
      + "AND recurrence_parent_event_id = '" + first.seriesEventId + "'::uuid "
      + "AND recurrence_inherited_occurrence_id = '" + selectedOccurrenceId + "'::uuid "
      + "AND recurrence_effective_from = '" + selectedDate + "'::date "
      + "AND recurrence_rule->'excludedDates' @> jsonb_build_array('" + selectedDate + "')",
  );
  equal(childLineage, "1", "Child series lineage and inherited-slot exclusion");
  const inheritedSlot = sqlScalar(
    "SELECT count(*) FROM public.calendar_event_occurrence WHERE id = '" + selectedOccurrenceId
      + "'::uuid AND calendar_event_id = '" + first.seriesEventId + "'::uuid AND occurrence_status = 'scheduled'",
  );
  equal(inheritedSlot, "1", "Selected inherited occurrence remains on parent without duplication");
  const childOccurrenceCount = sqlScalar(
    "SELECT count(*) FROM public.calendar_event_occurrence WHERE calendar_event_id = '"
      + seriesEdit.childSeriesEventId + "'::uuid AND owner_user_id = '" + profileId + "'::uuid",
  );
  if (Number(childOccurrenceCount) < 1) fail("Series split did not persist any child occurrences.");
  const seriesEditAudit = sqlScalar(
    "SELECT count(*) FROM public.audit_event WHERE account_user_id = '" + profileId + "'::uuid "
      + "AND entity_type = 'calendar_event' AND entity_id = '" + first.seriesEventId + "'::uuid "
      + "AND action = 'calendar_event.recurrence_updated'",
  );
  if (Number(seriesEditAudit) < 1) fail("Series split did not append the recurrence audit record.");

  seriesMutationServer.kill("SIGTERM");
  await new Promise((resolve) => {
    if (seriesMutationServer.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    seriesMutationServer.once("exit", () => { clearTimeout(timeout); resolve(); });
  });

  console.log("PASS: real Auth JWT creates a recurring Event through the local Edge Runtime.");
  console.log("PASS: invalid API-key Bearer is rejected by the authenticated wrapper.");
  console.log("PASS: owner-scoped series + three occurrence rows persist; same-key create retry replays one identity.");
  console.log("PASS: authenticated rolling-horizon top-up restores a missing future slot once; retry inserts no duplicate.");
} finally {
  server.kill("SIGTERM");
  materializerServer?.kill("SIGTERM");
  occurrenceMutationServer?.kill("SIGTERM");
  seriesMutationServer?.kill("SIGTERM");
  await new Promise((resolve) => {
    const allStopped = () => server.exitCode !== null
      && (!materializerServer || materializerServer.exitCode !== null)
      && (!occurrenceMutationServer || occurrenceMutationServer.exitCode !== null)
      && (!seriesMutationServer || seriesMutationServer.exitCode !== null);
    if (allStopped()) return resolve();
    const timeout = setTimeout(resolve, 5000);
    const finish = () => { if (allStopped()) { clearTimeout(timeout); resolve(); } };
    server.once("exit", finish);
    materializerServer?.once("exit", finish);
    occurrenceMutationServer?.once("exit", finish);
    seriesMutationServer?.once("exit", finish);
  });
}
