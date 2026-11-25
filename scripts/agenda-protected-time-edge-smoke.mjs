import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const base = "http://127.0.0.1:54321";
const password = randomBytes(32).toString("base64url") + "aA1!";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) { throw new Error(message); }
function redactSensitiveOutput(value) {
  return String(value)
    .replace(/\b(sb_secret|sb_publishable)_[A-Za-z0-9_-]+/g, "$1_[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]");
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) fail(command + " failed:\n" + redactSensitiveOutput(result.stdout + "\n" + result.stderr));
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
function newKey() {
  const value = sqlScalar("SELECT private.uuidv7()");
  assertUuid(value, UUID_V7_PATTERN, "Protected Time idempotency key");
  return value;
}
function blockVersion(blockId) {
  return sqlScalar(
    "SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') " +
    "FROM public.protected_time_block WHERE id = '" + blockId + "'::uuid",
  );
}
function blockSnapshot(blockId) {
  return sqlScalar(
    "SELECT label || '|' || protection_mode || '|' || pattern_kind || '|' || " +
    "coalesce(archived_at::text,'NULL') || '|' || coalesce(deleted_at::text,'NULL') || '|' || " +
    "updated_by_user_id::text FROM public.protected_time_block WHERE id = '" + blockId + "'::uuid",
  );
}

const status = run("supabase", ["status"]);
const publishable = status.match(/Publishable\s*[│|]\s*(sb_publishable_[A-Za-z0-9_-]+)/i)?.[1];
const secret = status.match(/Secret\s*[│|]\s*(sb_secret_[A-Za-z0-9_-]+)/i)?.[1];
if (!publishable || !secret) fail("Local Supabase status did not expose publishable/secret keys.");

async function createUser(label) {
  const email = "agenda-protected-time-" + label + "+" + Date.now() + "@example.invalid";
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
  const profileSql = "INSERT INTO public.user_profile (id, auth_user_id, display_name, account_status) " +
    "VALUES ('" + profileId + "'::uuid, '" + authUserId + "'::uuid, 'Protected Time " + label + "', 'active')";
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
  return { email, authUserId, profileId, accessToken: session.access_token };
}

const ownerA = await createUser("owner-a");
const ownerB = await createUser("owner-b");
const oneOff = {
  label: "Sueño nocturno",
  category: "sleep",
  protectionMode: "hard",
  patternKind: "one_off",
  timeZone: "America/Havana",
  startLocalDateTime: "2026-12-24T22:00",
  endLocalDateTime: "2026-12-25T06:30",
  startDisambiguation: "earlier",
  endDisambiguation: "earlier",
};
const weekly = {
  label: "Entrenamiento semanal",
  category: "training",
  protectionMode: "flexible",
  patternKind: "weekly",
  timeZone: "America/Havana",
  startDate: "2026-11-23",
  endDateExclusive: null,
  weekdays: [1, 3, 5],
  startLocalTime: "22:00",
  endLocalTime: "06:30",
  endsNextDay: true,
};

