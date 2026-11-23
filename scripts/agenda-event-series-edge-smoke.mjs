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
      count: 2,
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
  equal(first.materializedCount, 2, "Materialized occurrence count");
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
  equal(storedOccurrences, "2", "Exactly two persisted occurrences after retry");

  console.log("PASS: real Auth JWT creates a recurring Event through the local Edge Runtime.");
  console.log("PASS: invalid API-key Bearer is rejected by the authenticated wrapper.");
  console.log("PASS: owner-scoped series + two occurrence rows persist; same-key retry replays one identity without duplicates.");
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
