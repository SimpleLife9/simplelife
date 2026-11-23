import { handleRequest } from "../supabase/functions/inbox-processing-dispatcher/handler.ts";

const RUN_A = "019b5000-0000-7000-8000-000000000001";
const RUN_B = "019b5000-0000-7000-8000-000000000002";
const CAPTURE_A = "019b5000-0000-7000-8000-000000000011";
const CAPTURE_B = "019b5000-0000-7000-8000-000000000012";
const LEASE_A = "019b5000-0000-4000-8000-000000000021";
const LEASE_B = "019b5000-0000-4000-8000-000000000022";
const PART_A = "019b5000-0000-7000-8000-000000000031";
const PART_B = "019b5000-0000-7000-8000-000000000032";

function request(body: unknown): Request {
  return new Request("https://local.test/inbox-processing-dispatcher", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}
Deno.test("dispatcher requires secret auth and strict bounded batch input", async () => {
  const ctx = { authMode: "user", supabaseAdmin: { async rpc() { throw new Error("must not run"); } } };
  const unauthorized = await handleRequest(request({ maxJobs: 1 }), ctx as never);
  if (unauthorized.status !== 401) throw new Error("A normal user reached the queue dispatcher.");
  const invalid = await handleRequest(request({ maxJobs: 11 }), { ...ctx, authMode: "secret" } as never);
  if (invalid.status !== 422) throw new Error("The dispatcher accepted an unbounded batch.");
  const extra = await handleRequest(request({ maxJobs: 1, runId: RUN_A }), { ...ctx, authMode: "secret" } as never);
  if (extra.status !== 422) throw new Error("The dispatcher accepted caller-selected run IDs.");
});

Deno.test("dispatcher claims, processes and atomically completes a bounded due batch", async () => {
  const jobs = [
    { run_id: RUN_A, capture_id: CAPTURE_A, processor_version: "inbox-proposal-v1", lease_token: LEASE_A, content_original: "Comprar café" },
    { run_id: RUN_B, capture_id: CAPTURE_B, processor_version: "inbox-proposal-v1", lease_token: LEASE_B, content_original: "  Lista:\n- Comprar leche\n- Llamar al proveedor" },
  ];
  const calls: Array<{name:string;args:Record<string,unknown>}> = [];
  let claims = 0;
  const ctx = {
    authMode: "secret",
    supabaseAdmin: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        if (name === "claim_inbox_processing_run") {
          const job = jobs[claims++];
          return { data: job ? [{ ...job, attempt_number: 1 }] : [], error: null };
        }
        if (name === "complete_inbox_processing_run_with_parts") return { data: true, error: null };
        if (name === "purge_expired_inbox_captures") return { data: [{ purged_count: 0, purged_capture_ids: [] }], error: null };
        throw new Error("Unexpected RPC " + name);
      },
    },
  };
  const leases = [LEASE_A, LEASE_B];
  const parts = [PART_A, PART_B, "019b5000-0000-7000-8000-000000000033"];
  const response = await handleRequest(request({ maxJobs: 5 }), ctx as never, {
    newLeaseToken: () => leases.shift() || LEASE_A,
    newPartId: () => parts.shift() || PART_A,
  });
  if (response.status !== 200) throw new Error("Dispatcher did not complete successfully.");
  const result = await body(response);
  if (result.claimed !== 2 || result.succeeded !== 2 || result.queueEmpty !== true) {
    throw new Error("Dispatcher batch statistics are inconsistent: " + JSON.stringify(result));
  }
  const purgeCall = calls.find((call) => call.name === "purge_expired_inbox_captures");
  if (!purgeCall || purgeCall.args.p_batch_size !== 10) {
    throw new Error("Dispatcher must invoke the retention purge with a bounded batch of ten.");
  }
  const purgeAuditIds = purgeCall.args.p_audit_ids as string[];
  if (!Array.isArray(purgeAuditIds) || purgeAuditIds.length !== 10
    || new Set(purgeAuditIds).size !== 10
    || purgeAuditIds.some((id) => !/^([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(id))) {
    throw new Error("Dispatcher purge audit IDs must be ten unique UUIDv7 values.");
  }
  const completed = calls.filter((call) => call.name === "complete_inbox_processing_run_with_parts");
  if (completed.length !== 2) throw new Error("Each claimed run must complete once.");
  const first = completed[0].args.p_proposals as Array<Record<string, unknown>>;
  const second = completed[1].args.p_proposals as Array<Record<string, unknown>>;
  if (first[0].originalFragment !== "Comprar café" || first[0].partId !== PART_A) {
    throw new Error("First proposal lost its source or stable test ID.");
  }
  if (second.length !== 3 || second.map((part) => part.originalFragment).join("") !== jobs[1].content_original) {
    throw new Error("Multi-item dispatcher split did not preserve the exact source.");
  }
});

Deno.test("dispatcher makes a persistence failure retryable and reports a lost lease", async () => {
  const calls: string[] = [];
  const ctx = {
    authMode: "secret",
    supabaseAdmin: {
      async rpc(name: string) {
        calls.push(name);
        if (name === "claim_inbox_processing_run") return {
          data: [{ run_id: RUN_A, capture_id: CAPTURE_A, processor_version: "inbox-proposal-v1",
            lease_token: LEASE_A, content_original: "Comprar café" }],
          error: null,
        };
        if (name === "complete_inbox_processing_run_with_parts") return { data: false, error: { message: "db unavailable" } };
        if (name === "fail_inbox_processing_run") return { data: false, error: null };
        if (name === "purge_expired_inbox_captures") return { data: [{ purged_count: 0, purged_capture_ids: [] }], error: null };
        return { data: false, error: null };
      },
    },
  };
  const response = await handleRequest(request({ maxJobs: 1 }), ctx as never, {
    newLeaseToken: () => LEASE_A, newPartId: () => PART_A,
  });
  const result = await body(response);
  if (response.status !== 200 || result.stale !== 1 || result.retryable !== 0) {
    throw new Error("A stale lease was not reported safely.");
  }
  if (!calls.includes("fail_inbox_processing_run")) throw new Error("A persistence failure did not attempt bounded retry state.");
  if (!calls.includes("purge_expired_inbox_captures")) throw new Error("Dispatcher did not invoke the retention purge.");
});
