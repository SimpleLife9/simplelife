import { spawn } from "node:child_process";

const DATABASE_CONTAINER = "supabase_db_simplelife";
const OWNER_ID = "019a0000-0000-7000-8000-000000000013";
const SAME_KEY = "019a0000-0000-7000-8000-000000000303";
const CONFLICT_KEY = "019a0000-0000-7000-8000-000000000304";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function eventRecord(eventId, title) {
  return {
    id: eventId,
    owner_user_id: OWNER_ID,
    created_by_user_id: OWNER_ID,
    updated_by_user_id: OWNER_ID,
    title,
    description: null,
    location_label: null,
    location_kind: null,
    event_status: "confirmed",
    temporal_kind: "all_day",
    start_date: "2026-11-23",
    end_date_exclusive: "2026-11-24",
    start_local: null,
    end_local: null,
    time_zone: null,
    starts_at: null,
    ends_at: null,
    start_disambiguation: null,
    end_disambiguation: null,
    start_gap_strategy: null,
    end_gap_strategy: null,
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    created_at: "2026-11-22T18:00:00.000Z",
    updated_at: "2026-11-22T18:00:00.000Z",
  };
}

function resultQuery(key, payloadHash, record) {
  const json = JSON.stringify(record).replaceAll("'", "''");
  return [
    "SELECT r.http_status::text || '|' || r.response_body::text || '|' || CASE WHEN r.replayed THEN 'true' ELSE 'false' END",
    "FROM public.create_calendar_event_once(",
    "'" + OWNER_ID + "'::uuid,",
    "'" + key + "'::uuid,",
    "'event-create-v1',",
    "'" + payloadHash + "',",
    "$event$" + json + "$event$::jsonb",
    ") AS r;",
  ].join("\n");
}

