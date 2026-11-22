import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const name = "agenda-event-create";
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
function equal(actual, expected, label) {
  if (actual !== expected) fail(label + ": expected " + expected + ", received " + actual);
}
function parseJson(text, label) {
  try { return JSON.parse(text); } catch { fail(label + " returned invalid JSON: " + text); }
}
function sqlScalar(sql) {
  return run("docker", [
    "exec", "-i", "supabase_db_simplelife",
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-Atqc", sql,
  ]).trim();
}
function assertUuid(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) fail(label + " is not a valid UUID: " + String(value));
}

const status = run("supabase", ["status"]);
const publishable = status.match(/Publishable\s*[│|]\s*(sb_publishable_[A-Za-z0-9_-]+)/i)?.[1];
const secret = status.match(/Secret\s*[│|]\s*(sb_secret_[A-Za-z0-9_-]+)/i)?.[1];
if (!publishable || !secret) fail("Local Supabase status did not expose publishable/secret keys.");

const email = "agenda-event-create-edge-ci+" + Date.now() + "@example.invalid";
const created = await fetch(base + "/auth/v1/admin/users", {
  method: "POST",
  headers: { apikey: secret, authorization: "Bearer " + secret, "content-type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true }),
  signal: AbortSignal.timeout(10000),
});
if (created.status !== 200 && created.status !== 201) fail("Could not create temporary Auth user: " + await created.text());
const createdUser = parseJson(await created.text(), "Auth Admin create user");
const authUserId = createdUser.id ?? createdUser.user?.id;
assertUuid(authUserId, UUID_PATTERN, "Auth user id");

// A profile is deliberately provisioned only in this disposable local database.
// The real Edge Function must still resolve it through the verified user's JWT
// and RLS-scoped client; no owner/actor identifier is accepted from request JSON.
const profileId = sqlScalar("SELECT private.uuidv7()");
assertUuid(profileId, UUID_V7_PATTERN, "disposable profile id");
// Both interpolated values are constrained to canonical UUID characters above;
 // psql -c sends SQL directly and does not perform psql variable substitution.
const profileInsertSql = "INSERT INTO public.user_profile (id, auth_user_id, display_name, account_status) " +
  "VALUES ('" + profileId + "'::uuid, '" + authUserId + "'::uuid, 'Agenda Edge CI', 'active')";
run("docker", [
  "exec", "-i", "supabase_db_simplelife",
  "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
  "-c", profileInsertSql,
]);

const idempotencyKey = sqlScalar("SELECT private.uuidv7()");
assertUuid(idempotencyKey, UUID_V7_PATTERN, "Event idempotency key");

const protectedBlockId = sqlScalar("SELECT private.uuidv7()");
assertUuid(protectedBlockId, UUID_V7_PATTERN, "Protected Time block id");
const protectedBlockSql =
  "INSERT INTO public.protected_time_block (" +
  "id, owner_user_id, created_by_user_id, updated_by_user_id, label, category, " +
  "protection_mode, pattern_kind, time_zone, start_local, end_local, starts_at, ends_at, " +
  "start_disambiguation, end_disambiguation, start_gap_strategy, end_gap_strategy, resolver_metadata" +
  ") VALUES (" +
  "'" + protectedBlockId + "'::uuid, '" + profileId + "'::uuid, '" + profileId + "'::uuid, '" + profileId + "'::uuid, " +
  "'CI hard protected sleep', 'health', 'hard', 'one_off', 'America/Havana', " +
  "TIMESTAMP '2026-12-24 01:00:00', TIMESTAMP '2026-12-24 02:00:00', " +
  "TIMESTAMPTZ '2026-12-24 06:00:00+00', TIMESTAMPTZ '2026-12-24 07:00:00+00', " +
  "'earlier', 'earlier', 'next-valid', 'next-valid', " +
  "jsonb_build_object('rulesSource','iana-tzdb','rulesVersion','2026f'," +
  "'resolverVersion','agenda-iana-resolver-v1','authoritative',true))";
run("docker", [
  "exec", "-i", "supabase_db_simplelife",
  "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
  "-c", protectedBlockSql,
]);

const login = await fetch(base + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: publishable, "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
  signal: AbortSignal.timeout(10000),
});
if (login.status !== 200) fail("Could not obtain temporary user JWT: " + await login.text());
const session = await login.json();

