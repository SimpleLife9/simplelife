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
function versionFor(eventId) {
  return sqlScalar(
    "SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') " +
    "FROM public.calendar_event WHERE id = '" + eventId + "'::uuid",
  );
}
function queryEvent(eventId) {
  return sqlScalar(
    "SELECT title || '|' || event_status || '|' || temporal_kind || '|' || " +
    "coalesce(archived_at::text,'NULL') || '|' || coalesce(deleted_at::text,'NULL') || '|' || " +
    "coalesce(purge_after::text,'NULL') || '|' || updated_by_user_id::text " +
    "FROM public.calendar_event WHERE id = '" + eventId + "'::uuid",
  );
}

const status = run("supabase", ["status"]);
const publishable = status.match(/Publishable\s*[│|]\s*(sb_publishable_[A-Za-z0-9_-]+)/i)?.[1];
const secret = status.match(/Secret\s*[│|]\s*(sb_secret_[A-Za-z0-9_-]+)/i)?.[1];
if (!publishable || !secret) fail("Local Supabase status did not expose publishable/secret keys.");

async function createUser(label) {
  const email = "agenda-event-mutate-" + label + "+" + Date.now() + "@example.invalid";
  const created = await fetch(base + "/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: secret, authorization: "Bearer " + secret, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (created.status !== 200 && created.status !== 201) fail("Could not create temporary Auth user: " + await created.text());
  const user = parseJson(await created.text(), "Auth Admin create user");
  const authUserId = user.id ?? user.user?.id;
  assertUuid(authUserId, UUID_PATTERN, "Auth user id");

  const profileId = sqlScalar("SELECT private.uuidv7()");
  assertUuid(profileId, UUID_V7_PATTERN, "disposable profile id");
  const profileInsertSql = "INSERT INTO public.user_profile (id, auth_user_id, display_name, account_status) " +
    "VALUES ('" + profileId + "'::uuid, '" + authUserId + "'::uuid, 'Agenda Mutation " + label + "', 'active')";
  run("docker", [
    "exec", "-i", "supabase_db_simplelife",
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", profileInsertSql,
  ]);

  const login = await fetch(base + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: publishable, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10000),
  });
  if (login.status !== 200) fail("Could not obtain temporary user JWT: " + await login.text());
  const session = await login.json();
  return { email, authUserId, profileId, accessToken: session.access_token };
}

const ownerA = await createUser("owner-a");
const ownerB = await createUser("owner-b");
const eventId = sqlScalar("SELECT private.uuidv7()");
assertUuid(eventId, UUID_V7_PATTERN, "seed Event id");
const seedSql =
  "INSERT INTO public.calendar_event (" +
  "id, owner_user_id, created_by_user_id, updated_by_user_id, title, event_status, temporal_kind, start_date, end_date_exclusive" +
  ") VALUES (" +
  "'" + eventId + "'::uuid, '" + ownerA.profileId + "'::uuid, '" + ownerA.profileId + "'::uuid, '" + ownerA.profileId + "'::uuid, " +
  "'Mutation smoke seed', 'confirmed', 'all_day', DATE '2026-12-24', DATE '2026-12-25')";
run("docker", [
  "exec", "-i", "supabase_db_simplelife",
  "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", seedSql,
]);

const server = spawn("supabase", ["functions", "serve", "agenda-event-mutate", "--no-verify-jwt"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NO_COLOR: "1" },
});
let logs = "";
const capture = (chunk) => { logs = (logs + chunk.toString()).slice(-12000); };
server.stdout.on("data", capture);
server.stderr.on("data", capture);
let exitCode = null;
server.on("exit", (code) => { exitCode = code; });