function startPsql(sql, readyMarker = null) {
  const child = spawn("docker", [
    "exec", "-i", DATABASE_CONTAINER,
    "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
    "-t", "-A", "-F", "|",
    "-U", "postgres", "-d", "postgres",
  ], { stdio: ["pipe", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  let readyResolve;
  let readyReject;
  let readySettled = false;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const done = new Promise((resolve, reject) => {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (readyMarker && !readySettled && stdout.includes(readyMarker)) {
        readySettled = true;
        readyResolve();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (!readySettled) {
        readySettled = true;
        readyReject(error);
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (!readySettled) {
        readySettled = true;
        if (code === 0) readyResolve();
        else readyReject(new Error(stderr || ("psql exited with code " + code)));
      }
      if (code !== 0) {
        reject(new Error("psql exited with code " + code + ": " + stderr + "\n" + stdout));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });

  child.stdin.end(sql);
  return { ready, done };
}

function parseRoutineRow(output) {
  const rows = output.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(201|409)\|/.test(line));
  assert(rows.length === 1, "Expected exactly one RPC result row, received " + rows.length + ": " + output.stdout);
  const firstPipe = rows[0].indexOf("|");
  const lastPipe = rows[0].lastIndexOf("|");
  const status = Number(rows[0].slice(0, firstPipe));
  const body = JSON.parse(rows[0].slice(firstPipe + 1, lastPipe));
  const replayed = rows[0].slice(lastPipe + 1) === "true";
  return { status, body, replayed };
}

async function runSamePayloadRace() {
  const firstSql = [
    "BEGIN;",
    "SET LOCAL ROLE service_role;",
    resultQuery(
      SAME_KEY,
      "c".repeat(64),
      eventRecord("019a0000-0000-7000-8000-000000000410", "Concurrent same-key Event"),
    ),
    "SELECT 'CLAIM_HELD';",
    "SELECT pg_sleep(1.25);",
    "COMMIT;",
  ].join("\n");

  const first = startPsql(firstSql, "CLAIM_HELD");
  await first.ready;

  const secondSql = [
    "BEGIN;",
    "SET LOCAL ROLE service_role;",
    resultQuery(
      SAME_KEY,
      "c".repeat(64),
      eventRecord("019a0000-0000-7000-8000-000000000411", "Concurrent same-key Event"),
    ),
    "COMMIT;",
  ].join("\n");
  const second = startPsql(secondSql);

  const [firstOutput, secondOutput] = await Promise.all([first.done, second.done]);
  const firstResult = parseRoutineRow(firstOutput);
  const secondResult = parseRoutineRow(secondOutput);

  assert(firstResult.status === 201 && firstResult.replayed === false,
    "The first same-payload request must create the Event");
  assert(secondResult.status === 201 && secondResult.replayed === true,
    "The competing same-payload request must replay the winner");
  assert(firstResult.body.eventId === "019a0000-0000-7000-8000-000000000410",
    "The first same-payload request must own the committed Event ID");
  assert(secondResult.body.eventId === firstResult.body.eventId,
    "Both same-payload requests must return the exact same Event receipt");
  assert(JSON.stringify(secondResult.body) === JSON.stringify(firstResult.body),
    "The replay receipt must be the same JSON value");

  return { first: firstResult, second: secondResult };
}

async function runDifferentPayloadRace() {
  const firstSql = [
    "BEGIN;",
    "SET LOCAL ROLE service_role;",
    resultQuery(
      CONFLICT_KEY,
      "d".repeat(64),
      eventRecord("019a0000-0000-7000-8000-000000000412", "Concurrent payload winner"),
    ),
    "SELECT 'CLAIM_HELD';",
    "SELECT pg_sleep(1.25);",
    "COMMIT;",
  ].join("\n");

  const first = startPsql(firstSql, "CLAIM_HELD");
  await first.ready;

  const secondSql = [
    "BEGIN;",
    "SET LOCAL ROLE service_role;",
    resultQuery(
      CONFLICT_KEY,
      "e".repeat(64),
      eventRecord("019a0000-0000-7000-8000-000000000413", "Concurrent payload conflict"),
    ),
    "COMMIT;",
  ].join("\n");
  const second = startPsql(secondSql);

  const [firstOutput, secondOutput] = await Promise.all([first.done, second.done]);
  const firstResult = parseRoutineRow(firstOutput);
  const secondResult = parseRoutineRow(secondOutput);

  assert(firstResult.status === 201 && firstResult.replayed === false,
    "The winning different-payload race request must create one Event");
  assert(secondResult.status === 409 && secondResult.replayed === false,
    "The losing different-payload request must return 409");
  assert(secondResult.body.error === "IDEMPOTENCY_KEY_REUSED",
    "The different-payload race must use the stable conflict code");

  return { first: firstResult, second: secondResult };
}

async function verifyPersistedCounts() {
  const sql = [
    "SELECT",
    "  (SELECT count(*) FROM public.calendar_event WHERE id IN (",
    "    '019a0000-0000-7000-8000-000000000410',",
    "    '019a0000-0000-7000-8000-000000000411',",
    "    '019a0000-0000-7000-8000-000000000412',",
    "    '019a0000-0000-7000-8000-000000000413'",
    "  ))::text || '|' ||",
    "  (SELECT count(*) FROM public.audit_event WHERE entity_type = 'calendar_event' AND entity_id IN (",
    "    '019a0000-0000-7000-8000-000000000410',",
    "    '019a0000-0000-7000-8000-000000000411',",
    "    '019a0000-0000-7000-8000-000000000412',",
    "    '019a0000-0000-7000-8000-000000000413'",
    "  ))::text || '|' ||",
    "  (SELECT count(*) FROM public.event_create_request WHERE owner_user_id = '" + OWNER_ID + "'::uuid",
    "    AND idempotency_key IN ('" + SAME_KEY + "'::uuid, '" + CONFLICT_KEY + "'::uuid))::text;",
  ].join("\n");
  const output = await startPsql(sql).done;
  const row = output.stdout.trim().split(/\r?\n/).find((line) => /^\d+\|\d+\|\d+$/.test(line));
  assert(row, "Could not read concurrency verification counts: " + output.stdout);
  const [events, audits, receipts] = row.split("|").map(Number);
  assert(events === 2, "Concurrency smoke must persist exactly two Events; got " + events);
  assert(audits === 2, "Concurrency smoke must append exactly two audit rows; got " + audits);
  assert(receipts === 2, "Concurrency smoke must persist exactly two idempotency receipts; got " + receipts);
  return { events, audits, receipts };
}

const samePayload = await runSamePayloadRace();
const differentPayload = await runDifferentPayloadRace();
const counts = await verifyPersistedCounts();

console.log(JSON.stringify({
  result: "AGENDA_EVENT_IDEMPOTENCY_CONCURRENCY_PASS",
  samePayloadRace: {
    firstStatus: samePayload.first.status,
    replayStatus: samePayload.second.status,
    eventId: samePayload.first.body.eventId,
  },
  differentPayloadRace: {
    winnerStatus: differentPayload.first.status,
    conflictStatus: differentPayload.second.status,
  },
  persisted: counts,
}, null, 2));
