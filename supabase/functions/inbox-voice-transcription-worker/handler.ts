import { evaluateInboxSpeechRoute } from "../_shared/inbox-speech-route-policy.ts";
import { uuidv7 } from "../_shared/uuidv7.ts";

export const MAX_REQUEST_BYTES = 2 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const BUCKET = "inbox-voice-private";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
};
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type RecordValue = Record<string, unknown>;
type AudioStorage = {
  from(bucket: string): {
    download(path: string): Promise<{ data: Blob | null; error: unknown }>;
  };
};
type AdminClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  storage?: AudioStorage;
};
type Context = { authMode: string; supabaseAdmin: AdminClient };
type RouteDecision = {
  ok: true;
  policyVersion: string;
  providerId: string;
  modelId: string;
  adapterId: string;
  inferenceRegion: string;
};
type ProviderResult = {
  text: string;
  providerId: string;
  modelId: string;
  inferenceRegion: string;
};
type Dependencies = {
  resolveRoute?: () => Promise<unknown> | unknown;
  transcribe?: (input: {
    audio: Blob;
    mimeType: string;
    providerId: string;
    modelId: string;
    adapterId: string;
    inferenceRegion: string;
  }) => Promise<ProviderResult>;
  newLeaseToken?: () => string;
  newAttemptId?: () => string;
  newCaptureId?: () => string;
  newPartId?: () => string;
  newProcessingRunId?: () => string;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function validUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7.test(value);
}
function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        try { await reader.cancel(); } catch { /* best effort */ }
        return null;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function parseDecision(route: unknown, now = Date.now()): {
  decision: RouteDecision | null;
  evidence: RecordValue | null;
  reason: string | null;
} {
  const evaluated = evaluateInboxSpeechRoute(route, now);
  if (!evaluated.ok) return { decision: null, evidence: null, reason: evaluated.reason };
  if (!isRecord(route) || !isRecord(route.evidence)) {
    return { decision: null, evidence: null, reason: "SPEECH_ROUTE_EVIDENCE_INCOMPLETE" };
  }
  return {
    decision: evaluated as RouteDecision,
    evidence: route.evidence,
    reason: null,
  };
}
function claimIsValid(job: unknown): job is RecordValue {
  if (!isRecord(job)
    || !validUuidV7(job.asset_id)
    || !validUuidV7(job.owner_profile_id)
    || !validUuid(job.lease_token)
    || !Number.isInteger(job.attempt_number)
    || typeof job.bucket_id !== "string" || job.bucket_id !== BUCKET
    || typeof job.object_path !== "string"
    || typeof job.mime_type !== "string" || !(job.mime_type in EXTENSIONS)
    || !Number.isInteger(job.file_size_bytes)
    || (job.file_size_bytes as number) < 1 || (job.file_size_bytes as number) > MAX_AUDIO_BYTES
    || typeof job.sha256_hex !== "string" || !SHA256.test(job.sha256_hex)
    || typeof job.retention_until !== "string"
    || !Number.isFinite(Date.parse(job.retention_until))
    || Date.parse(job.retention_until) <= Date.now()) return false;
  return job.object_path === `${job.owner_profile_id}/${job.asset_id}/source.${EXTENSIONS[job.mime_type]}`;
}
async function failJob(
  admin: AdminClient,
  assetId: string,
  leaseToken: string,
  errorCode: string,
  retryAfterSeconds: number,
): Promise<void> {
  try {
    await admin.rpc("fail_inbox_voice_transcription_job", {
      p_asset_id: assetId,
      p_lease_token: leaseToken,
      p_error_code: errorCode,
      p_retry_after_seconds: retryAfterSeconds,
    });
  } catch { /* Never expose database details or log private content. */ }
}

/**
 * Secret-only transcription worker.
 *
 * Production remains disabled until a verified route resolver and provider
 * adapter are explicitly wired. Tests inject a synthetic route and adapter;
 * there is no default provider, credential lookup, network endpoint, or paid
 * fallback in this module.
 */
