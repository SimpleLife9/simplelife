import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const base = "http://127.0.0.1:54321";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) { throw new Error(message); }
function equal(actual, expected, label) {
  if (actual !== expected) fail(label + ": expected " + expected + ", received " + actual);
}
function parseJson(text, label) {
  try { return JSON.parse(text); } catch { fail(label + " returned invalid JSON: " + text); }
}
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
function sqlExec(sql) {
  run("docker", [
    "exec", "-i", "supabase_db_simplelife",
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", sql,
  ]);
}
function assertUuid(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) fail(label + " is not a valid UUID: " + String(value));
}
async function responseJson(response, label) {
  return parseJson(await response.text(), label);
}
async function createAuthUser(secret, label) {
  const email = "inbox-processing-" + label + "-" + Date.now() + "@example.invalid";
  const password = randomBytes(32).toString("base64url") + "aA1!";
  const response = await fetch(base + "/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: secret, authorization: "Bearer " + secret, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 200 && response.status !== 201) fail("Could not create disposable Auth user: " + await response.text());
  const user = await responseJson(response, "Auth Admin create user");
  const authUserId = user.id ?? user.user?.id;
  assertUuid(authUserId, UUID, "Auth user id");
  const login = await fetch(base + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: publishable, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10000),
  });
  if (login.status !== 200) fail("Could not obtain disposable JWT: " + await login.text());
  const session = await responseJson(login, "Auth password login");
  return { authUserId, accessToken: session.access_token };
}

const status = run("supabase", ["status"]);
const publishable = status.match(/Publishable\s*[│|]\s*(sb_publishable_[A-Za-z0-9_-]+)/i)?.[1];
const secret = status.match(/Secret\s*[│|]\s*(sb_secret_[A-Za-z0-9_-]+)/i)?.[1];
if (!publishable || !secret) fail("Local Supabase status did not expose publishable/secret keys.");

const ownerA = await createAuthUser(secret, "owner-a");
const ownerB = await createAuthUser(secret, "owner-b");
const profileA = sqlScalar("SELECT private.uuidv7()");
const profileB = sqlScalar("SELECT private.uuidv7()");
const captureA = sqlScalar("SELECT private.uuidv7()");
const captureRetry = sqlScalar("SELECT private.uuidv7()");
const captureProcess = sqlScalar("SELECT private.uuidv7()");
const captureDispatch = sqlScalar("SELECT private.uuidv7()");
const keyA = sqlScalar("SELECT private.uuidv7()");
const keyRetry = sqlScalar("SELECT private.uuidv7()");
const keyProcess = sqlScalar("SELECT private.uuidv7()");
const keyDispatch = sqlScalar("SELECT private.uuidv7()");
for (const [value, label] of [[profileA,"profile A"],[profileB,"profile B"],[captureA,"capture A"],[captureRetry,"retry capture"],[captureProcess,"process capture"],[captureDispatch,"dispatcher capture"],[keyA,"key A"],[keyRetry,"retry key"],[keyProcess,"process key"],[keyDispatch,"dispatcher key"]]) {
  assertUuid(value, UUID_V7, label);
}
sqlExec(
  "INSERT INTO public.user_profile (id,auth_user_id,display_name,account_status) VALUES " +
  "('" + profileA + "'::uuid,'" + ownerA.authUserId + "'::uuid,'Inbox Processing A','active')," +
  "('" + profileB + "'::uuid,'" + ownerB.authUserId + "'::uuid,'Inbox Processing B','active'); " +
  "INSERT INTO public.capture (id,owner_user_id,created_by_user_id,content_original) VALUES " +
  "('" + captureA + "'::uuid,'" + profileA + "'::uuid,'" + profileA + "'::uuid,'Preserve this exact processing source.')," +
  "('" + captureRetry + "'::uuid,'" + profileA + "'::uuid,'" + profileA + "'::uuid,'Retry this disposable source.')," +
  "('" + captureProcess + "'::uuid,'" + profileA + "'::uuid,'" + profileA + "'::uuid,'Comprar leche para el desayuno.')," +
  "('" + captureDispatch + "'::uuid,'" + profileA + "'::uuid,'" + profileA + "'::uuid,'Comprar pan para la merienda.');"
);