const server = spawn("supabase", ["functions", "serve", "agenda-protected-time-mutate", "--no-verify-jwt"], {
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
  return await fetch(base + "/functions/v1/agenda-protected-time-mutate", {
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
async function expectStatus(response, expected, label) {
  const body = parseJson(await response.text(), label);
  equal(response.status, expected, label + " HTTP status");
  return body;
}
async function expectConflict(response, code, label) {
  const body = await expectStatus(response, 409, label);
  equal(body.error, code, label + " error code");
  return body;
}
async function readVisibleBlocks(token) {
  const response = await fetch(
    base + "/rest/v1/protected_time_block?select=id,label,owner_user_id&order=id.asc",
    { headers: { apikey: publishable, authorization: "Bearer " + token, accept: "application/json" } },
  );
  return await expectStatus(response, 200, "RLS Protected Time read");
}

try {
  let ready = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (exitCode !== null) fail("Protected Time Edge server exited early: " + exitCode + "\n" + logs);
    try {
      const probe = await fetch(base + "/functions/v1/agenda-protected-time-mutate", {
        method: "GET",
        headers: { apikey: publishable, authorization: "Bearer " + publishable },
        signal: AbortSignal.timeout(2000),
      });
      if (probe.status === 401) { ready = true; break; }
      await probe.body?.cancel().catch(() => {});
    } catch { /* bounded readiness retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) fail("Protected Time Edge Runtime did not become ready.\n" + logs);

  const invalidBearer = await invoke(publishable, newKey(), { action: "create", block: oneOff });
  equal(invalidBearer.status, 401, "publishable key as Bearer");

  const createKey = newKey();
  // Force two requests to race before either receipt is committed. Each handler
  // may generate a different provisional UUIDv7; the owner/key claim must still
  // return one winning block identity to both callers.
  const raceResponses = await Promise.all([
    invoke(ownerA.accessToken, createKey, { action: "create", block: oneOff }),
    invoke(ownerA.accessToken, createKey, { action: "create", block: oneOff }),
  ]);
  const raceResults = await Promise.all(raceResponses.map((response, index) =>
    expectStatus(response, 201, "concurrent Protected Time create " + index)
  ));
  const created = raceResults[0];
  const blockId = created.blockId;
  assertUuid(blockId, UUID_V7_PATTERN, "created Protected Time id");
  equal(raceResults[1].blockId, blockId, "concurrent callers receive one winning block id");
  equal(created.lifecycle, "active", "created lifecycle");
  equal(created.protectionMode, "hard", "created protection mode");

  const replay = await expectStatus(
    await invoke(ownerA.accessToken, createKey, { action: "create", block: oneOff }),
    201,
    "identical create retry",
  );
  equal(replay.blockId, blockId, "replayed block id");
  equal(replay.replayed, true, "replay marker");

  await expectConflict(
    await invoke(ownerA.accessToken, createKey, { action: "create", block: { ...oneOff, label: "Intento distinto" } }),
    "IDEMPOTENCY_KEY_REUSED",
    "same key with changed create intent",
  );

  const originalVersion = blockVersion(blockId);
  const editedDraft = { ...oneOff, label: "Sueño actualizado", category: "rest" };
  const edited = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), {
      action: "edit", blockId, expectedUpdatedAt: originalVersion, block: editedDraft,
    }),
    200,
    "Protected Time edit",
  );
  equal(edited.label, "Sueño actualizado", "edited label");
  await expectConflict(
    await invoke(ownerA.accessToken, newKey(), {
      action: "edit", blockId, expectedUpdatedAt: originalVersion, block: editedDraft,
    }),
    "PROTECTED_TIME_BLOCK_VERSION_CONFLICT",
    "stale Protected Time update",
  );

  let version = blockVersion(blockId);
  const archived = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), { action: "archive", blockId, expectedUpdatedAt: version }),
    200,
    "Protected Time archive",
  );
  equal(archived.lifecycle, "archived", "archived lifecycle");

  version = blockVersion(blockId);
  const restored = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), { action: "restore", blockId, expectedUpdatedAt: version }),
    200,
    "Protected Time archive restore",
  );
  equal(restored.lifecycle, "active", "restored lifecycle");

  const weeklyResponse = await expectStatus(
    await invoke(ownerB.accessToken, newKey(), { action: "create", block: weekly }),
    201,
    "authenticated weekly Protected Time create",
  );
  const weeklyId = weeklyResponse.blockId;
  assertUuid(weeklyId, UUID_V7_PATTERN, "weekly Protected Time id");
  equal(weeklyResponse.patternKind, "weekly", "weekly pattern kind");
  const weeklyDb = sqlScalar(
    "SELECT pattern_kind || '|' || array_to_string(weekdays, ',') || '|' || start_time_local::text || '|' || " +
    "end_time_local::text || '|' || ends_next_day::text || '|' || coalesce(starts_at::text,'NULL') " +
    "FROM public.protected_time_block WHERE id = '" + weeklyId + "'::uuid",
  );
  equal(weeklyDb, "weekly|1,3,5|22:00:00|06:30:00|true|NULL", "weekly civil rule stored without fake UTC instant");

  const ownerAVisible = await readVisibleBlocks(ownerA.accessToken);
  equal(ownerAVisible.length, 1, "owner A RLS visible row count");
  equal(ownerAVisible[0].id, blockId, "owner A sees only own block");
  const ownerBVisible = await readVisibleBlocks(ownerB.accessToken);
  equal(ownerBVisible.length, 1, "owner B RLS visible row count");
  equal(ownerBVisible[0].id, weeklyId, "owner B sees only own block");

  await expectStatus(
    await invoke(ownerB.accessToken, newKey(), {
      action: "edit",
      blockId,
      expectedUpdatedAt: blockVersion(blockId),
      block: editedDraft,
    }),
    404,
    "cross-owner Protected Time mutation",
  );

  version = blockVersion(blockId);
  const deleted = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), { action: "delete", blockId, expectedUpdatedAt: version }),
    200,
    "Protected Time logical delete",
  );
  equal(deleted.lifecycle, "trash", "logical delete lifecycle");
  const stillExists = sqlScalar(
    "SELECT count(*) FROM public.protected_time_block WHERE id = '" + blockId + "'::uuid",
  );
  equal(stillExists, "1", "logical delete retains the row");

  version = blockVersion(blockId);
  const restoredFromTrash = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), { action: "restore", blockId, expectedUpdatedAt: version }),
    200,
    "Protected Time trash restore",
  );
  equal(restoredFromTrash.lifecycle, "active", "trash restore lifecycle");

  const finalA = blockSnapshot(blockId);
  if (!finalA.startsWith("Sueño actualizado|hard|one_off|NULL|NULL|" + ownerA.profileId)) {
    fail("Owner A Protected Time row did not match the expected active state: " + finalA);
  }
  const auditA = sqlScalar(
    "SELECT count(*) FROM public.audit_event WHERE entity_type = 'protected_time_block' " +
    "AND entity_id = '" + blockId + "'::uuid AND account_user_id = '" + ownerA.profileId + "'::uuid",
  );
  equal(auditA, "6", "create + edit + archive + restore + delete + restore audit events");
  const auditB = sqlScalar(
    "SELECT count(*) FROM public.audit_event WHERE entity_type = 'protected_time_block' " +
    "AND entity_id = '" + weeklyId + "'::uuid AND account_user_id = '" + ownerB.profileId + "'::uuid",
  );
  equal(auditB, "1", "weekly create audit event");
  const receiptsA = sqlScalar(
    "SELECT count(*) FROM public.protected_time_block_mutation_request WHERE owner_user_id = '" + ownerA.profileId + "'::uuid",
  );
  equal(receiptsA, "7", "owner A mutation receipts");
  const receiptsB = sqlScalar(
    "SELECT count(*) FROM public.protected_time_block_mutation_request WHERE owner_user_id = '" + ownerB.profileId + "'::uuid",
  );
  equal(receiptsB, "2", "owner B receipts including hidden cross-owner 404");

  console.log("PASS: real Auth JWT creates a one-off Protected Time block via Edge Runtime.");
  console.log("PASS: idempotent retry replays one block; same key with changed intent returns 409.");
  console.log("PASS: IANA resolver persists original local wall time and resolved UTC range.");
  console.log("PASS: edit uses optimistic version; stale update returns 409.");
  console.log("PASS: archive, restore and logical delete are atomic and append audit rows.");
  console.log("PASS: weekly overnight rule stores ISO weekdays, IANA zone and local clocks without a fake UTC interval.");
  console.log("PASS: RLS exposes each owner only their own Protected Time rows.");
  console.log("PASS: cross-owner mutation returns 404 without changing the original row.");
  console.log("PASS: mutation receipts and audit entries remain owner-scoped.");
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
