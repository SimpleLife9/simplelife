import { handleRequest as handleQueueRequest } from "../supabase/functions/inbox-processing-queue/handler.ts";
import { handleRequest as handleWorkerRequest } from "../supabase/functions/inbox-processing-worker/handler.ts";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "0190f47a-7b2c-7abc-8def-0123456789ac";
const CAPTURE_ID = "0190f47a-7b2c-7abc-8def-0123456789ad";
const KEY = "0190f47a-7b2c-7abc-8def-0123456789ab";
const RUN_ID = "0190f47a-7b2c-7abc-8def-0123456789ae";
const LEASE = "0190f47a-7b2c-4abc-8def-0123456789af";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}
async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}
function queueRequest(captureId = CAPTURE_ID, key = KEY): Request {
  return new Request("https://local.test/inbox-processing-queue", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ captureId }),
  });
}
function makeQueueContext({
  profileStatus = "active",
  capture = { id: CAPTURE_ID },
  captureError = null,
  rpcData = [{ run_id: RUN_ID, run_status: "queued", attempt_number: 1, replayed: false }],
  rpcError = null,
}: {
  profileStatus?: string;
  capture?: Record<string, unknown> | null;
  captureError?: unknown;
  rpcData?: unknown;
  rpcError?: unknown;
} = {}) {
  const calls: Record<string, unknown> = { tables: [], rpc: 0, rpcArgs: null };
  const supabase = {
    from(table: string) {
      (calls.tables as string[]).push(table);
      return {
        select() { return this; },
        eq() { return this; },
        is() { return this; },
        async maybeSingle() {
          if (table === "user_profile") {
            return { data: { id: PROFILE_ID, auth_user_id: AUTH_USER_ID, account_status: profileStatus }, error: null };
          }
          return { data: capture, error: captureError };
        },
      };
    },
  };
  const supabaseAdmin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.rpc = Number(calls.rpc) + 1;
      calls.rpcName = name;
      calls.rpcArgs = args;
      return { data: rpcData, error: rpcError };
    },
  };
  return {
    ctx: { authMode: "user", userClaims: { id: AUTH_USER_ID }, supabase, supabaseAdmin },
    calls,
  };
}

Deno.test("queue requires an active user profile and owner-visible capture before server enqueue", async () => {
  const { ctx, calls } = makeQueueContext();
  const response = await handleQueueRequest(queueRequest(), ctx as never, { newRunId: () => RUN_ID });
  assertEquals(response.status, 202, "queue status");
  assertEquals(await body(response), {
    runId: RUN_ID, status: "queued", attemptNumber: 1, replayed: false,
  }, "queue response");
  assertEquals(calls.tables, ["user_profile", "capture"], "lookups");
  assertEquals(calls.rpcName, "enqueue_inbox_processing_run", "server RPC");
  assertEquals(calls.rpcArgs, {
    p_run_id: RUN_ID,
    p_owner_profile_id: PROFILE_ID,
    p_capture_id: CAPTURE_ID,
    p_idempotency_key: KEY,
    p_processor_version: "inbox-proposal-v1",
  }, "trusted enqueue arguments");
});

Deno.test("queue refuses a capture hidden by owner-scoped RLS", async () => {
  const { ctx, calls } = makeQueueContext({ capture: null });
  const response = await handleQueueRequest(queueRequest(), ctx as never, { newRunId: () => RUN_ID });
  assertEquals(response.status, 404, "foreign capture status");
  assertEquals(calls.rpc, 0, "no privileged RPC");
});

Deno.test("queue fails closed for inactive profile and malformed request/idempotency key", async () => {
  const inactive = makeQueueContext({ profileStatus: "disabled" });
  assertEquals((await handleQueueRequest(queueRequest(), inactive.ctx as never)).status, 403, "inactive profile");
  assertEquals(inactive.calls.rpc, 0, "inactive profile never writes");

  const malformedKey = makeQueueContext();
  assertEquals((await handleQueueRequest(queueRequest(CAPTURE_ID, "not-a-uuid"), malformedKey.ctx as never)).status,
    422, "invalid key");
  assertEquals(malformedKey.calls.rpc, 0, "invalid key never writes");
});