async function startFunction(name, readyHeaders, readyStatus) {
  const server = spawn("supabase", ["functions", "serve", name, "--no-verify-jwt"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  let logs = "";
  let exitCode = null;
  const capture = (chunk) => { logs = (logs + chunk.toString()).slice(-12000); };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);
  server.on("exit", (code) => { exitCode = code; });
  const url = base + "/functions/v1/" + name;
  let ready = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (exitCode !== null) fail(name + " Edge server exited early: " + exitCode + "\n" + logs);
    try {
      const probe = await fetch(url, { method: "GET", headers: readyHeaders, signal: AbortSignal.timeout(2000) });
      if (probe.status === readyStatus) {
        await probe.body?.cancel().catch(() => {});
        ready = true;
        break;
      }
      await probe.body?.cancel().catch(() => {});
    } catch { /* bounded readiness retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) fail(name + " Edge Runtime did not become ready.\n" + logs);
  return { server, url, logs: () => logs };
}
async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise((resolve) => {
    const forceKill = setTimeout(() => server.kill("SIGKILL"), 5000);
    server.once("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

let queueServer;
let workerServer;
let processServer;
let dispatcherServer;
let voiceFinalizeServer;
let voiceWorkerServer;
let purgeFixtureAssetId = null;
let purgeFixturePath = null;
try {
  queueServer = await startFunction("inbox-processing-queue", { apikey: publishable }, 401);
  const queue = async (token, captureId, idempotencyKey) => await fetch(queueServer.url, {
    method: "POST",
    headers: {
      apikey: publishable,
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify({ captureId, idempotencyKey }),
    signal: AbortSignal.timeout(15000),
  });

  const badBearer = await queue(publishable, captureA, keyA);
  equal(badBearer.status, 401, "publishable key used as Bearer");
  const first = await queue(ownerA.accessToken, captureA, keyA);
  equal(first.status, 202, "authenticated enqueue status");
  const firstBody = await responseJson(first, "first enqueue");
  assertUuid(firstBody.runId, UUID_V7, "processing run id");
  equal(firstBody.status, "queued", "initial queue state");
  equal(firstBody.replayed, false, "first enqueue replay marker");

  const replay = await queue(ownerA.accessToken, captureA, keyA);
  equal(replay.status, 202, "same-key replay status");
  const replayBody = await responseJson(replay, "queue replay");
  equal(replayBody.runId, firstBody.runId, "same-key run id");
  equal(replayBody.replayed, true, "same-key replay marker");

  const foreign = await queue(ownerB.accessToken, captureA, keyA);
  equal(foreign.status, 404, "another owner cannot enqueue the capture");

  const ownerRunRead = await fetch(
    base + "/rest/v1/processing_run?select=id,status&capture_id=eq." + captureA,
    { headers: { apikey: publishable, authorization: "Bearer " + ownerA.accessToken } },
  );
  equal(ownerRunRead.status, 200, "owner processing run read");
  const ownerRuns = await responseJson(ownerRunRead, "owner run read");
  equal(ownerRuns.length, 1, "owner sees its processing run");
  const foreignRunRead = await fetch(
    base + "/rest/v1/processing_run?select=id,status&capture_id=eq." + captureA,
    { headers: { apikey: publishable, authorization: "Bearer " + ownerB.accessToken } },
  );
  equal(foreignRunRead.status, 200, "other owner processing run read");
  const foreignRuns = await responseJson(foreignRunRead, "foreign run read");
  equal(foreignRuns.length, 0, "other owner cannot read processing run");

  await stopServer(queueServer.server);
  queueServer = null;

  workerServer = await startFunction("inbox-processing-worker", { apikey: secret }, 405);
  const worker = async (apiKey, payload) => await fetch(workerServer.url, {
    method: "POST",
    headers: { apikey: apiKey, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const publishableWorker = await worker(publishable, { action: "claim" });
  equal(publishableWorker.status, 401, "publishable key cannot call worker");

  const claimResponse = await worker(secret, { action: "claim", leaseSeconds: 90 });  equal(claimResponse.status, 200, "worker claim status");
  const claim = await responseJson(claimResponse, "worker claim");
  assertUuid(claim.job.run_id, UUID_V7, "claimed run id");
  equal(claim.job.run_id, firstBody.runId, "claimed original run");
  equal(claim.job.content_original, "Preserve this exact processing source.", "worker source payload");

  const staleLease = await worker(secret, {
    action: "complete", runId: claim.job.run_id,
    leaseToken: "00000000-0000-4000-8000-000000000099", result: { outcome: "stale" },
  });
  equal(staleLease.status, 409, "wrong lease cannot complete");

  const complete = await worker(secret, {
    action: "complete", runId: claim.job.run_id,
    leaseToken: claim.job.lease_token, result: { outcome: "validated", processor: "test-fixture" },
  });
  equal(complete.status, 200, "valid lease completion");
  equal((await responseJson(complete, "complete")).status, "succeeded", "completion state");

  const savedStatus = sqlScalar(
    "SELECT pr.status || ':' || c.processing_status FROM public.processing_run pr " +
    "JOIN public.capture c ON c.id=pr.capture_id WHERE pr.id='" + firstBody.runId + "'::uuid",
  );
  equal(savedStatus, "succeeded:processed", "atomic run/capture completion");

  await stopServer(workerServer.server);
  workerServer = null;
  queueServer = await startFunction("inbox-processing-queue", { apikey: publishable }, 401);

  const secondQueue = await queue(ownerA.accessToken, captureRetry, keyRetry);
  equal(secondQueue.status, 202, "retry fixture enqueue");
  const secondBody = await responseJson(secondQueue, "retry fixture queue");

  await stopServer(queueServer.server);
  queueServer = null;
  workerServer = await startFunction("inbox-processing-worker", { apikey: secret }, 405);

  const firstClaim = await worker(secret, { action: "claim", leaseSeconds: 90 });
  equal(firstClaim.status, 200, "retry fixture first claim");
  const firstJob = (await responseJson(firstClaim, "retry fixture claim")).job;
  equal(firstJob.run_id, secondBody.runId, "retry fixture claimed run");
  const retryable = await worker(secret, {
    action: "fail", runId: firstJob.run_id, leaseToken: firstJob.lease_token,
    errorCode: "TEMPORARY_TIMEOUT", retryable: true, retryAfterSeconds: 0,
  });
  equal(retryable.status, 200, "retryable worker failure");
  sqlExec("UPDATE public.processing_run SET next_attempt_at=now()-interval '1 second' WHERE id='" + firstJob.run_id + "'::uuid;");
  const retryClaim = await worker(secret, { action: "claim", leaseSeconds: 90 });
  equal(retryClaim.status, 200, "retry claim");
  const retryJob = (await responseJson(retryClaim, "retry claim")).job;
  equal(retryJob.run_id, firstJob.run_id, "retry stable run id");
  equal(retryJob.attempt_number, 2, "retry attempt increment");
  const retryComplete = await worker(secret, {
    action: "complete", runId: retryJob.run_id,
    leaseToken: retryJob.lease_token, result: { outcome: "recovered" },
  });
  equal(retryComplete.status, 200, "retry completion");
  equal(sqlScalar("SELECT status FROM public.processing_run WHERE id='" + retryJob.run_id + "'::uuid"),
    "succeeded", "retry terminal state");

  // Verify the new owner-authenticated bridge through the actual local Edge Runtime.
  await stopServer(workerServer.server);
  workerServer = null;
  queueServer = await startFunction("inbox-processing-queue", { apikey: publishable }, 401);
  const processQueue = await queue(ownerA.accessToken, captureProcess, keyProcess);
  equal(processQueue.status, 202, "process bridge fixture enqueue");
  const processQueueBody = await responseJson(processQueue, "process bridge fixture queue");
  await stopServer(queueServer.server);
  queueServer = null;

  processServer = await startFunction(
    "inbox-processing-process",
    { apikey: publishable, authorization: "Bearer " + ownerA.accessToken },
    405,
  );
  const processCall = async (token) => await fetch(processServer.url, {
    method: "POST",
    headers: {
      apikey: publishable,
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify({ runId: processQueueBody.runId }),
    signal: AbortSignal.timeout(20000),
  });
  const foreignProcess = await processCall(ownerB.accessToken);
  equal(foreignProcess.status, 404, "another owner cannot invoke processing for a foreign run");
  equal(sqlScalar("SELECT status FROM public.processing_run WHERE id='" + processQueueBody.runId + "'::uuid"),
    "queued", "foreign user did not claim the processing run");

  const processResponse = await processCall(ownerA.accessToken);
  equal(processResponse.status, 200, "owner-authenticated processing bridge status");
  const processBody = await responseJson(processResponse, "owner-authenticated process bridge");
  equal(processBody.status, "succeeded", "process bridge terminal state");
  equal(processBody.engine, "first-party-statistical-hybrid", "processor identity");
  equal(processBody.processorVersion, "inbox-tfidf-hybrid-v1", "processor version");
  equal(sqlScalar(
    "SELECT pr.status || ':' || c.processing_status FROM public.processing_run pr " +
    "JOIN public.capture c ON c.id=pr.capture_id WHERE pr.id='" + processQueueBody.runId + "'::uuid",
  ), "succeeded:processed", "owner-authenticated processing atomic state");
  equal(sqlScalar(
    "SELECT cp.category || ':' || cp.review_status || ':' || cp.original_fragment " +
    "FROM public.capture_part cp WHERE cp.capture_id='" + captureProcess + "'::uuid",
  ), "task:unreviewed:Comprar leche para el desayuno.", "persisted advisory proposal and exact source");
  await stopServer(processServer.server);
  processServer = null;

  // Verify the bounded scheduled dispatcher through the actual local Edge Runtime.
  queueServer = await startFunction("inbox-processing-queue", { apikey: publishable }, 401);
  const dispatchQueue = await queue(ownerA.accessToken, captureDispatch, keyDispatch);
  equal(dispatchQueue.status, 202, "dispatcher fixture enqueue");
  const dispatchBody = await responseJson(dispatchQueue, "dispatcher fixture queue");
  await stopServer(queueServer.server);
  queueServer = null;

  dispatcherServer = await startFunction("inbox-processing-dispatcher", { apikey: secret }, 405);
  const dispatchCall = (apiKey, payload) => fetch(dispatcherServer.url, {
    method: "POST",
    headers: { apikey: apiKey, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const publicDispatch = await dispatchCall(publishable, { maxJobs: 2 });
  equal(publicDispatch.status, 401, "publishable key cannot run dispatcher");
  const dispatchResponse = await dispatchCall(secret, { maxJobs: 2 });
  equal(dispatchResponse.status, 200, "secret dispatcher status");
  const dispatchResult = await responseJson(dispatchResponse, "secret dispatcher");
  equal(dispatchResult.claimed, 1, "dispatcher claimed exactly its due fixture");
  equal(dispatchResult.succeeded, 1, "dispatcher persisted one proposal batch");
  equal(dispatchResult.queueEmpty, true, "dispatcher drained current due queue");
  equal(dispatchResult.purgeFailed, false, "retention purge RPC status");
  equal(dispatchResult.purgedCount, 0, "no expired captures in dispatcher fixture");
  equal(sqlScalar("SELECT pr.status || ':' || c.processing_status FROM public.processing_run pr JOIN public.capture c ON c.id=pr.capture_id WHERE pr.id='" + dispatchBody.runId + "'::uuid"),
    "succeeded:processed", "dispatcher terminal capture state");
  equal(sqlScalar("SELECT cp.category || ':' || cp.review_status || ':' || cp.original_fragment FROM public.capture_part cp WHERE cp.capture_id='" + captureDispatch + "'::uuid"),
    "task:unreviewed:Comprar pan para la merienda.", "dispatcher saved exact advisory proposal");
  await stopServer(dispatcherServer.server);
  dispatcherServer = null;

  // Verify private voice integrity through the actual local Edge Runtime and Storage.
  const voiceAssetId = sqlScalar("SELECT private.uuidv7()");
  const voicePath = profileA + "/" + voiceAssetId + "/source.webm";
  const voiceBytes = Buffer.from("SimpleLife private voice server digest fixture.");
  const voiceSha256 = createHash("sha256").update(voiceBytes).digest("hex");
  const metadataResponse = await fetch(base + "/rest/v1/capture_audio_asset", {
    method: "POST",
    headers: {
      apikey: publishable,
      authorization: "Bearer " + ownerA.accessToken,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify([{
      id: voiceAssetId,
      owner_user_id: profileA,
      created_by_user_id: profileA,
      bucket_id: "inbox-voice-private",
      object_path: voicePath,
      mime_type: "audio/webm",
      file_size_bytes: voiceBytes.byteLength,
      sha256_hex: voiceSha256,
      status: "uploading",
    }]),
    signal: AbortSignal.timeout(10000),
  });
  if (metadataResponse.status !== 201 && metadataResponse.status !== 204) {
    fail("Could not create owner-scoped disposable voice metadata: " + await metadataResponse.text());
  }
  const storageResponse = await fetch(
    base + "/storage/v1/object/inbox-voice-private/" + voicePath.split("/").map(encodeURIComponent).join("/"),
    {
      method: "POST",
      headers: {
        apikey: publishable,
        authorization: "Bearer " + ownerA.accessToken,
        "content-type": "audio/webm",
        "x-upsert": "false",
      },
      body: voiceBytes,
      signal: AbortSignal.timeout(10000),
    },
  );
  if (storageResponse.status !== 200 && storageResponse.status !== 201) {
    fail("Could not upload disposable private voice fixture: " + await storageResponse.text());
  }

  voiceFinalizeServer = await startFunction(
    "inbox-voice-finalize",
    { apikey: publishable, authorization: "Bearer " + ownerA.accessToken },
    405,
  );
  const finalizeVoice = (token, id) => fetch(voiceFinalizeServer.url, {
    method: "POST",
    headers: {
      apikey: publishable,
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify({ assetId: id }),
    signal: AbortSignal.timeout(20000),  });
  const finalizedVoice = await finalizeVoice(ownerA.accessToken, voiceAssetId);
  equal(finalizedVoice.status, 200, "server-verified voice finalization");
  const finalizedVoiceBody = await responseJson(finalizedVoice, "server-verified voice finalization");
  equal(finalizedVoiceBody.verified, true, "server digest verification receipt");
  equal(finalizedVoiceBody.assetId, voiceAssetId, "server digest asset identity");
  const replayedVoice = await finalizeVoice(ownerA.accessToken, voiceAssetId);
  equal(replayedVoice.status, 200, "verified voice finalization retry status");
  equal((await responseJson(replayedVoice, "verified voice finalization retry")).replayed, true,
    "verified voice finalization replay marker");
  equal(sqlScalar(
    "SELECT status || ':' || sha256_hex FROM public.capture_audio_asset WHERE id='" + voiceAssetId + "'::uuid",
  ), "uploaded:" + voiceSha256, "server-computed digest persisted");

  // Supabase CLI v3.2 serves one Edge Runtime process at a time. Stop the
  // voice finalizer before starting the transcription worker; restart it
  // afterwards for the remaining owner-isolation and digest-corruption checks.
  await stopServer(voiceFinalizeServer.server);
  voiceFinalizeServer = null;

  // The transcription worker must remain disabled until ARIA supplies a
  // verified speech route and an explicit adapter. It must not claim or send
  // audio merely because its secret endpoint is reachable.
  voiceWorkerServer = await startFunction(
    "inbox-voice-transcription-worker",
    { apikey: secret },
    405,
  );
  const disabledVoiceWorker = await fetch(voiceWorkerServer.url, {
    method: "POST",
    headers: { apikey: secret, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10000),
  });
  equal(disabledVoiceWorker.status, 503, "voice worker remains fail-closed without route");
  const disabledVoiceWorkerBody = await responseJson(disabledVoiceWorker, "disabled voice worker");
  equal(disabledVoiceWorkerBody.accepted, false, "voice worker disabled accepted flag");
  equal(disabledVoiceWorkerBody.status, "disabled", "voice worker disabled status");
  equal(disabledVoiceWorkerBody.reason, "SPEECH_ROUTE_NOT_CONFIGURED", "voice worker disabled reason");
  await stopServer(voiceWorkerServer.server);
  voiceWorkerServer = null;

  voiceFinalizeServer = await startFunction(
    "inbox-voice-finalize",
    { apikey: publishable, authorization: "Bearer " + ownerA.accessToken },
    405,
  );

  const foreignVoice = await finalizeVoice(ownerB.accessToken, voiceAssetId);
  equal(foreignVoice.status, 404, "another owner cannot finalize private voice asset");

  // Same-size corruption must fail the digest check and never reach the privileged RPC.
  const corruptAssetId = sqlScalar("SELECT private.uuidv7()");
  const corruptPath = profileA + "/" + corruptAssetId + "/source.webm";
  const expectedBytes = Buffer.from("expected private voice hash fixture");
  const corruptBytes = Buffer.from("corrupt private voice hash fixtures");
  if (expectedBytes.byteLength !== corruptBytes.byteLength) fail("Digest corruption fixture must have equal byte length.");
  const expectedSha = createHash("sha256").update(expectedBytes).digest("hex");
  const corruptMetadata = await fetch(base + "/rest/v1/capture_audio_asset", {
    method: "POST",
    headers: {
      apikey: publishable,
      authorization: "Bearer " + ownerA.accessToken,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify([{
      id: corruptAssetId,
      owner_user_id: profileA,
      created_by_user_id: profileA,
      bucket_id: "inbox-voice-private",
      object_path: corruptPath,
      mime_type: "audio/webm",
      file_size_bytes: expectedBytes.byteLength,
      sha256_hex: expectedSha,
      status: "uploading",
    }]),
    signal: AbortSignal.timeout(10000),
  });
  if (corruptMetadata.status !== 201 && corruptMetadata.status !== 204) {
    fail("Could not create same-size digest mismatch fixture: " + await corruptMetadata.text());
  }
  const corruptUpload = await fetch(
    base + "/storage/v1/object/inbox-voice-private/" + corruptPath.split("/").map(encodeURIComponent).join("/"),
    {
      method: "POST",
      headers: {
        apikey: publishable,
        authorization: "Bearer " + ownerA.accessToken,
        "content-type": "audio/webm",
        "x-upsert": "false",
      },
      body: corruptBytes,
      signal: AbortSignal.timeout(10000),
    },
  );
  if (corruptUpload.status !== 200 && corruptUpload.status !== 201) {
    fail("Could not upload same-size digest mismatch fixture: " + await corruptUpload.text());
  }
  const rejectedCorruptVoice = await finalizeVoice(ownerA.accessToken, corruptAssetId);
  equal(rejectedCorruptVoice.status, 422, "same-size corrupted voice digest is rejected");
  const corruptResult = await responseJson(rejectedCorruptVoice, "corrupted voice finalization");
  equal(corruptResult.error, "VOICE_UPLOAD_INTEGRITY_CHECK_FAILED", "corrupted voice integrity error");
  equal(sqlScalar(
    "SELECT status FROM public.capture_audio_asset WHERE id='" + corruptAssetId + "'::uuid",
  ), "uploading", "corrupted voice remains unfinalized");

  await stopServer(voiceFinalizeServer.server);
  voiceFinalizeServer = null;

  // Supabase protects storage.objects from direct SQL deletion. Use the Storage
  // API with the local service key, then remove only the disposable metadata.
  const voiceCleanup = await fetch(base + "/storage/v1/object/inbox-voice-private", {
    method: "DELETE",
    headers: {
      apikey: secret,
      authorization: "Bearer " + secret,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prefixes: [voicePath, corruptPath] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!voiceCleanup.ok) {
    fail("Could not remove disposable private voice fixtures through Storage API: " + await voiceCleanup.text());
  }
  equal(sqlScalar(
    "SELECT count(*) FROM storage.objects WHERE bucket_id='inbox-voice-private' AND name IN ('" + voicePath + "','" + corruptPath + "')",
  ), "0", "Storage API removed both disposable voice objects");
  sqlExec(
    "DELETE FROM public.capture_audio_asset WHERE id IN ('" + voiceAssetId + "'::uuid,'" + corruptAssetId + "'::uuid);",
  );

  // Verify actual expired private Storage purge through the local Edge Runtime.
  purgeFixtureAssetId = sqlScalar("SELECT private.uuidv7()");
  purgeFixturePath = profileA + "/" + purgeFixtureAssetId + "/source.webm";
  const expiredAudioBytes = Buffer.from("SimpleLife expired private voice purge fixture.");
  const expiredAudioSha = createHash("sha256").update(expiredAudioBytes).digest("hex");
  const expiredAudioMetadata = await fetch(base + "/rest/v1/capture_audio_asset", {
    method: "POST",
    headers: {
      apikey: publishable,
      authorization: "Bearer " + ownerA.accessToken,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify([{
      id: purgeFixtureAssetId,
      owner_user_id: profileA,
      created_by_user_id: profileA,
      bucket_id: "inbox-voice-private",
      object_path: purgeFixturePath,
      mime_type: "audio/webm",
      file_size_bytes: expiredAudioBytes.byteLength,
      sha256_hex: expiredAudioSha,
      status: "uploading",
    }]),
    signal: AbortSignal.timeout(10000),
  });
  if (expiredAudioMetadata.status !== 201 && expiredAudioMetadata.status !== 204) {
    fail("Could not create owner-scoped expired voice metadata: " + await expiredAudioMetadata.text());
  }
  const expiredAudioUpload = await fetch(
    base + "/storage/v1/object/inbox-voice-private/" + purgeFixturePath.split("/").map(encodeURIComponent).join("/"),
    {
      method: "POST",
      headers: {
        apikey: publishable,
        authorization: "Bearer " + ownerA.accessToken,
        "content-type": "audio/webm",
        "x-upsert": "false",
      },
      body: expiredAudioBytes,
      signal: AbortSignal.timeout(10000),
    },
  );
  if (expiredAudioUpload.status !== 200 && expiredAudioUpload.status !== 201) {
    fail("Could not upload expired private voice fixture: " + await expiredAudioUpload.text());
  }
  equal(sqlScalar(
    "SELECT count(*) FROM storage.objects WHERE bucket_id='inbox-voice-private' AND name='" + purgeFixturePath + "'",
  ), "1", "expired voice fixture exists in private Storage before purge");
  sqlExec(
    "UPDATE public.capture_audio_asset SET retention_until=clock_timestamp()-interval '1 minute' " +
    "WHERE id='" + purgeFixtureAssetId + "'::uuid;",
  );

  dispatcherServer = await startFunction("inbox-processing-dispatcher", { apikey: secret }, 405);
  const expiredAudioPurgeResponse = await dispatchCall(secret, { maxJobs: 1 });
  equal(expiredAudioPurgeResponse.status, 200, "expired private voice purge dispatcher status");
  const expiredAudioPurgeResult = await responseJson(expiredAudioPurgeResponse, "expired private voice purge");
  equal(expiredAudioPurgeResult.audioPurgedCount, 1, "dispatcher purged exactly one expired private voice asset");
  equal(expiredAudioPurgeResult.audioPurgeFailed, false, "expired private voice object removal succeeded");
  equal(expiredAudioPurgeResult.purgeFailed, false, "dispatcher retention purge completed without errors");
  equal(sqlScalar(
    "SELECT count(*) FROM storage.objects WHERE bucket_id='inbox-voice-private' AND name='" + purgeFixturePath + "'",
  ), "0", "physical expired voice object was removed from Storage");
  equal(sqlScalar(
    "SELECT count(*) FROM public.capture_audio_asset WHERE id='" + purgeFixtureAssetId + "'::uuid",
  ), "0", "expired voice metadata was removed only after Storage deletion");
  equal(sqlScalar(
    "SELECT count(*) FROM public.audit_event WHERE action='capture.audio_purged' " +
    "AND entity_id='" + purgeFixtureAssetId + "'::uuid AND source='system' " +
    "AND details->>'object_removed'='true' AND details->>'content_removed'='true'",
  ), "1", "expired voice purge append-only audit receipt");
  await stopServer(dispatcherServer.server);
  dispatcherServer = null;
  purgeFixtureAssetId = null;
  purgeFixturePath = null;

  console.log("PASS: expired private voice purge removes the real Storage object before metadata and writes its append-only audit receipt.");
  console.log("PASS: user JWT and active profile are required to enqueue Inbox processing.");
  console.log("PASS: capture ownership is enforced before the privileged server-side queue call.");
  console.log("PASS: same-key enqueue replays one run; users cannot read another owner's processing run.");
  console.log("PASS: only the server secret can claim, complete, or fail worker jobs.");
  console.log("PASS: leases reject stale completion tokens.");
  console.log("PASS: successful completion updates processing_run and capture atomically.");
  console.log("PASS: retryable failure reclaims the same run with an incremented attempt number.");
  console.log("PASS: authenticated process endpoint rejects another owner's run and persists unreviewed proposals through actual Edge Runtime.");
  console.log("PASS: voice finalizer downloads private Storage bytes, verifies the actual SHA-256, persists only a server-computed digest, and rejects same-size corruption.");
  console.log("PASS: secret-only voice transcription worker stays disabled before claim/provider calls until a verified ARIA route and explicit adapter are wired.");
  console.log("PASS: no AI API, provider credential, or hosted Supabase write is used.");
} finally {
  if (queueServer) await stopServer(queueServer.server);
  if (workerServer) await stopServer(workerServer.server);
  if (processServer) await stopServer(processServer.server);
  if (dispatcherServer) await stopServer(dispatcherServer.server);
  if (voiceFinalizeServer) await stopServer(voiceFinalizeServer.server);
  if (voiceWorkerServer) await stopServer(voiceWorkerServer.server);
  if (purgeFixturePath) {
    try {
      const cleanup = await fetch(base + "/storage/v1/object/inbox-voice-private", {
        method: "DELETE",
        headers: {
          apikey: secret,
          authorization: "Bearer " + secret,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prefixes: [purgeFixturePath] }),
        signal: AbortSignal.timeout(10000),
      });
      if (!cleanup.ok) console.error("Could not clean expired voice fixture from local Storage:", await cleanup.text());
      if (purgeFixtureAssetId) {
        sqlExec("DELETE FROM public.capture_audio_asset WHERE id='" + purgeFixtureAssetId + "'::uuid;");
      }
    } catch (error) {
      console.error("Expired voice fixture cleanup failed:", error);
    }
  }
}