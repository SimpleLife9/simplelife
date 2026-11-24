import { classifyInboxCapture, INBOX_RULE_PROCESSOR_VERSION } from "../_shared/inbox-rule-classifier.ts";
import { uuidv7 } from "../_shared/uuidv7.ts";

export const MAX_REQUEST_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
type AdminClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: any }>;
};
type Context = { authMode: string; supabaseAdmin: AdminClient };
type Dependencies = { newLeaseToken?: () => string };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
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

/**
 * Server-to-server queue worker contract. The secret key is accepted only in
 * the apikey header by @supabase/server. The process action uses local
 * deterministic rules and never creates destinations or calls an external provider.
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
  if (!isRecord(body) || typeof body.action !== "string") {
    return json({ error: "WORKER_ACTION_REQUIRED" }, 422);
  }


  if (body.action === "process") {
    if (Object.keys(body).some((key) => !["action", "runId"].includes(key)) || !validUuid(body.runId)) {
      return json({ error: "INVALID_PROCESS_PAYLOAD" }, 422);
    }
    const leaseToken = (dependencies.newLeaseToken ?? (() => crypto.randomUUID()))();
    if (!validUuid(leaseToken)) return json({ error: "LEASE_TOKEN_INVALID" }, 500);
    const claimed = await ctx.supabaseAdmin.rpc("claim_inbox_processing_run_by_id", {
      p_run_id: body.runId, p_lease_token: leaseToken, p_lease_seconds: 120,
    });
    if (claimed.error) return json({ error: "PROCESSING_CLAIM_FAILED" }, 503);
    const jobRow = Array.isArray(claimed.data) ? claimed.data[0] : claimed.data;
    if (!jobRow || typeof jobRow !== "object") {
      return json({ accepted: false, status: "not_claimable" }, 200);
    }
    const job = jobRow as Record<string, unknown>;
    if (typeof job.run_id !== "string" || typeof job.content_original !== "string") {
      await ctx.supabaseAdmin.rpc("fail_inbox_processing_run", {
        p_run_id: body.runId, p_lease_token: leaseToken,
        p_error_code: "INVALID_CLAIM_RESULT", p_retryable: false, p_retry_after_seconds: 0,
      });
      return json({ error: "PROCESSING_CLAIM_RESULT_INVALID" }, 503);
    }
    let proposals;
    try {
      proposals = classifyInboxCapture(job.content_original).map((proposal) => ({ ...proposal, partId: uuidv7() }));
    } catch {
      await ctx.supabaseAdmin.rpc("fail_inbox_processing_run", {
        p_run_id: body.runId, p_lease_token: leaseToken,
        p_error_code: "CLASSIFIER_FAILED", p_retryable: true, p_retry_after_seconds: 60,
      });
      return json({ error: "INBOX_CLASSIFICATION_FAILED" }, 503);
    }
    const resultPayload = {
      engine: "deterministic-rules",
      processorVersion: INBOX_RULE_PROCESSOR_VERSION,
      classification: "advisory-only",
      confidenceMeaning: "heuristic-affinity-not-probability",
      generatedAt: new Date().toISOString(),
      proposals,
    };
    const completed = await ctx.supabaseAdmin.rpc("complete_inbox_processing_run_with_parts", {
      p_run_id: body.runId, p_lease_token: leaseToken,
      p_result: resultPayload, p_proposals: proposals,
    });
    if (completed.error) {
      await ctx.supabaseAdmin.rpc("fail_inbox_processing_run", {
        p_run_id: body.runId, p_lease_token: leaseToken,
        p_error_code: "PROPOSAL_PERSIST_FAILED", p_retryable: true, p_retry_after_seconds: 60,
      });
      return json({ error: "INBOX_PROPOSAL_PERSIST_FAILED" }, 503);
    }
    return completed.data === true
      ? json({ accepted: true, status: "succeeded", engine: "deterministic-rules",
          processorVersion: INBOX_RULE_PROCESSOR_VERSION, proposalCount: proposals.length }, 200)
      : json({ error: "PROCESSING_LEASE_STALE" }, 409);
  }

  if (body.action === "claim") {
    if (Object.keys(body).some((key) => !["action", "leaseSeconds"].includes(key))) {
      return json({ error: "UNSUPPORTED_CLAIM_FIELDS" }, 422);
    }
    const leaseSeconds = body.leaseSeconds === undefined ? 120 : body.leaseSeconds;
    if (typeof leaseSeconds !== "number" || !Number.isInteger(leaseSeconds)
      || leaseSeconds < 30 || leaseSeconds > 600) {
      return json({ error: "LEASE_SECONDS_OUT_OF_RANGE" }, 422);
    }
    const leaseToken = (dependencies.newLeaseToken ?? (() => crypto.randomUUID()))();
    if (!validUuid(leaseToken)) return json({ error: "LEASE_TOKEN_INVALID" }, 500);
    const result = await ctx.supabaseAdmin.rpc("claim_inbox_processing_run", {
      p_lease_token: leaseToken,
      p_lease_seconds: leaseSeconds,
    });
    if (result.error) return json({ error: "PROCESSING_CLAIM_FAILED" }, 503);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return json({ job: row && typeof row === "object" ? row : null }, 200);
  }

  if (body.action === "complete") {
    if (Object.keys(body).some((key) => !["action", "runId", "leaseToken", "result"].includes(key))
      || !validUuid(body.runId) || !validUuid(body.leaseToken) || !isRecord(body.result)) {
      return json({ error: "INVALID_COMPLETION_PAYLOAD" }, 422);
    }
    const encoded = JSON.stringify(body.result);
    if (new TextEncoder().encode(encoded).byteLength > MAX_REQUEST_BYTES - 1024) {
      return json({ error: "PROCESSING_RESULT_TOO_LARGE" }, 413);
    }
    const result = await ctx.supabaseAdmin.rpc("complete_inbox_processing_run", {
      p_run_id: body.runId,
      p_lease_token: body.leaseToken,
      p_result: body.result,
    });
    if (result.error) return json({ error: "PROCESSING_COMPLETE_FAILED" }, 503);
    return result.data === true
      ? json({ accepted: true, status: "succeeded" }, 200)
      : json({ error: "PROCESSING_LEASE_STALE" }, 409);
  }

  if (body.action === "fail") {
    if (Object.keys(body).some((key) => ![
      "action", "runId", "leaseToken", "errorCode", "retryable", "retryAfterSeconds",
    ].includes(key))
      || !validUuid(body.runId) || !validUuid(body.leaseToken)
      || typeof body.errorCode !== "string" || !/^[A-Z0-9_]{1,64}$/.test(body.errorCode)
      || typeof body.retryable !== "boolean") {
      return json({ error: "INVALID_FAILURE_PAYLOAD" }, 422);
    }
    const retryAfterSeconds = body.retryAfterSeconds === undefined ? 60 : body.retryAfterSeconds;
    if (typeof retryAfterSeconds !== "number" || !Number.isInteger(retryAfterSeconds)
      || retryAfterSeconds < 0 || retryAfterSeconds > 86400) {
      return json({ error: "RETRY_DELAY_OUT_OF_RANGE" }, 422);
    }
    const result = await ctx.supabaseAdmin.rpc("fail_inbox_processing_run", {
      p_run_id: body.runId,
      p_lease_token: body.leaseToken,
      p_error_code: body.errorCode,
      p_retryable: body.retryable,
      p_retry_after_seconds: retryAfterSeconds,
    });
    if (result.error) return json({ error: "PROCESSING_FAIL_UPDATE_FAILED" }, 503);
    return result.data === true
      ? json({ accepted: true, status: body.retryable ? "retryable" : "failed" }, 200)
      : json({ error: "PROCESSING_LEASE_STALE" }, 409);
  }

  return json({ error: "UNKNOWN_WORKER_ACTION" }, 422);
}
