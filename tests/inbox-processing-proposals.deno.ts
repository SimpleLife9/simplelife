import { handleRequest as handleWorkerRequest } from "../supabase/functions/inbox-processing-worker/handler.ts";

const RUN_ID = "019b1000-0000-7000-8000-000000000801";
const LEASE = "019b1000-0000-7000-8000-000000000802";
const PROFILE_ID = "019b1000-0000-7000-8000-000000000803";
const CAPTURE_ID = "019b1000-0000-7000-8000-000000000804";

Deno.test("secret worker processes one owned run into advisory parts atomically", async () => {
  const calls: {name:string;args:Record<string,unknown>}[] = [];
  const ctx = {
    authMode: "secret",
    supabaseAdmin: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({name,args});
        if (name === "claim_inbox_processing_run_by_id") return {
          data: [{
            run_id: RUN_ID, capture_id: CAPTURE_ID, owner_profile_id: PROFILE_ID,
            processor_version: "inbox-proposal-v1", attempt_number: 1,
            lease_token: LEASE, lease_expires_at: "2026-11-23T20:00:00.000Z",
            content_original: "Comprar café",
          }], error: null,
        };
        if (name === "complete_inbox_processing_run_with_parts") return {data:true,error:null};
        return {data:true,error:null};
      },
    },
  };
  const response = await handleWorkerRequest(new Request("https://local.test/worker", {
    method: "POST", headers: {"content-type":"application/json"},
    body: JSON.stringify({action:"process",runId:RUN_ID}),
  }), ctx as never, {newLeaseToken:()=>LEASE});
  if (response.status !== 200) throw new Error("Expected successful processing.");
  const result = await response.json();
  if (result.engine !== "deterministic-rules") throw new Error("Processor identity is not explicit.");
  const completed = calls.find((call) => call.name === "complete_inbox_processing_run_with_parts");
  if (!completed) throw new Error("Atomic proposal persistence did not run.");
  const proposals = completed.args.p_proposals as Array<Record<string, unknown>>;
  if (proposals.length !== 1 || proposals[0].category !== "task"
    || proposals[0].originalFragment !== "Comprar café") {
    throw new Error("Rule result or lossless fragment is invalid.");
  }
});
