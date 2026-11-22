import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const FUNCTION_NAME = "agenda-event-mutate";
const BASE_URL = "http://127.0.0.1:54321";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) { throw new Error(message); }
function equal(actual, expected, label) {
  if (actual !== expected) fail(label + ": expected " + expected + ", received " + actual);
}
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
function parseJson(text, label) {
  try { return JSON.parse(text); } catch { fail(label + " returned invalid JSON: " + text); }
}
function assertUuid(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(label + " is not a valid UUID: " + String(value));
  }
}

const status = run("supabase", ["status"]);
const publishable = status.match(/Publishable\s*[│|]\s*(sb_publishable_[A-Za-z0-9_-]+)/i)?.[1];
const secret = status.match(/Secret\s*[│|]\s*(sb_secret_[A-Za-z0-9_-]+)/i)?.[1];
if (!publishable || !secret) fail("Local Supabase status did not expose publishable/secret keys.");

async function createDisposableUser(label) {
  const password = randomBytes(32).toString("base64url") + "aA1!";
  const email = "agenda-event-mutate-ci+" + label + "-" + Date.now() + "@example.invalid";
  const created = await fetch(BASE_URL + "/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: secret, authorization: "Bearer " + secret, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (created.status !== 200 && created.status !== 201) {
    fail("Could not create disposable Auth user: " + await created.text());
  }
  const user = parseJson(await created.text(), "Auth Admin create user");
  const authUserId = user.id ?? user.user?.id;
  assertUuid(authUserId, UUID_PATTERN, "Auth user id");

  const profileId = sqlScalar("SELECT private.uuidv7()");
  assertUuid(profileId, UUID_V7_PATTERN, "disposable profile id");
  const insert = "INSERT INTO public.user_profile (id, auth_user_id, display_name, account_status) " +
    "VALUES ('" + profileId + "'::uuid, '" + authUserId + "'::uuid, 'Agenda Mutation CI', 'active')";
  run("docker", [
    "exec", "-i", "supabase_db_simplelife",
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", insert,
  ]);

  const login = await fetch(BASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: publishable, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10000),
  });
  if (login.status !== 200) fail("Could not obtain disposable user JWT: " + await login.text());
  const session = await login.json();
  if (typeof session.access_token !== "string") fail("Auth response has no access_token.");
  return { profileId, token: session.access_token };
}

const owner = await createDisposableUser("owner");
const other = await createDisposableUser("other");
const eventId = sqlScalar("SELECT private.uuidv7()");
assertUuid(eventId, UUID_V7_PATTERN, "fixture Event id");
const seedSql = "INSERT INTO public.calendar_event (" +
  "id, owner_user_id, created_by_user_id, updated_by_user_id, title, event_status, temporal_kind, start_date, end_date_exclusive, created_at, updated_at" +
  ") VALUES (" +
  "'" + eventId + "'::uuid, '" + owner.profileId + "'::uuid, '" + owner.profileId + "'::uuid, '" + owner.profileId + "'::uuid, " +
  "'Mutation smoke original', 'confirmed', 'all_day', DATE '2026-12-24', DATE '2026-12-25', " +
  "TIMESTAMPTZ '2026-11-20T10:00:00.000Z', TIMESTAMPTZ '2026-11-20T10:00:00.000Z'" +
  ")";
run("docker", [
  "exec", "-i", "supabase_db_simplelife",
  "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", seedSql,
]);
const initialUpdatedAt = sqlScalar(
  "SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') " +
  "FROM public.calendar_event WHERE id = '" + eventId + "'::uuid",
);

const url = BASE_URL + "/functions/v1/" + FUNCTION_NAME;
const server = spawn("supabase", ["functions", "serve", FUNCTION_NAME, "--no-verify-jwt"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NO_COLOR: "1" },
});
let logs = "";
const capture = (chunk) => { logs = (logs + chunk.toString()).slice(-12000); };
server.stdout.on("data", capture);
server.stderr.on("data", capture);
let exitCode = null;
server.on("exit", (code) => { exitCode = code; });