const url = base + "/functions/v1/" + name;
const server = spawn("supabase", ["functions", "serve", name, "--no-verify-jwt"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NO_COLOR: "1" },
});
let logs = "";
const capture = (chunk) => { logs = (logs + chunk.toString()).slice(-12000); };
server.stdout.on("data", capture);
server.stderr.on("data", capture);
let exitCode = null;
server.on("exit", (code) => { exitCode = code; });

async function invoke(token, key, event, protectedTimeDecisions = undefined) {
  return await fetch(url, {
    method: "POST",
    headers: {
      apikey: publishable,
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({
      event,
      ...(protectedTimeDecisions === undefined ? {} : { protectedTimeDecisions }),
    }),
    signal: AbortSignal.timeout(20000),
  });
}

const event = {
  title: "CI authenticated Event create",
  description: "Disposable Edge Runtime end-to-end fixture",
  temporalKind: "all_day",
  startDate: "2026-12-24",
  endDateExclusive: "2026-12-25",
};

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
  if (!ready) fail("Event Create Edge Runtime did not become ready.\n" + logs);

  const keyAsBearer = await invoke(publishable, idempotencyKey, event);
  equal(keyAsBearer.status, 401, "publishable key as Bearer");
  const malformed = await invoke("not.a.valid.jwt", idempotencyKey, event);
  equal(malformed.status, 401, "malformed JWT");

  // A hard overlap must return conflicts before the idempotency receipt is claimed.
  const blockedResponse = await invoke(session.access_token, idempotencyKey, event);
  const blockedPayload = parseJson(await blockedResponse.text(), "Protected Time conflict");
  equal(blockedResponse.status, 409, "hard Protected Time overlap");
  equal(blockedPayload.error, "PROTECTED_TIME_CONFLICTS", "hard conflict code");
  equal(blockedPayload.conflicts.length, 1, "one hard Protected Time conflict");
  equal(blockedPayload.conflicts[0].blockId, protectedBlockId, "server-derived conflict block");
  equal(blockedPayload.conflicts[0].requiredDecision, "override_hard", "hard override required");
  equal(sqlScalar(
    "SELECT count(*) FROM public.event_create_request WHERE owner_user_id = '" + profileId + "'::uuid " +
    "AND idempotency_key = '" + idempotencyKey + "'::uuid",
  ), "0", "blocked Event create must not claim a receipt");

  const conflict = blockedPayload.conflicts[0];
  const decisions = [{
    blockId: conflict.blockId,
    blockUpdatedAt: conflict.blockUpdatedAt,
    occurrenceStartsAt: conflict.occurrenceStartsAt,
    decision: "override_hard",
  }];
  const firstResponse = await invoke(session.access_token, idempotencyKey, event, decisions);
  const firstText = await firstResponse.text();
  equal(firstResponse.status, 201, "Event create after explicit hard override");
  const first = parseJson(firstText, "first authorized Event create");
  assertUuid(first.eventId, UUID_V7_PATTERN, "created Event id");
  equal(first.eventStatus, "confirmed", "initial Event status");
  equal(first.replayed, false, "first request replay marker");

  // Same owner/key/intent must replay the exact original accepted decision.
  const replayResponse = await invoke(session.access_token, idempotencyKey, event, decisions);
  const replayText = await replayResponse.text();
  equal(replayResponse.status, 201, "identical authorized retry");
  const replay = parseJson(replayText, "Event create replay");
  equal(replay.eventId, first.eventId, "replayed Event id");
  equal(replay.replayed, true, "replay marker");

  // Changing the decision under the same key is a different create intent.
  const changedDecisionResponse = await invoke(session.access_token, idempotencyKey, event, [{
    ...decisions[0],
    decision: "keep_flexible",
  }]);
  const changedDecision = parseJson(await changedDecisionResponse.text(), "changed conflict decision");
  equal(changedDecisionResponse.status, 409, "same key with changed Protected Time choice");
  equal(changedDecision.error, "IDEMPOTENCY_KEY_REUSED", "changed decision conflict code");

  // The same owner/key with a changed Event intent must also conflict.
  const changedEvent = { ...event, title: "CI authenticated Event create changed" };
  const conflictResponse = await invoke(session.access_token, idempotencyKey, changedEvent, decisions);
  const conflictText = await conflictResponse.text();
  equal(conflictResponse.status, 409, "same key with different Event intent");
  equal(parseJson(conflictText, "idempotency conflict").error, "IDEMPOTENCY_KEY_REUSED", "Event intent conflict code");

  // Query the disposable database directly to verify owner/actor, Event,
  // append-only audit row and one ledger receipt. The stack is destroyed by
  // the workflow's always-run Supabase cleanup step.
  const eventCount = sqlScalar(
    "SELECT count(*) FROM public.calendar_event WHERE id = '" + first.eventId + "'::uuid",
  );
  equal(eventCount, "1", "committed Event row count");

  const eventIdentity = sqlScalar(
    "SELECT owner_user_id::text || ':' || created_by_user_id::text || ':' || updated_by_user_id::text || ':' || title || ':' || event_status " +
    "FROM public.calendar_event WHERE id = '" + first.eventId + "'::uuid",
  );
  equal(
    eventIdentity,
    profileId + ":" + profileId + ":" + profileId + ":CI authenticated Event create:confirmed",
    "server-derived Event owner/actor and payload",
  );

  const auditCount = sqlScalar(
    "SELECT count(*) FROM public.audit_event WHERE entity_type = 'calendar_event' " +
    "AND entity_id = '" + first.eventId + "'::uuid AND account_user_id = '" + profileId + "'::uuid " +
    "AND actor_user_id = '" + profileId + "'::uuid AND action = 'calendar_event.created' AND result = 'success'",
  );
  equal(auditCount, "1", "append-only audit row count");

  const decisionsCount = sqlScalar(
    "SELECT jsonb_array_length(protected_time_decisions) FROM public.calendar_event " +
    "WHERE id = '" + first.eventId + "'::uuid",
  );
  equal(decisionsCount, "1", "persisted Protected Time consent count");

  const consentAuditCount = sqlScalar(
    "SELECT count(*) FROM public.audit_event WHERE entity_type = 'calendar_event' " +
    "AND entity_id = '" + first.eventId + "'::uuid AND account_user_id = '" + profileId + "'::uuid " +
    "AND actor_user_id = '" + profileId + "'::uuid " +
    "AND action = 'calendar_event.protected_time_decisions_recorded' " +
    "AND details ->> 'decision_version' = 'protected-time-decision-v1' " +
    "AND jsonb_array_length(details -> 'decisions') = 1",
  );
  equal(consentAuditCount, "1", "append-only Protected Time decision audit row count");

  const receiptCount = sqlScalar(
    "SELECT count(*) FROM public.event_create_request WHERE owner_user_id = '" + profileId + "'::uuid " +
    "AND idempotency_key = '" + idempotencyKey + "'::uuid AND result_event_id = '" + first.eventId + "'::uuid",
  );
  equal(receiptCount, "1", "committed idempotency receipt count");

  const matchingEvents = sqlScalar(
    "SELECT count(*) FROM public.calendar_event WHERE owner_user_id = '" + profileId + "'::uuid " +
    "AND title IN ('CI authenticated Event create', 'CI authenticated Event create changed')",
  );
  equal(matchingEvents, "1", "one Event after replay and 409");

  console.log("PASS: Event Create rejects publishable keys and malformed JWTs.");
  console.log("PASS: Auth-issued JWT resolves a disposable active SimpleLife profile.");
  console.log("PASS: a hard Protected Time overlap returns HTTP 409 before claiming an idempotency receipt.");
  console.log("PASS: user-authorized Event create succeeds with the same UUIDv7 idempotency key.");
  console.log("PASS: Protected Time consent is stored on the Event and appended to owner/actor audit.");
  console.log("PASS: identical authorized retry replays the original Event and consent receipt.");
  console.log("PASS: changing the consent decision under the same key returns HTTP 409.");
  console.log("PASS: changing Event intent under the same key returns HTTP 409 without a duplicate.");
  console.log("PASS: exactly one owner-scoped idempotency receipt was committed.");
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
