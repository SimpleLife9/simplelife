import {
  buildProtectedTimeBlockPatch,
  buildProtectedTimeResolutionRequest,
  hashProtectedTimeMutationIntent,
  normalizeProtectedTimeBlock,
  normalizeProtectedTimeBlockId,
  normalizeProtectedTimeExpectedVersion,
  PROTECTED_TIME_MUTATIONS,
} from "../../../src/features/agenda/domain/protected-time.js";
import { normalizeEventIdempotencyKey } from "../../../src/features/agenda/domain/event-idempotency.js";
import { uuidv7 } from "../../../src/lib/uuidv7.js";
import {
  resolveActiveEventProfile,
  type EventAuthenticatedContext,
} from "../_shared/agenda-event-profile.ts";
import { resolveLocalDateTimeRange, TzdbVersionError } from "../agenda-time-resolve/resolver.ts";
import { assessOwnerProtectedTimeTaskScheduleConflicts } from "../_shared/protected-time-task-schedule-conflicts.ts";

export const MAX_REQUEST_BYTES = 32 * 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type AdminClient = {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
type Context = EventAuthenticatedContext & { supabaseAdmin: AdminClient };
type Dependencies = {
  now?: () => string;
  newBlockId?: () => string;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
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

function readPayloadHash(value: unknown): string {
  if (value instanceof Uint8Array) {
    return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  if (typeof value === "string") return value.replace(/^\\x/, "").toLowerCase();
  return "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Authenticated, owner-scoped Protected Time mutation writer.
 *
 * The verified JWT resolves the active profile. The browser never supplies
 * owner/actor identity or writes the table, receipt ledger or audit stream.
 * One-off and weekly local intent is validated by the pinned IANA resolver
 * before the SECURITY INVOKER RPC atomically records the row and audit trail.
 */
export async function handleRequest(
  request: Request,
  ctx: Context,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return json({ error: "CONTENT_TYPE_MUST_BE_JSON" }, 415);

  const profile = await resolveActiveEventProfile(ctx);
  if (!profile.ok) return json({ error: profile.code }, profile.status);

  let idempotencyKey: string;
  try {
    idempotencyKey = normalizeEventIdempotencyKey(request.headers.get("idempotency-key"));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "INVALID_IDEMPOTENCY_KEY" }, 422);
  }

  let raw: string | null;
  try {
    raw = await readBoundedBody(request);
  } catch {
    return json({ error: "REQUEST_BODY_MUST_BE_VALID_UTF8" }, 400);
  }
  if (raw === null) return json({ error: "REQUEST_BODY_TOO_LARGE" }, 413);

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "VALID_JSON_REQUIRED" }, 400); }
  if (!isPlainObject(body)) return json({ error: "PROTECTED_TIME_BODY_MUST_BE_AN_OBJECT" }, 422);

  const input = body;
  const action = input.action;
  if (typeof action !== "string" || !PROTECTED_TIME_MUTATIONS.includes(action)) {
    return json({ error: "UNSUPPORTED_PROTECTED_TIME_MUTATION" }, 422);
  }
  const requiredKeys = action === "create"
    ? ["action", "block"]
    : action === "edit"
    ? ["action", "blockId", "expectedUpdatedAt", "block"]
    : ["action", "blockId", "expectedUpdatedAt"];
  const allowedKeys = action === "create" || action === "edit"
    ? [...requiredKeys, "taskScheduleDecisions"]
    : requiredKeys;
  if (requiredKeys.some((key) => !(key in input))
    || Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    return json({ error: "PROTECTED_TIME_BODY_HAS_UNSUPPORTED_FIELDS" }, 422);
  }
  const suppliedTaskScheduleDecisions = input.taskScheduleDecisions ?? [];
  if (!Array.isArray(suppliedTaskScheduleDecisions)) {
    return json({ error: "TASK_SCHEDULE_DECISIONS_MUST_BE_AN_ARRAY" }, 422);
  }

  let blockId = "";
  let expectedUpdatedAt: string | null = null;
  let blockDraft: ReturnType<typeof normalizeProtectedTimeBlock> | null = null;
  try {
    if (action === "create") {
      // Create retries reuse the block id already recorded in their owner/key receipt.
      blockDraft = normalizeProtectedTimeBlock(input.block);
    } else {
      blockId = normalizeProtectedTimeBlockId(input.blockId);
      expectedUpdatedAt = normalizeProtectedTimeExpectedVersion(input.expectedUpdatedAt);
      if (action === "edit") blockDraft = normalizeProtectedTimeBlock(input.block);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "INVALID_PROTECTED_TIME_INPUT" }, 422);
  }

  // Check the receipt before generating a new create id or resolving civil time.
  // This permits deterministic retries even if the TZDB package is unavailable.
  const existing = await ctx.supabaseAdmin
    .from("protected_time_block_mutation_request")
    .select("block_id,payload_version,payload_hash,response_http_status,response_body")
    .eq("owner_user_id", profile.profileId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) return json({ error: "PROTECTED_TIME_IDEMPOTENCY_LOOKUP_FAILED" }, 503);

  if (action === "create") {
    if (existing.data) {
      try { blockId = normalizeProtectedTimeBlockId(existing.data.block_id); }
      catch { return json({ error: "PROTECTED_TIME_RECEIPT_INVALID" }, 503); }
    } else {
      blockId = (dependencies.newBlockId ?? uuidv7)();
      try { blockId = normalizeProtectedTimeBlockId(blockId); }
      catch { return json({ error: "SERVER_BLOCK_ID_INVALID" }, 500); }
    }
  }

  if (!blockId) return json({ error: "SERVER_BLOCK_ID_INVALID" }, 500);

  let intent;
  try {
    intent = await hashProtectedTimeMutationIntent({
      action,
      blockId,
      expectedUpdatedAt,
      blockDraft,
      taskScheduleDecisions: suppliedTaskScheduleDecisions,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "PROTECTED_TIME_INTENT_INVALID" }, 422);
  }

  if (existing.data) {
    const storedHash = readPayloadHash(existing.data.payload_hash);
    if (existing.data.block_id !== blockId
      || existing.data.payload_version !== intent.version
      || storedHash !== intent.payloadHash) {
      return json({ error: "IDEMPOTENCY_KEY_REUSED" }, 409);
    }
    if (typeof existing.data.response_http_status !== "number" || !isPlainObject(existing.data.response_body)) {
      return json({ error: "PROTECTED_TIME_RECEIPT_INCOMPLETE" }, 503);
    }
    return json({ ...existing.data.response_body, replayed: true }, existing.data.response_http_status);
  }

  let blockPatch: Record<string, unknown> = {};
  if (blockDraft) {
    try {
      const resolution = resolveLocalDateTimeRange(buildProtectedTimeResolutionRequest(blockDraft));
      blockPatch = buildProtectedTimeBlockPatch(blockDraft, resolution) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof TzdbVersionError) return json({ error: "TIMEZONE_RULES_UNAVAILABLE" }, 503);
      if (error instanceof TypeError || error instanceof RangeError) {
        return json({ error: error.message }, 422);
      }
      return json({ error: "PROTECTED_TIME_RESOLUTION_FAILED" }, 500);
    }
  }

  const now = (dependencies.now ?? (() => new Date().toISOString()))();
  if (blockDraft) {
    try {
      const assessment = await assessOwnerProtectedTimeTaskScheduleConflicts({
        supabaseAdmin: ctx.supabaseAdmin,
        ownerProfileId: profile.profileId,
        block: { ...blockPatch, id: blockId, updated_at: now },
        suppliedDecisions: suppliedTaskScheduleDecisions,
        now,
      });
      if (!assessment.ok) {
        return json({
          error: assessment.code,
          taskScheduleConflicts: assessment.conflicts,
        }, 409);
      }
      blockPatch.task_schedule_conflict_decisions = [...assessment.assessment.decisions];
      blockPatch.task_schedule_snapshot = [...assessment.assessment.snapshot];
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return json({ error: error.message }, 422);
      }
      if (error instanceof Error && error.message === "PROTECTED_TIME_TASK_SCHEDULE_LOOKUP_FAILED") {
        return json({ error: error.message }, 503);
      }
      return json({ error: "PROTECTED_TIME_TASK_SCHEDULE_ANALYSIS_FAILED" }, 500);
    }
  }
  const result = await ctx.supabaseAdmin.rpc("mutate_protected_time_block_once", {
    p_owner_user_id: profile.profileId,
    p_block_id: blockId,
    p_idempotency_key: idempotencyKey,
    p_payload_version: intent.version,
    p_payload_hash_hex: intent.payloadHash,
    p_expected_updated_at: expectedUpdatedAt,
    p_mutation: action,
    p_block_patch: blockPatch,
    p_now: now,
  });
  if (result.error) return json({ error: "PROTECTED_TIME_MUTATION_FAILED" }, 503);

  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!isPlainObject(row) || typeof row.http_status !== "number" || !isPlainObject(row.response_body)) {
    return json({ error: "PROTECTED_TIME_MUTATION_RESULT_INVALID" }, 503);
  }
  return json({
    ...row.response_body,
    replayed: row.replayed === true,
  }, row.http_status);
}