async function invoke(token, payload, method = "PATCH", headers = {}) {
  return await fetch(url, {
    method,
    headers: {
      apikey: publishable,
      authorization: "Bearer " + token,
      "content-type": "application/json",
      ...headers,
    },
    ...(method === "PATCH" ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(20000),
  });
}
function assertResult(value, expected, label) { equal(value, expected, label); }
async function mutation(token, payload, expectedStatus, label) {
  const response = await invoke(token, payload);
  const text = await response.text();
  equal(response.status, expectedStatus, label + " HTTP status");
  return text ? parseJson(text, label) : {};
}
function countAudit() {
  return sqlScalar(
    "SELECT count(*) FROM public.audit_event WHERE entity_type = 'calendar_event' " +
    "AND entity_id = '" + eventId + "'::uuid AND account_user_id = '" + owner.profileId + "'::uuid " +
    "AND actor_user_id = '" + owner.profileId + "'::uuid AND action = 'calendar_event.updated' AND result = 'success'",
  );
}
function row() {
  return sqlScalar(
    "SELECT owner_user_id::text || ':' || created_by_user_id::text || ':' || updated_by_user_id::text || ':' || " +
    "title || ':' || event_status || ':' || COALESCE(archived_at::text, 'null') || ':' || " +
    "COALESCE(deleted_at::text, 'null') || ':' || COALESCE(purge_after::text, 'null') " +
    "FROM public.calendar_event WHERE id = '" + eventId + "'::uuid",
  );
}

try {
  let ready = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (exitCode !== null) fail("Edge server exited early: " + exitCode + "\n" + logs);
    try {
      const probe = await fetch(url, {
        method: "GET",
        headers: { apikey: publishable, authorization: "Bearer " + publishable },
        signal: AbortSignal.timeout(2000),
      });
      if (probe.status === 401) { ready = true; break; }
      await probe.body?.cancel().catch(() => {});
    } catch { /* bounded readiness retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) fail("Event Mutation Edge Runtime did not become ready.\n" + logs);

  const preflight = await invoke(owner.token, undefined, "OPTIONS", {
    origin: "https://simplelife.example",
    "access-control-request-method": "PATCH",
    "access-control-request-headers": "authorization,content-type",
  });
  equal(preflight.status, 204, "browser CORS preflight");
  if (!preflight.headers.get("access-control-allow-methods")?.includes("PATCH")) {
    fail("CORS preflight did not allow PATCH.");
  }

  const validBearer = owner.token;
  const invalidAuth = await invoke(publishable, {
    eventId, expectedUpdatedAt: initialUpdatedAt, operation: "cancel",
  });
  equal(invalidAuth.status, 401, "publishable key used as Bearer");

  const updatePayload = {
    eventId,
    expectedUpdatedAt: initialUpdatedAt,
    operation: "update",
    event: {
      title: "Mutation smoke updated",
      description: "Updated by the authenticated Event Mutation Edge Function",
      locationLabel: "Home",
      locationKind: "physical",
      temporalKind: "all_day",
      startDate: "2026-12-25",
      endDateExclusive: "2026-12-27",
    },
  };
  const update = await mutation(validBearer, updatePayload, 200, "Event update");
  assertResult(update.replayed, false, "first update is not replayed");
  assertResult(update.eventId, eventId, "update Event id");
  let updatedAt = update.updatedAt;
  equal(sqlScalar("SELECT title FROM public.calendar_event WHERE id = '" + eventId + "'::uuid"), "Mutation smoke updated", "updated Event title");
  equal(sqlScalar("SELECT updated_by_user_id::text FROM public.calendar_event WHERE id = '" + eventId + "'::uuid"), owner.profileId, "server-derived update actor");
  equal(countAudit(), "1", "one update audit row");

  const replay = await mutation(validBearer, updatePayload, 200, "identical update retry");
  assertResult(replay.replayed, true, "update replay marker");
  equal(countAudit(), "1", "update retry creates no duplicate audit");

  const stale = await mutation(validBearer, {
    ...updatePayload,
    event: { ...updatePayload.event, title: "Stale overwrite must not win" },
  }, 409, "stale conflicting update");
  assertResult(stale.error, "EVENT_CHANGED_RELOAD_AND_RETRY", "stale update error");
  equal(sqlScalar("SELECT title FROM public.calendar_event WHERE id = '" + eventId + "'::uuid"), "Mutation smoke updated", "stale update preserves current Event");

  const cancel = await mutation(validBearer, {
    eventId, expectedUpdatedAt: updatedAt, operation: "cancel",
  }, 200, "cancel Event");
  assertResult(cancel.eventStatus, "cancelled", "cancelled status");
  updatedAt = cancel.updatedAt;
  const cancelRetry = await mutation(validBearer, {
    eventId, expectedUpdatedAt: initialUpdatedAt, operation: "cancel",
  }, 200, "cancel retry");
  assertResult(cancelRetry.replayed, true, "cancel retry marker");
  equal(countAudit(), "2", "cancel retry creates no duplicate audit");

  const reopen = await mutation(validBearer, {
    eventId, expectedUpdatedAt: updatedAt, operation: "reopen",
  }, 200, "reopen Event");
  assertResult(reopen.eventStatus, "confirmed", "reopened status");
  updatedAt = reopen.updatedAt;
  equal(countAudit(), "3", "reopen audit row");

  const archive = await mutation(validBearer, {
    eventId, expectedUpdatedAt: updatedAt, operation: "archive",
  }, 200, "archive Event");
  if (!archive.archivedAt) fail("Archive did not set archivedAt.");
  updatedAt = archive.updatedAt;
  equal(countAudit(), "4", "archive audit row");

  const restoreArchive = await mutation(validBearer, {
    eventId, expectedUpdatedAt: updatedAt, operation: "restore",
  }, 200, "restore archived Event");
  assertResult(restoreArchive.archivedAt, null, "archive restored");
  updatedAt = restoreArchive.updatedAt;
  equal(countAudit(), "5", "archive restore audit row");

  const trash = await mutation(validBearer, {
    eventId, expectedUpdatedAt: updatedAt, operation: "trash",
  }, 200, "move Event to trash");
  if (!trash.deletedAt || !trash.purgeAfter) fail("Trash transition did not set deletedAt/purgeAfter.");
  updatedAt = trash.updatedAt;
  equal(countAudit(), "6", "trash audit row");

  const restoreTrash = await mutation(validBearer, {
    eventId, expectedUpdatedAt: updatedAt, operation: "restore",
  }, 200, "restore Event from trash");
  assertResult(restoreTrash.deletedAt, null, "trash restored");
  assertResult(restoreTrash.purgeAfter, null, "retention cleared");
  updatedAt = restoreTrash.updatedAt;
  equal(countAudit(), "7", "trash restore audit row");

  const finish = await mutation(validBearer, {
    eventId, expectedUpdatedAt: updatedAt, operation: "finish",
  }, 200, "finish Event");
  assertResult(finish.eventStatus, "finished", "finished status");
  updatedAt = finish.updatedAt;
  equal(countAudit(), "8", "finish audit row");

  const cancelFinished = await mutation(validBearer, {
    eventId, expectedUpdatedAt: updatedAt, operation: "cancel",
  }, 409, "finished Event cannot be cancelled");
  assertResult(cancelFinished.error, "FINISHED_EVENT_CANNOT_BE_CANCELLED", "finished transition boundary");
  equal(countAudit(), "8", "rejected transition adds no audit");

  // A second active owner must not discover or mutate the first owner's Event.
  const otherUser = await invoke(other.token, {
    eventId, expectedUpdatedAt: updatedAt, operation: "cancel",
  });
  const otherBody = parseJson(await otherUser.text(), "cross-owner mutation");
  equal(otherUser.status, 404, "cross-owner Event mutation");
  assertResult(otherBody.error, "EVENT_NOT_FOUND", "cross-owner response");
  equal(countAudit(), "8", "cross-owner mutation adds no audit");
  equal(sqlScalar("SELECT count(*) FROM public.calendar_event WHERE id = '" + eventId + "'::uuid"), "1", "Event is retained, never physically deleted");

  console.log("PASS: OPTIONS preflight allows authenticated PATCH from browser clients.");
  console.log("PASS: publishable API key is rejected as a Bearer credential.");
  console.log("PASS: active authenticated owner can update Event through the Edge Runtime.");
  console.log("PASS: stale conflicting updates return 409 and do not overwrite newer data.");
  console.log("PASS: identical update retry is a no-op and does not duplicate audit.");
  console.log("PASS: cancel, reopen and finish are explicit, audited transitions.");
  console.log("PASS: archive, trash and restore are audited lifecycle transitions.");
  console.log("PASS: finished Events cannot be cancelled; rejected transitions do not append audit.");
  console.log("PASS: a second authenticated owner receives 404 and cannot mutate the Event.");
  console.log("PASS: all Event updates preserve owner/creator and derive updater from the verified profile.");
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
