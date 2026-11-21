import { generateKeyPairSync, sign } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FUNCTION_NAME = "agenda-time-resolve";
const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_agenda_edge_runtime_ci_only_0123456789";
const SECRET_KEY = "sb_secret_agenda_edge_runtime_ci_only_0123456789";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const KEY_ID = "agenda-edge-runtime-ci-rs256";
const API_URL = "http://127.0.0.1:54321";

function fail(message) { throw new Error(message); }

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    fail(command + " " + args.join(" ") + " failed (exit " + result.status + "):\n" + result.stdout + "\n" + result.stderr);
  }
  return result.stdout + result.stderr;
}

function b64url(value) { return Buffer.from(value).toString("base64url"); }

function createSignedUserJwt() {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 0x10001 });
  const publicJwk = {
    ...pair.publicKey.export({ format: "jwk" }),
    alg: "RS256",
    use: "sig",
    kid: KEY_ID,
  };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KEY_ID }));
  const payload = b64url(JSON.stringify({
    iss: SUPABASE_URL + "/auth/v1",
    aud: "authenticated",
    exp: now + 300,
    iat: now,
    sub: USER_ID,
    role: "authenticated",
    email: "agenda-edge-runtime-ci@example.invalid",
    phone: "",
    app_metadata: {},
    user_metadata: {},
    aal: "aal1",
    session_id: "00000000-0000-4000-8000-000000000002",
    is_anonymous: false,
  }));
  const signingInput = header + "." + payload;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), pair.privateKey).toString("base64url");
  return { token: signingInput + "." + signature, publicJwk };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(label + ": expected " + expected + ", received " + actual);
  }
}

const statusOutput = run("supabase", ["status"]);
const publishableMatch = statusOutput.match(/Publishable\s*[│|]\s*(sb_publishable_[A-Za-z0-9_-]+)/i);
const localPublishableKey = publishableMatch?.[1];
if (!localPublishableKey) {
  fail("Could not read the local publishable key from supabase status:\n" + statusOutput);
}
const functionUrl = API_URL.replace(/\/$/, "") + "/functions/v1/" + FUNCTION_NAME;

const signed = createSignedUserJwt();
const envValues = {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: localPublishableKey }),
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET_KEY }),
  SUPABASE_JWKS: JSON.stringify({ keys: [signed.publicJwk] }),
};

const tempDir = await mkdtemp(join(tmpdir(), "simplelife-agenda-edge-runtime-"));
const envFile = join(tempDir, "edge-runtime.env");
await writeFile(
  envFile,
  Object.entries(envValues).map(([key, value]) => key + "=" + JSON.stringify(value)).join("\n") + "\n",
  { mode: 0o600 },
);

const server = spawn(
  "supabase",
  ["functions", "serve", FUNCTION_NAME, "--no-verify-jwt", "--env-file", envFile],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } },
);
let serverLogs = "";
const capture = (chunk) => { serverLogs = (serverLogs + chunk.toString()).slice(-12000); };
server.stdout.on("data", capture);
server.stderr.on("data", capture);
let serverExit = null;
server.on("exit", (code) => { serverExit = code; });

async function request(headers, body) {
  return await fetch(functionUrl, {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: localPublishableKey, ...headers },
    body,
    signal: AbortSignal.timeout(5000),
  });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverExit !== null) fail("Edge Runtime function server exited early (" + serverExit + ").\n" + serverLogs);
    try {
      const response = await request({ authorization: "Bearer " + PUBLISHABLE_KEY });
      if (response.status === 401) {
        ready = true;
        break;
      }
    } catch {
      // Wait for the local gateway and Edge Runtime route to become ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) fail("Local Edge Runtime did not become ready at " + functionUrl + ".\n" + serverLogs);

  const rangePayload = JSON.stringify({
    timeZone: "America/New_York",
    start: { localDateTime: "2026-11-01T01:15", disambiguation: "earlier" },
    end: { localDateTime: "2026-11-01T01:45", disambiguation: "later" },
  });

  const valid = await request({
    authorization: "Bearer " + signed.token,
    "content-type": "application/json",
  }, rangePayload);
  const validBody = await valid.text();
  if (valid.status !== 200) {
    fail("signed user JWT response status: expected 200, received " + valid.status
      + "\\nresponse body: " + validBody
      + "\\nEdge Runtime logs:\\n" + serverLogs);
  }
  const resolved = JSON.parse(validBody);
  assertEqual(resolved.startsAt, "2026-11-01T05:15:00.000Z", "resolved range start");
  assertEqual(resolved.endsAt, "2026-11-01T06:45:00.000Z", "resolved range end");

  const apiKeyAsBearer = await request({
    authorization: "Bearer " + PUBLISHABLE_KEY,
    "content-type": "application/json",
  }, rangePayload);
  assertEqual(apiKeyAsBearer.status, 401, "publishable key used as Bearer");

  const invalidJwt = await request({
    authorization: "Bearer not.a.valid.jwt",
    "content-type": "application/json",
  }, rangePayload);
  assertEqual(invalidJwt.status, 401, "malformed JWT response status");

  console.log("PASS: Supabase Edge Runtime served agenda-time-resolve locally.");
  console.log("PASS: synthetic signed user JWT reached atomic range resolver.");
  console.log("PASS: publishable key as Bearer was rejected with HTTP 401.");
  console.log("PASS: malformed JWT was rejected with HTTP 401.");
  console.log("PASS: requests used only the ephemeral local stack and synthetic credentials.");
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
  await rm(tempDir, { recursive: true, force: true });
}
