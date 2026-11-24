import { classifyInboxCapture, INBOX_RULE_PROCESSOR_VERSION } from "../_shared/inbox-rule-classifier.ts";
import { uuidv7 } from "../../../src/lib/uuidv7.js";

export const MAX_REQUEST_BYTES = 2 * 1024;
export const MAX_DISPATCH_JOBS = 10;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
type AdminClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: any }>;
  storage?: {
    from(bucket: string): {
      remove(paths: string[]): Promise<{ data: unknown; error: any }>;
    };
  };
};
type Context = { authMode: string; supabaseAdmin: AdminClient };
type Dependencies = {
  newLeaseToken?: () => string;
  newPartId?: () => string;
};
type ClaimedJob = {
  run_id: string;
  capture_id: string;
  processor_version: string;
  lease_token: string;
  content_original: string;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function validUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function failClaim(
  admin: AdminClient,
  job: ClaimedJob,
  errorCode: string,
  retryable: boolean,
): Promise<boolean> {
  const failed = await admin.rpc("fail_inbox_processing_run", {
    p_run_id: job.run_id,
    p_lease_token: job.lease_token,
    p_error_code: errorCode,
    p_retryable: retryable,
    p_retry_after_seconds: retryable ? 60 : 0,
  });
  return failed.error == null && failed.data === true;
}

async function purgeExpiredAudioAssets(
  admin: AdminClient,
): Promise<{ purgedCount: number; failed: boolean }> {
  let listing: { data: unknown; error: unknown };
  try {
    listing = await admin.rpc('list_expired_inbox_audio_assets', { p_batch_size: 10 });
  } catch {
    return { purgedCount: 0, failed: true };
  }
  if (listing.error) return { purgedCount: 0, failed: true };
  const candidates = Array.isArray(listing.data) ? listing.data : [];
  if (candidates.length === 0) return { purgedCount: 0, failed: false };

  const assetIds: string[] = [];
  const objectPaths: string[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)
      || !validUuid(candidate.asset_id)
      || candidate.bucket_id !== 'inbox-voice-private'
      || typeof candidate.object_path !== 'string') {
      return { purgedCount: 0, failed: true };
    }
    const pathParts = candidate.object_path.split('/');
    if (pathParts.length !== 3 || !validUuid(pathParts[0])
      || pathParts[1] !== candidate.asset_id
      || !/^source\\.(webm|ogg|m4a|wav|mp3)$/i.test(pathParts[2])) {
      return { purgedCount: 0, failed: true };
    }
    assetIds.push(candidate.asset_id);
    objectPaths.push(candidate.object_path);
  }
  if (!admin.storage?.from) return { purgedCount: 0, failed: true };

  try {
    const removed = await admin.storage.from('inbox-voice-private').remove(objectPaths);
    if (removed.error) return { purgedCount: 0, failed: true };
  } catch {
    return { purgedCount: 0, failed: true };
  }

  let completion: { data: unknown; error: unknown };
  try {
    completion = await admin.rpc('complete_inbox_audio_asset_purge', {
      p_asset_ids: assetIds,
      p_audit_ids: assetIds.map(() => uuidv7()),
    });
  } catch {
    return { purgedCount: 0, failed: true };
  }
  if (completion.error || typeof completion.data !== 'number') {
    return { purgedCount: 0, failed: true };
  }
  return { purgedCount: completion.data, failed: completion.data !== assetIds.length };
}