async function invoke(token, key, payload) {
  return await fetch(base + "/functions/v1/agenda-event-mutate", {
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
async function invokeMutation(token, action, expectedUpdatedAt, key, event = undefined) {
  return invoke(token, key, {
    eventId,
    expectedUpdatedAt,
    action,
    ...(event ? { event } : {}),
  });
}
function newKey() {
  const value = sqlScalar("SELECT private.uuidv7()");
  assertUuid(value, UUID_V7_PATTERN, "mutation idempotency key");
  return value;
}
async function assertSuccess(response, label) {
  const text = await response.text();
  equal(response.status, 200, label);
  return parseJson(text, label);
}
async function assertConflict(response, label, code) {
  const payload = parseJson(await response.text(), label);
  equal(response.status, 409, label + " status");
  equal(payload.error, code, label + " code");
  return payload;
}

try {
  let ready = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (exitCode !== null) fail("Event mutation Edge server exited early: " + exitCode + "\n" + logs);
    try {
      const probe = await fetch(base + "/functions/v1/agenda-event-mutate", {
        method: "GET",
        headers: { apikey: publishable, authorization: "Bearer " + publishable },
        signal: AbortSignal.timeout(2000),
      });
      if (probe.status === 401) { ready = true; break; }
      await probe.body?.cancel().catch(() => {});
    } catch { /* bounded readiness retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) fail("Event mutation Edge Runtime did not become ready.\n" + logs);

  const invalidBearer = await invoke(publishable, newKey(), {
    eventId,
    expectedUpdatedAt: versionFor(eventId),
    action: "cancel",
  });
  equal(invalidBearer.status, 401, "publishable key as Bearer");

  const originalVersion = versionFor(eventId);
  const editKey = newKey();
  const editIntent = {
    title: "Mutation smoke edited",
    description: "One authenticated edit",
    locationLabel: "Studio 3",
    locationKind: "physical",
    eventStatus: "confirmed",
    temporalKind: "all_day",
    startDate: "2026-12-25",
    endDateExclusive: "2026-12-27",
  };
  const edit = await assertSuccess(
    await invokeMutation(ownerA.accessToken, "edit", originalVersion, editKey, editIntent),
    "authenticated Event edit",
  );
  equal(edit.eventId, eventId, "edited Event ID");
  equal(edit.eventStatus, "confirmed", "edit preserves functional status");
  equal(edit.lifecycle, "active", "edit lifecycle");

  const replay = await assertSuccess(
    await invokeMutation(ownerA.accessToken, "edit", originalVersion, editKey, editIntent),
    "identical Event edit retry",
  );
  equal(replay.replayed, true, "edit replay marker");
  equal(replay.updatedAt, edit.updatedAt, "edit replay updated_at");

  const changedIntent = { ...editIntent, title: "Different title under same key" };
  await assertConflict(
    await invokeMutation(ownerA.accessToken, "edit", originalVersion, editKey, changedIntent),
    "same mutation key with changed intent",
    "IDEMPOTENCY_KEY_REUSED",
  );

  await assertConflict(
    await invokeMutation(ownerA.accessToken, "cancel", originalVersion, newKey()),
    "stale updated_at compare-and-swap",
    "EVENT_VERSION_CONFLICT",
  );

  let version = versionFor(eventId);
  const cancel = await assertSuccess(
    await invokeMutation(ownerA.accessToken, "cancel", version, newKey()),
    "Event cancellation",
  );
  equal(cancel.eventStatus, "cancelled", "cancel status");
  version = versionFor(eventId);

  const reopen = await assertSuccess(
    await invokeMutation(ownerA.accessToken, "reopen", version, newKey()),
    "Event reopen",
  );
  equal(reopen.eventStatus, "confirmed", "reopen status");
  version = versionFor(eventId);

  const archive = await assertSuccess(
    await invokeMutation(ownerA.accessToken, "archive", version, newKey()),
    "Event archive",
  );
  equal(archive.lifecycle, "archived", "archive lifecycle");
  version = versionFor(eventId);

  const restoreArchive = await assertSuccess(
    await invokeMutation(ownerA.accessToken, "restore", version, newKey()),
    "restore archived Event",
  );
  equal(restoreArchive.lifecycle, "active", "archive restored lifecycle");
  version = versionFor(eventId);

  const trash = await assertSuccess(
    await invokeMutation(ownerA.accessToken, "trash", version, newKey()),
    "Event logical trash",
  );
  equal(trash.lifecycle, "trash", "trash lifecycle");
  const retention = sqlScalar(
    "SELECT CASE WHEN purge_after = deleted_at + interval '30 days' THEN 'PASS' ELSE 'FAIL' END " +
    "FROM public.calendar_event WHERE id = '" + eventId + "'::uuid",
  );
  equal(retention, "PASS", "30-day logical retention");
  version = versionFor(eventId);

  const restoreTrash = await assertSuccess(
    await invokeMutation(ownerA.accessToken, "restore", version, newKey()),
    "restore trashed Event",
  );
  equal(restoreTrash.lifecycle, "active", "trashed Event restored lifecycle");
  version = versionFor(eventId);

  const finish = await assertSuccess(
    await invokeMutation(ownerA.accessToken, "finish", version, newKey()),
    "finish Event",
  );
  equal(finish.eventStatus, "finished", "finished functional status");
  version = versionFor(eventId);

  await assertConflict(
    await invokeMutation(ownerA.accessToken, "cancel", version, newKey()),
    "finished Event cannot be cancelled",
    "EVENT_CANNOT_BE_CANCELLED",
  );

  const beforeCrossOwner = queryEvent(eventId);
  const crossOwner = await invokeMutation(ownerB.accessToken, "cancel", versionFor(eventId), newKey());
  equal(crossOwner.status, 404, "cross-owner Event mutation hidden as not found");
  equal(queryEvent(eventId), beforeCrossOwner, "cross-owner mutation cannot change the Event");

  const finalRow = queryEvent(eventId);
  if (!finalRow.startsWith("Mutation smoke edited|finished|all_day|NULL|NULL|NULL|" + ownerA.profileId)) {
    fail("Event final row did not match the expected active state: " + finalRow);
  }
  const auditCount = sqlScalar(
    "SELECT count(*) FROM public.audit_event WHERE entity_type = 'calendar_event' AND entity_id = '" + eventId + "'::uuid",
  );
  equal(auditCount, "9", "creation plus eight audited Event mutations");
  const receiptCountA = sqlScalar(
    "SELECT count(*) FROM public.event_mutation_request WHERE owner_user_id = '" + ownerA.profileId + "'::uuid",
  );
  equal(receiptCountA, "10", "owner A mutation receipts including stale and terminal-state conflicts");
  const receiptCountB = sqlScalar(
    "SELECT count(*) FROM public.event_mutation_request WHERE owner_user_id = '" + ownerB.profileId + "'::uuid",
  );
  equal(receiptCountB, "1", "owner B sees only its own 404 receipt");

  console.log("PASS: publishable API key cannot authenticate as an Event mutation user.");
  console.log("PASS: Auth-issued JWT edits only its owner-scoped Event through the atomic RPC.");
  console.log("PASS: edit replay returns the original receipt without a duplicate audit row.");
  console.log("PASS: reusing the mutation key with changed intent returns HTTP 409.");
  console.log("PASS: stale updated_at returns HTTP 409 and never overwrites newer data.");
  console.log("PASS: cancel, reopen and finish update functional status without changing Event identity.");
  console.log("PASS: finished Events cannot be cancelled and rejected transitions append no audit.");
  console.log("PASS: archive and restore operate independently from functional status.");
  console.log("PASS: trash creates a recoverable 30-day logical tombstone; restore does not physically delete.");
  console.log("PASS: a second authenticated owner receives 404 and cannot mutate the first owner's Event.");
  console.log("PASS: exactly one audit row exists for Event create and each of eight meaningful updates.");
  console.log("PASS: mutation receipts remain isolated by owner.");
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
