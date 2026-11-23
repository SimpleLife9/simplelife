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
function newKey() { return newUuid(); }
function scheduleVersion(id) {
  return sqlScalar(
    "SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') " +
    "FROM public.task_schedule WHERE id = '" + id + "'::uuid",
  );
}
function taskStatus(id) {
  return sqlScalar("SELECT status FROM public.task WHERE id = '" + id + "'::uuid");
}
function createTask(profileId, label) {
  const id = newUuid();
  const statement = "INSERT INTO public.task (id, owner_user_id, created_by_user_id, action, status, time_zone) " +
    "VALUES ('" + id + "'::uuid, '" + profileId + "'::uuid, '" + profileId + "'::uuid, '" +
    label.replace(/'/g, "''") + "', 'todo', 'America/Havana')";
  run("docker", [
    "exec", "-i", "supabase_db_simplelife", "psql", "-v", "ON_ERROR_STOP=1",
    "-U", "postgres", "-d", "postgres", "-c", statement,
  ]);
  return id;
}

const status = run("supabase", ["status"]);
const publishable = status.match(/Publishable\s*[│|]\s*(sb_publishable_[A-Za-z0-9_-]+)/i)?.[1];
const secret = status.match(/Secret\s*[│|]\s*(sb_secret_[A-Za-z0-9_-]+)/i)?.[1];
if (!publishable || !secret) fail("Local Supabase status did not expose publishable/secret keys.");

async function createUser(label) {
  const email = "agenda-task-schedule-" + label + "+" + Date.now() + "@example.invalid";
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
  const profileId = newUuid();
  const profileSql = "INSERT INTO public.user_profile (id, auth_user_id, display_name, account_status) " +
    "VALUES ('" + profileId + "'::uuid, '" + authUserId + "'::uuid, 'TaskSchedule " + label + "', 'active')";
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
const taskA = createTask(ownerA.profileId, "TaskSchedule QA task A");
const taskB = createTask(ownerB.profileId, "TaskSchedule QA task B");

const server = spawn("supabase", ["functions", "serve", "agenda-task-schedule-mutate", "--no-verify-jwt"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NO_COLOR: "1" },
});
let logs = "";
const capture = (chunk) => { logs = (logs + chunk.toString()).slice(-16000); };
server.stdout.on("data", capture);
server.stderr.on("data", capture);
let exitCode = null;
server.on("exit", (code) => { exitCode = code; });