export async function handleRequest(
  request: Request,
  ctx: Context,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (ctx.authMode !== "secret") return json({ error: "WORKER_SECRET_REQUIRED" }, 401);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "CONTENT_TYPE_MUST_BE_JSON" }, 415);
  }

  let raw: string | null;
  try { raw = await readBoundedBody(request); } catch {
    return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400);
  }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  if (!isRecord(body) || Object.keys(body).length !== 0) {
    return json({ error: "VOICE_WORKER_PAYLOAD_MUST_BE_EMPTY_OBJECT" }, 422);
  }

  // Resolve and validate the route BEFORE claiming work. Missing/unverified
  // configuration therefore cannot lease jobs or consume their retention.
  const resolveRoute = dependencies.resolveRoute;
  const transcribe = dependencies.transcribe;
  if (!resolveRoute || !transcribe) {
    return json({ accepted: false, status: "disabled", reason: "SPEECH_ROUTE_NOT_CONFIGURED" }, 503);
  }
  let route: unknown;
  try { route = await resolveRoute(); } catch {
    return json({ accepted: false, status: "disabled", reason: "SPEECH_ROUTE_RESOLUTION_FAILED" }, 503);
  }
  const { decision, evidence, reason } = parseDecision(route);
  if (!decision || !evidence) {
    return json({ accepted: false, status: "disabled", reason: reason ?? "SPEECH_ROUTE_NOT_VERIFIED" }, 503);
  }

  const leaseToken = (dependencies.newLeaseToken ?? (() => crypto.randomUUID()))();
  const attemptId = (dependencies.newAttemptId ?? uuidv7)();
  if (!validUuid(leaseToken) || !validUuidV7(attemptId)) {
    return json({ error: "VOICE_WORKER_ID_GENERATION_FAILED" }, 500);
  }

  let claimed: { data: unknown; error: unknown };
  try {
    claimed = await ctx.supabaseAdmin.rpc("claim_inbox_voice_transcription_job", {
      p_attempt_id: attemptId,
      p_lease_token: leaseToken,
      p_lease_seconds: 120,
    });
  } catch { return json({ error: "VOICE_QUEUE_CLAIM_FAILED" }, 503); }
  if (claimed.error) return json({ error: "VOICE_QUEUE_CLAIM_FAILED" }, 503);
  const job = Array.isArray(claimed.data) ? claimed.data[0] : claimed.data;
  if (job == null) return json({ accepted: false, status: "no_work" }, 200);
  if (!claimIsValid(job)) {
    if (isRecord(job) && validUuidV7(job.asset_id) && validUuid(job.lease_token)) {
      await failJob(ctx.supabaseAdmin, job.asset_id, job.lease_token, "INVALID_VOICE_CLAIM", 0);
    }
    return json({ error: "VOICE_QUEUE_CLAIM_INVALID" }, 503);
  }

  if (!ctx.supabaseAdmin.storage?.from) {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_STORAGE_UNAVAILABLE", 60);
    return json({ error: "VOICE_STORAGE_UNAVAILABLE" }, 503);
  }
  let downloaded: { data: Blob | null; error: unknown };
  try {
    downloaded = await ctx.supabaseAdmin.storage.from(BUCKET).download(job.object_path as string);
  } catch {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_STORAGE_DOWNLOAD_FAILED", 60);
    return json({ error: "VOICE_STORAGE_DOWNLOAD_FAILED" }, 503);
  }
  if (downloaded.error || !(downloaded.data instanceof Blob)) {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_STORAGE_DOWNLOAD_FAILED", 60);
    return json({ error: "VOICE_STORAGE_DOWNLOAD_FAILED" }, 503);
  }
  if (downloaded.data.size !== job.file_size_bytes) {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_UPLOAD_SIZE_MISMATCH", 0);
    return json({ error: "VOICE_UPLOAD_SIZE_MISMATCH" }, 422);
  }

  let actualSha256: string;
  try {
    actualSha256 = toHex(await crypto.subtle.digest("SHA-256", await downloaded.data.arrayBuffer()));
  } catch {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_INTEGRITY_CHECK_UNAVAILABLE", 60);
    return json({ error: "VOICE_INTEGRITY_CHECK_UNAVAILABLE" }, 503);
  }
  if (actualSha256 !== (job.sha256_hex as string).toLowerCase()) {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_INTEGRITY_CHECK_FAILED", 0);
    return json({ error: "VOICE_INTEGRITY_CHECK_FAILED" }, 422);
  }

  let marked: { data: unknown; error: unknown };
  try {
    marked = await ctx.supabaseAdmin.rpc("mark_inbox_voice_transcription_request_started", {
      p_asset_id: job.asset_id,
      p_lease_token: leaseToken,
      p_provider_id: decision.providerId,
      p_model_id: decision.modelId,
      p_adapter_id: decision.adapterId,
      p_inference_region: decision.inferenceRegion,
      p_policy_version: decision.policyVersion,
      p_route_evidence: evidence,
    });
  } catch {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_REQUEST_START_RECORD_FAILED", 60);
    return json({ error: "VOICE_REQUEST_START_RECORD_FAILED" }, 503);
  }
  if (marked.error) {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_REQUEST_START_RECORD_FAILED", 60);
    return json({ error: "VOICE_REQUEST_START_RECORD_FAILED" }, 503);
  }
  if (marked.data !== true) return json({ error: "VOICE_LEASE_OR_RETENTION_STALE" }, 409);

  let transcript: ProviderResult;
  try {
    transcript = await transcribe({
      audio: downloaded.data,
      mimeType: job.mime_type as string,
      providerId: decision.providerId,
      modelId: decision.modelId,
      adapterId: decision.adapterId,
      inferenceRegion: decision.inferenceRegion,
    });
  } catch {
    // Request was durably marked before the provider call. Its outcome may
    // have been accepted/billed, so fail RPC must send the job to manual_review.
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_PROVIDER_OUTCOME_AMBIGUOUS", 0);
    return json({ error: "VOICE_PROVIDER_OUTCOME_AMBIGUOUS", status: "manual_review" }, 503);
  }
  if (!isRecord(transcript) || typeof transcript.text !== "string"
    || transcript.text.trim().length === 0 || transcript.text.length > 20000
    || transcript.providerId !== decision.providerId
    || transcript.modelId !== decision.modelId
    || transcript.inferenceRegion !== decision.inferenceRegion) {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_PROVIDER_RESULT_INVALID", 0);
    return json({ error: "VOICE_PROVIDER_RESULT_INVALID", status: "manual_review" }, 502);
  }

  const captureId = (dependencies.newCaptureId ?? uuidv7)();
  const partId = (dependencies.newPartId ?? uuidv7)();
  const processingRunId = (dependencies.newProcessingRunId ?? uuidv7)();
  if (![captureId, partId, processingRunId].every(validUuidV7)) {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_COMPLETION_ID_INVALID", 0);
    return json({ error: "VOICE_COMPLETION_ID_INVALID" }, 500);
  }

  let completed: { data: unknown; error: unknown };
  try {
    completed = await ctx.supabaseAdmin.rpc("complete_inbox_voice_transcription_job", {
      p_asset_id: job.asset_id,
      p_lease_token: leaseToken,
      p_capture_id: captureId,
      p_part_id: partId,
      p_processing_run_id: processingRunId,
      p_transcript_text: transcript.text,
      p_provider_id: decision.providerId,
      p_model_id: decision.modelId,
      p_inference_region: decision.inferenceRegion,
    });
  } catch {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_COMPLETION_PERSIST_FAILED", 0);
    return json({ error: "VOICE_COMPLETION_PERSIST_FAILED", status: "manual_review" }, 503);
  }
  if (completed.error) {
    await failJob(ctx.supabaseAdmin, job.asset_id as string, leaseToken, "VOICE_COMPLETION_PERSIST_FAILED", 0);
    return json({ error: "VOICE_COMPLETION_PERSIST_FAILED", status: "manual_review" }, 503);
  }
  const receipt = Array.isArray(completed.data) ? completed.data[0] : completed.data;
  if (!isRecord(receipt) || receipt.capture_id !== captureId
    || receipt.part_id !== partId || receipt.processing_run_id !== processingRunId) {
    return json({ error: "VOICE_COMPLETION_NOT_CONFIRMED" }, 409);
  }

  return json({
    accepted: true,
    status: "succeeded",
    assetId: job.asset_id,
    captureId,
    processingRunId,
  }, 200);
}