Deno.test("queue returns a sanitized unavailable error instead of leaking database detail", async () => {
  const failing = makeQueueContext({ rpcError: { code: "XX000", message: "internal SQL detail" } });
  const response = await handleQueueRequest(queueRequest(), failing.ctx as never, { newRunId: () => RUN_ID });
  assertEquals(response.status, 503, "RPC failure");
  assertEquals(await body(response), { error: "PROCESSING_ENQUEUE_FAILED" }, "sanitized RPC error");
});

function workerContext(authMode = "secret", rpcData: unknown = null, rpcError: unknown = null) {
  const calls: Record<string, unknown> = { rpc: 0, name: null, args: null };
  const ctx = {
    authMode,
    supabaseAdmin: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.rpc = Number(calls.rpc) + 1;
        calls.name = name;
        calls.args = args;
        return { data: rpcData, error: rpcError };
      },
    },
  };
  return { ctx, calls };
}
function workerRequest(payload: Record<string, unknown>): Request {
  return new Request("https://local.test/inbox-processing-worker", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

Deno.test("worker refuses callers without the server secret auth mode", async () => {
  const { ctx, calls } = workerContext("user");
  const response = await handleWorkerRequest(workerRequest({ action: "claim" }), ctx, {
    newLeaseToken: () => LEASE,
  });
  assertEquals(response.status, 401, "auth mode");
  assertEquals(calls.rpc, 0, "unauthorized worker does not call database");
});

Deno.test("worker claims one job with a bounded lease and no paid provider dependency", async () => {
  const job = {
    run_id: RUN_ID, capture_id: CAPTURE_ID, owner_profile_id: PROFILE_ID,
    processor_version: "inbox-proposal-v1", attempt_number: 1,
    lease_token: LEASE, lease_expires_at: "2026-11-23T20:00:00.000Z",
    content_original: "original source",
  };
  const { ctx, calls } = workerContext("secret", [job]);
  const response = await handleWorkerRequest(workerRequest({ action: "claim", leaseSeconds: 90 }), ctx, {
    newLeaseToken: () => LEASE,
  });
  assertEquals(response.status, 200, "claim status");
  assertEquals(await body(response), { job }, "claimed job");
  assertEquals(calls.name, "claim_inbox_processing_run", "claim RPC");
  assertEquals(calls.args, { p_lease_token: LEASE, p_lease_seconds: 90 }, "claim parameters");
});

Deno.test("worker completes only with a valid current lease and bounded JSON result", async () => {
  const { ctx, calls } = workerContext("secret", true);
  const response = await handleWorkerRequest(workerRequest({
    action: "complete", runId: RUN_ID, leaseToken: LEASE, result: { outcome: "validated" },
  }), ctx);
  assertEquals(response.status, 200, "complete status");
  assertEquals(await body(response), { accepted: true, status: "succeeded" }, "complete response");
  assertEquals(calls.name, "complete_inbox_processing_run", "complete RPC");
  assertEquals(calls.args, {
    p_run_id: RUN_ID, p_lease_token: LEASE, p_result: { outcome: "validated" },
  }, "complete parameters");
});

Deno.test("worker rejects a stale lease and invalid completion payload", async () => {
  const stale = workerContext("secret", false);
  assertEquals((await handleWorkerRequest(workerRequest({
    action: "complete", runId: RUN_ID, leaseToken: LEASE, result: {},
  }), stale.ctx)).status, 409, "stale lease");
  const invalid = workerContext("secret");
  assertEquals((await handleWorkerRequest(workerRequest({
    action: "complete", runId: RUN_ID, leaseToken: "wrong", result: {},
  }), invalid.ctx)).status, 422, "invalid lease token");
});

Deno.test("worker records retryable failures using bounded codes and delays only", async () => {
  const { ctx, calls } = workerContext("secret", true);
  const response = await handleWorkerRequest(workerRequest({
    action: "fail", runId: RUN_ID, leaseToken: LEASE, errorCode: "UPSTREAM_TIMEOUT",
    retryable: true, retryAfterSeconds: 30,
  }), ctx);
  assertEquals(response.status, 200, "fail status");
  assertEquals(await body(response), { accepted: true, status: "retryable" }, "fail response");
  assertEquals(calls.name, "fail_inbox_processing_run", "fail RPC");
  assertEquals(calls.args, {
    p_run_id: RUN_ID, p_lease_token: LEASE, p_error_code: "UPSTREAM_TIMEOUT",
    p_retryable: true, p_retry_after_seconds: 30,
  }, "fail parameters");
});