async function invoke(token, key, payload) {
  return await fetch(base + "/functions/v1/agenda-task-schedule-mutate", {
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
function createPayload(taskId, start = "2026-11-24T09:00", end = "2026-11-24T10:00") {
  return {
    action: "create",
    taskId,
    schedule: {
      startLocalDateTime: start,
      endLocalDateTime: end,
      timeZone: "America/Havana",
      startDisambiguation: "earlier",
      endDisambiguation: "earlier",
    },
  };
}
async function readVisibleSchedules(token) {
  const response = await fetch(
    base + "/rest/v1/task_schedule?select=id,task_id,owner_user_id&order=id.asc",
    { headers: { apikey: publishable, authorization: "Bearer " + token, accept: "application/json" } },
  );
  return await expectStatus(response, 200, "TaskSchedule RLS read");
}

try {
  let ready = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (exitCode !== null) fail("TaskSchedule Edge server exited early: " + exitCode + "\n" + logs);
    try {
      const probe = await fetch(base + "/functions/v1/agenda-task-schedule-mutate", {
        method: "GET",
        headers: { apikey: publishable, authorization: "Bearer " + publishable },
        signal: AbortSignal.timeout(2000),
      });
      if (probe.status === 401) { ready = true; break; }
      await probe.body?.cancel().catch(() => {});
    } catch { /* bounded readiness retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) fail("TaskSchedule Edge Runtime did not become ready.\n" + logs);

  const invalidBearer = await invoke(publishable, newKey(), createPayload(taskA));
  equal(invalidBearer.status, 401, "publishable key as Bearer");

  // Two concurrent requests with one owner/key/intent may generate different
  // provisional IDs, but both must receive the one committed TaskSchedule.
  const createKey = newKey();
  const race = await Promise.all([
    invoke(ownerA.accessToken, createKey, createPayload(taskA)),
    invoke(ownerA.accessToken, createKey, createPayload(taskA)),
  ]);
  const raced = await Promise.all(race.map((response, index) =>
    expectStatus(response, 201, "concurrent TaskSchedule create " + index)
  ));
  const scheduleId = raced[0].taskScheduleId;
  assertUuid(scheduleId, UUID_V7_PATTERN, "created TaskSchedule id");
  equal(raced[1].taskScheduleId, scheduleId, "concurrent caller receives winning identity");
  equal(raced[0].replayed || raced[1].replayed, true, "one racing caller receives replay");

  const replay = await expectStatus(
    await invoke(ownerA.accessToken, createKey, createPayload(taskA)),
    201,
    "identical TaskSchedule retry",
  );
  equal(replay.taskScheduleId, scheduleId, "replayed TaskSchedule id");
  equal(replay.replayed, true, "replay marker");
  await expectConflict(
    await invoke(ownerA.accessToken, createKey, createPayload(taskA, "2026-11-24T11:00", "2026-11-24T12:00")),
    "IDEMPOTENCY_KEY_REUSED",
    "same key with changed TaskSchedule intent",
  );

  const originalVersion = scheduleVersion(scheduleId);
  const edited = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), {
      action: "edit",
      taskScheduleId: scheduleId,
      expectedUpdatedAt: originalVersion,
      schedule: {
        startLocalDateTime: "2026-11-24T10:00",
        endLocalDateTime: "2026-11-24T11:00",
        timeZone: "America/Havana",
        startDisambiguation: "earlier",
        endDisambiguation: "earlier",
      },
    }),
    200,
    "TaskSchedule optimistic edit",
  );
  equal(edited.taskScheduleId, scheduleId, "edit identity");
  await expectConflict(
    await invoke(ownerA.accessToken, newKey(), {
      action: "edit",
      taskScheduleId: scheduleId,
      expectedUpdatedAt: originalVersion,
      schedule: {
        startLocalDateTime: "2026-11-24T11:00",
        endLocalDateTime: "2026-11-24T12:00",
        timeZone: "America/Havana",
        startDisambiguation: "earlier",
        endDisambiguation: "earlier",
      },
    }),
    "TASK_SCHEDULE_VERSION_CONFLICT",
    "stale TaskSchedule edit",
  );

  let version = scheduleVersion(scheduleId);
  const confirmed = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), {
      action: "confirm", taskScheduleId: scheduleId, expectedUpdatedAt: version,
    }),
    200,
    "TaskSchedule confirm",
  );
  equal(confirmed.scheduleStatus, "confirmed", "confirmed status");
  version = scheduleVersion(scheduleId);
  const cancelled = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), {
      action: "cancel", taskScheduleId: scheduleId, expectedUpdatedAt: version,
    }),
    200,
    "TaskSchedule cancel",
  );
  equal(cancelled.scheduleStatus, "cancelled", "cancelled status");

  const second = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), createPayload(taskA, "2026-11-25T09:00", "2026-11-25T10:00")),
    201,
    "second TaskSchedule on one Task",
  );
  version = scheduleVersion(second.taskScheduleId);
  const secondConfirmed = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), {
      action: "confirm", taskScheduleId: second.taskScheduleId, expectedUpdatedAt: version,
    }),
    200,
    "second reservation confirm",
  );
  version = scheduleVersion(second.taskScheduleId);
  const released = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), {
      action: "release", taskScheduleId: second.taskScheduleId, expectedUpdatedAt: version,
    }),
    200,
    "TaskSchedule release",
  );
  equal(released.scheduleStatus, "released", "released reservation state");

  const third = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), createPayload(taskA, "2026-11-26T09:00", "2026-11-26T10:00")),
    201,
    "third TaskSchedule on one Task",
  );
  version = scheduleVersion(third.taskScheduleId);
  await expectStatus(
    await invoke(ownerA.accessToken, newKey(), {
      action: "confirm", taskScheduleId: third.taskScheduleId, expectedUpdatedAt: version,
    }),
    200,
    "third reservation confirm",
  );
  version = scheduleVersion(third.taskScheduleId);
  const elapsed = await expectStatus(
    await invoke(ownerA.accessToken, newKey(), {
      action: "elapsed", taskScheduleId: third.taskScheduleId, expectedUpdatedAt: version,
    }),
    200,
    "TaskSchedule elapsed",
  );
  equal(elapsed.scheduleStatus, "elapsed", "elapsed reservation state");

  await expectConflict(
    await invoke(ownerA.accessToken, newKey(), createPayload(taskB)),
    "TASK_NOT_SCHEDULABLE",
    "cross-owner Task scheduling",
  );

  const ownerBRow = await expectStatus(
    await invoke(ownerB.accessToken, newKey(), createPayload(taskB)),
    201,
    "owner B TaskSchedule create",
  );

  const ownerAVisible = await readVisibleSchedules(ownerA.accessToken);
  equal(ownerAVisible.length, 3, "owner A sees exactly three reservations");
  if (ownerAVisible.some((row) => row.owner_user_id !== ownerA.profileId)) {
    fail("Owner A RLS returned a foreign TaskSchedule.");
  }
  const ownerBVisible = await readVisibleSchedules(ownerB.accessToken);
  equal(ownerBVisible.length, 1, "owner B sees exactly one reservation");
  equal(ownerBVisible[0].id, ownerBRow.taskScheduleId, "owner B sees own TaskSchedule only");

  const directWrite = await fetch(base + "/rest/v1/task_schedule", {
    method: "POST",
    headers: {
      apikey: publishable,
      authorization: "Bearer " + ownerA.accessToken,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({ id: newUuid(), task_id: taskA, schedule_status: "proposed" }),
  });
  if (![401, 403].includes(directWrite.status)) {
    fail("Authenticated direct TaskSchedule write must be denied; got " + directWrite.status + ": " + await directWrite.text());
  }

  equal(taskStatus(taskA), "todo", "original Task A status remains unchanged");
  equal(taskStatus(taskB), "todo", "original Task B status remains unchanged");

  const auditA = sqlScalar(
    "SELECT count(*) FROM public.audit_event WHERE entity_type = 'task_schedule' " +
    "AND account_user_id = '" + ownerA.profileId + "'::uuid",
  );
  equal(auditA, "10", "TaskSchedule create/edit/status append-only audit count");
  const auditB = sqlScalar(
    "SELECT count(*) FROM public.audit_event WHERE entity_type = 'task_schedule' " +
    "AND account_user_id = '" + ownerB.profileId + "'::uuid",
  );
  equal(auditB, "1", "owner B TaskSchedule audit count");

  console.log("PASS: real Auth JWT creates TaskSchedules through the authenticated Edge Runtime.");
  console.log("PASS: concurrent create/idempotent replay returns one TaskSchedule identity; changed intent reuses 409.");
  console.log("PASS: IANA civil-time resolution, edit CAS, confirm/cancel/release/elapsed lifecycle work.");
  console.log("PASS: multiple reservations preserve the same Task identity and execution status.");
  console.log("PASS: cross-owner Task references and direct browser writes are denied.");
  console.log("PASS: RLS isolates two owners; mutation audit is appended for every successful change.");
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