/** Secret-only bounded queue dispatcher. Schedule this endpoint externally; it never self-schedules. */
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
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "maxJobs")) {
    return json({ error: "BODY_MUST_CONTAIN_ONLY_MAX_JOBS" }, 422);
  }
  const maxJobs = body.maxJobs === undefined ? 5 : body.maxJobs;
  if (typeof maxJobs !== "number" || !Number.isInteger(maxJobs)
    || maxJobs < 1 || maxJobs > MAX_DISPATCH_JOBS) {
    return json({ error: "MAX_JOBS_OUT_OF_RANGE" }, 422);
  }

  const stats = { claimed: 0, succeeded: 0, retryable: 0, failed: 0, stale: 0 };
  const newLeaseToken = dependencies.newLeaseToken ?? (() => crypto.randomUUID());
  const newPartId = dependencies.newPartId ?? uuidv7;

  for (let index = 0; index < maxJobs; index += 1) {
    const leaseToken = newLeaseToken();
    if (!validUuid(leaseToken)) return json({ error: "LEASE_TOKEN_INVALID", ...stats }, 500);
    let claim: { data: unknown; error: unknown };
    try {
      claim = await ctx.supabaseAdmin.rpc("claim_inbox_processing_run", {
        p_lease_token: leaseToken,
        p_lease_seconds: 120,
      });
    } catch {
      return json({ error: "PROCESSING_CLAIM_FAILED", ...stats }, 503);
    }
    if (claim.error) return json({ error: "PROCESSING_CLAIM_FAILED", ...stats }, 503);
    const row = Array.isArray(claim.data) ? claim.data[0] : claim.data;
    if (!isRecord(row)) break;

    const job = row as unknown as ClaimedJob;
    stats.claimed += 1;
    if (!validUuid(job.run_id) || !validUuid(job.capture_id)
      || job.lease_token !== leaseToken || !validUuid(job.lease_token)
      || typeof job.content_original !== "string" || !job.content_original.trim()
      || job.processor_version !== "inbox-proposal-v1") {
      const safeJob = {
        run_id: job.run_id,
        lease_token: leaseToken,
      } as ClaimedJob;
      if (await failClaim(ctx.supabaseAdmin, safeJob, "INVALID_CLAIM_RESULT", false)) stats.failed += 1;
      else stats.stale += 1;
      continue;
    }

    let proposals;
    try {
      proposals = classifyInboxCapture(job.content_original).map((proposal) => ({
        ...proposal,
        partId: newPartId(),
      }));
    } catch {
      if (await failClaim(ctx.supabaseAdmin, job, "CLASSIFIER_FAILED", true)) stats.retryable += 1;
      else stats.stale += 1;
      continue;
    }

    const resultPayload = {
      engine: "deterministic-rules",
      processorVersion: INBOX_RULE_PROCESSOR_VERSION,
      classification: "advisory-only",
      confidenceMeaning: "heuristic-affinity-not-probability",
      generatedAt: new Date().toISOString(),
      proposals,
    };
    let completion: { data: unknown; error: unknown };
    try {
      completion = await ctx.supabaseAdmin.rpc("complete_inbox_processing_run_with_parts", {
        p_run_id: job.run_id,
        p_lease_token: leaseToken,
        p_result: resultPayload,
        p_proposals: proposals,
      });
    } catch {
      completion = { data: false, error: true };
    }
    if (completion.error) {
      if (await failClaim(ctx.supabaseAdmin, job, "PROPOSAL_PERSIST_FAILED", true)) stats.retryable += 1;
      else stats.stale += 1;
    } else if (completion.data === true) {
      stats.succeeded += 1;
    } else {
      stats.stale += 1;
    }
  }

  const audioPurge = await purgeExpiredAudioAssets(ctx.supabaseAdmin);
  let purgedCount = 0;
  let purgeFailed = false;
  const purgeAuditIds = Array.from({ length: 10 }, () => uuidv7());
  try {
    const purge = await ctx.supabaseAdmin.rpc("purge_expired_inbox_captures", {
      p_batch_size: 10,
      p_audit_ids: purgeAuditIds,
    });
    if (purge.error) {
      purgeFailed = true;
    } else {
      const purgeRow = Array.isArray(purge.data) ? purge.data[0] : purge.data;
      if (isRecord(purgeRow) && typeof purgeRow.purged_count === "number") {
        purgedCount = purgeRow.purged_count;
      } else {
        purgeFailed = true;
      }
    }
  } catch {
    purgeFailed = true;
  }

  return json({
    accepted: true,
    status: stats.claimed === 0 ? "queue_empty" : "completed",
    ...stats,
    purgedCount,
    audioPurgedCount: audioPurge.purgedCount,
    audioPurgeFailed: audioPurge.failed,
    purgeFailed: purgeFailed || audioPurge.failed,
    maxJobs,
    queueEmpty: stats.claimed < maxJobs,
  }, 200);
}
