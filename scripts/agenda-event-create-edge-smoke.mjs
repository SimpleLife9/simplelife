import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const name = "agenda-event-create";
const base = "http://127.0.0.1:54321";
const password = randomBytes(32).toString("base64url") + "aA1!";
function fail(message) { throw new Error(message); }
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) fail(command + " failed:\n" + result.stdout + "\n" + result.stderr);
  return result.stdout + result.stderr;
}
function equal(actual, expected, label) {
  if (actual !== expected) fail(label + ": expected " + expected + ", received " + actual);
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
const capture = (chunk) => { logs = (logs + chunk.toString()).slice(-10000); };
server.stdout.on("data", capture);
server.stderr.on("data", capture);
let exitCode = null;
server.on("exit", (code) => { exitCode = code; });

async function invoke(token) {
  return await fetch(url, {
    method: "POST",
    headers: {
      apikey: publishable,
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "idempotency-key": "0190f47a-7b2c-7abc-8def-0123456789ab",
    },
    body: JSON.stringify({ event: { title: "CI auth gate probe" } }),
    signal: AbortSignal.timeout(15000),
  });
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
  if (!ready) fail("Event Create Edge Runtime did not become ready.\n" + logs);

  const keyAsBearer = await invoke(publishable);
  equal(keyAsBearer.status, 401, "publishable key as Bearer");
  const malformed = await invoke("not.a.valid.jwt");
  equal(malformed.status, 401, "malformed JWT");
  const valid = await invoke(session.access_token);
  const text = await valid.text();
  equal(valid.status, 403, "valid JWT without active SimpleLife profile");
  equal(JSON.parse(text).error, "profile_not_found", "verified JWT reaches profile gate");

  console.log("PASS: Event Create rejects API keys used as Bearer credentials.");
  console.log("PASS: Event Create rejects malformed JWTs.");
  console.log("PASS: Auth-issued JWT passes verification and reaches active-profile resolution.");
  console.log("PASS: no Event write is attempted without an active SimpleLife profile.");
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
