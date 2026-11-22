import { spawn, spawnSync } from "node:child_process";

const FUNCTION_NAME = "agenda-time-resolve";
const API_URL = "http://127.0.0.1:54321";
const USER_PASSWORD = "Agenda-Edge-CI-Only-Password-2026!";

function fail(message) { throw new Error(message); }

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    fail(command + " " + args.join(" ") + " failed (exit " + result.status + "):\n" + result.stdout + "\n" + result.stderr);
  }
  return result.stdout + result.stderr;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(label + ": expected " + expected + ", received " + actual);
  }
}

const statusOutput = run("supabase", ["status"]);
const publishableMatch = statusOutput.match(/Publishable\s*[│|]\s*(sb_publishable_[A-Za-z0-9_-]+)/i);
const secretMatch = statusOutput.match(/Secret\s*[│|]\s*(sb_secret_[A-Za-z0-9_-]+)/i);
const localPublishableKey = publishableMatch?.[1];
const localSecretKey = secretMatch?.[1];
if (!localPublishableKey || !localSecretKey) {
  fail("Could not read local publishable/secret keys from supabase status:\n" + statusOutput);
}

const testEmail = "agenda-edge-runtime-ci+" + Date.now() + "@example.invalid";
const adminCreate = await fetch(API_URL + "/auth/v1/admin/users", {
  method: "POST",
  headers: {
    apikey: localSecretKey,
    authorization: "Bearer " + localSecretKey,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    email: testEmail,
    password: USER_PASSWORD,
    email_confirm: true,
  }),
  signal: AbortSignal.timeout(10000),
});
const adminBody = await adminCreate.text();
if (adminCreate.status !== 200 && adminCreate.status !== 201) {
  fail("Local Auth could not create the disposable test user (HTTP " + adminCreate.status + "): " + adminBody);
}

const login = await fetch(API_URL + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: {
    apikey: localPublishableKey,
    "content-type": "application/json",
  },
  body: JSON.stringify({ email: testEmail, password: USER_PASSWORD }),
  signal: AbortSignal.timeout(10000),
});
const loginBody = await login.text();
if (login.status !== 200) {
  fail("Local Auth could not issue a user session (HTTP " + login.status + "): " + loginBody);
}
const session = JSON.parse(loginBody);
if (typeof session.access_token !== "string" || !session.access_token) {
  fail("Local Auth response did not contain an access_token: " + loginBody);
}

const functionUrl = API_URL + "/functions/v1/" + FUNCTION_NAME;
const server = spawn(
  "supabase",
  ["functions", "serve", FUNCTION_NAME, "--no-verify-jwt"],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } },
);
let serverLogs = "";
const capture = (chunk) => { serverLogs = (serverLogs + chunk.toString()).slice(-12000); };
server.stdout.on("data", capture);
server.stderr.on("data", capture);
let serverExit = null;
server.on("exit", (code) => { serverExit = code; });

async function request(headers, body, timeoutMs = 15000) {
  try {
    return await fetch(functionUrl, {
      method: body === undefined ? "GET" : "POST",
      headers: { apikey: localPublishableKey, ...headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    fail("Edge Runtime request failed: " + String(error)
      + "\\nURL: " + functionUrl
      + "\\nEdge Runtime logs:\\n" + serverLogs);
  }
}

try {
  let ready = false;
  let readinessDetail = "no response received";
  // Bound readiness to 60 seconds total. A 401 confirms the route is mounted
  // and the invalid readiness credential was rejected by the gateway.
  const readinessDeadline = Date.now() + 60_000;
  while (Date.now() < readinessDeadline) {
    if (serverExit !== null) fail("Edge Runtime function server exited early (" + serverExit + ").\\n" + serverLogs);
    try {
      const response = await request(
        { authorization: "Bearer " + localPublishableKey },
        undefined,
        2000,
      );
      readinessDetail = "HTTP " + response.status;
      if (response.status === 401) {
        ready = true;
        break;
      }
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      readinessDetail = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) {
    fail("Local Edge Runtime did not become ready at " + functionUrl
      + " within 60 seconds. Last probe: " + readinessDetail
      + "\\nEdge Runtime logs:\\n" + serverLogs);
  }

  const rangePayload = JSON.stringify({
    timeZone: "America/New_York",
    start: { localDateTime: "2026-11-01T01:15", disambiguation: "earlier" },
    end: { localDateTime: "2026-11-01T01:45", disambiguation: "later" },
  });

  // The first authenticated invocation may cold-start the local Edge Runtime
  // and load the pinned TZDB bundle. Keep the request bounded, but allow the
  // same 15-second window already used by the negative JWT checks below.
  const valid = await request({
    authorization: "Bearer " + session.access_token,
    "content-type": "application/json",
  }, rangePayload, 30000);
  const validBody = await valid.text();
  if (valid.status !== 200) {
    fail("Auth-issued user JWT response status: expected 200, received " + valid.status
      + "\nresponse body: " + validBody
      + "\nEdge Runtime logs:\n" + serverLogs);
  }
  const resolved = JSON.parse(validBody);
  assertEqual(resolved.startsAt, "2026-11-01T05:15:00.000Z", "resolved range start");
  assertEqual(resolved.endsAt, "2026-11-01T06:45:00.000Z", "resolved range end");

  const apiKeyAsBearer = await request({
    authorization: "Bearer " + localPublishableKey,
    "content-type": "application/json",
  }, rangePayload, 15000);
  assertEqual(apiKeyAsBearer.status, 401, "publishable key used as Bearer");

  const invalidJwt = await request({
    authorization: "Bearer not.a.valid.jwt",
    "content-type": "application/json",
  }, rangePayload, 15000);
  assertEqual(invalidJwt.status, 401, "malformed JWT response status");

  console.log("PASS: Supabase Edge Runtime served agenda-time-resolve locally.");
  console.log("PASS: local Auth issued a disposable user session accepted by the Edge Function.");
  console.log("PASS: Auth-issued user JWT reached the atomic range resolver.");
  console.log("PASS: publishable key as Bearer was rejected with HTTP 401.");
  console.log("PASS: malformed JWT was rejected with HTTP 401.");
  console.log("PASS: disposable Auth user and all local data are removed by the CI stack cleanup.");
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
