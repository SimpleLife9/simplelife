import { handleRequest } from "../supabase/functions/inbox-voice-transcription-worker/handler.ts";

const ASSET = "019b7400-0000-7000-8000-000000000101";
const OWNER = "019b7400-0000-7000-8000-000000000001";
const LEASE = "00000000-0000-4000-8000-000000000101";
const ATTEMPT = "019b7400-0000-7000-8000-000000000102";
const CAPTURE = "019b7400-0000-7000-8000-000000000103";
const PART = "019b7400-0000-7000-8000-000000000104";
const RUN = "019b7400-0000-7000-8000-000000000105";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}
async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}
function request(payload: unknown = {}): Request {
  return new Request("https://local.test/inbox-voice-transcription-worker", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const AUDIO = new Uint8Array([0x52,0x49,0x46,0x46,0x01,0x02,0x03,0x04]);
const AUDIO_HASH_PROMISE = sha256(AUDIO);

function routeFixture() {
  const now = Date.now();
  return {
    capability: { id: "speech_to_text", status: "verified" },
    provider: { id: "test-provider", status: "available" },
    model: { id: "fixture-model", status: "available" },
    adapter: { id: "fixture-adapter", status: "verified" },
    account: { id: "fixture-account", status: "available", enabled: true },
    legalEligibility: { status: "verified", allowed: true },
    inferenceRegion: { status: "verified", value: "us-west-2" },
    privacy: {
      noTraining: true, zeroRetention: true, zeroRetentionEnabled: true,
      retentionSeconds: 0, requestLoggingDisabled: true,
    },
    billing: {
      plan: "free", maxBillableUsd: 0, paidFallbackEnabled: false,
      onQuotaExhausted: "fail_closed",
    },
    quota: {
      remaining: 10, unit: "audio_minutes",
      checkedAt: new Date(now - 60_000).toISOString(),
      validUntil: new Date(now + 3_600_000).toISOString(),
    },
    evidence: {
      capability: "evidence:capability", provider: "evidence:provider",
      model: "evidence:model", adapter: "evidence:adapter",
      account: "evidence:account", legalEligibility: "evidence:legal",
      region: "evidence:region", privacy: "evidence:privacy", quota: "evidence:quota",
    },
  };
}
async function context({
  authMode = "secret",
  rpcOverrides = {},
  bytes = AUDIO,
  hash,
}: {
  authMode?: string;
  rpcOverrides?: Record<string, { data: unknown; error?: unknown }>;
  bytes?: Uint8Array;
  hash?: string;
} = {}) {
  const resolvedHash = hash ?? await AUDIO_HASH_PROMISE;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const blob = new Blob([bytes], { type: "audio/webm" });
  const claim = {
    asset_id: ASSET,
    owner_profile_id: OWNER,
    bucket_id: "inbox-voice-private",
    object_path: `${OWNER}/${ASSET}/source.webm`,
    mime_type: "audio/webm",
    file_size_bytes: bytes.byteLength,
    sha256_hex: resolvedHash,
    attempt_number: 1,
    lease_token: LEASE,
    lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
    retention_until: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const ctx = {
    authMode,
    supabaseAdmin: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        if (rpcOverrides[name]) return rpcOverrides[name];
        if (name === "claim_inbox_voice_transcription_job") return { data: [claim], error: null };
        if (name === "mark_inbox_voice_transcription_request_started") return { data: true, error: null };
        if (name === "complete_inbox_voice_transcription_job") {
          return {
            data: [{
              capture_id: CAPTURE, part_id: PART, processing_run_id: RUN, replayed: false,
            }],
            error: null,
          };
        }
        return { data: true, error: null };
      },
      storage: {
        from(bucket: string) {
          if (bucket !== "inbox-voice-private") throw new Error("unexpected storage bucket");
          return {
            async download(path: string) {
              if (path !== claim.object_path) throw new Error("unexpected storage path");
              return { data: blob, error: null };
            },
          };
        },
      },
    },
  };
  return { ctx, calls, claim, blob };
}
const IDs = {
  newLeaseToken: () => LEASE,
  newAttemptId: () => ATTEMPT,
  newCaptureId: () => CAPTURE,
  newPartId: () => PART,
  newProcessingRunId: () => RUN,
};

Deno.test("voice worker requires secret auth and never reaches RPC for user callers", async () => {
  const { ctx, calls } = await context({ authMode: "user" });
  const response = await handleRequest(request(), ctx as never, {
    ...IDs, resolveRoute: routeFixture, transcribe: async () => {
      throw new Error("provider must not run");
    },
  });
  assertEquals(response.status, 401, "unauthorized status");
  assertEquals(calls.length, 0, "unauthorized RPC count");
});

Deno.test("voice worker fails closed before claiming when no verified route resolver is wired", async () => {
  const { ctx, calls } = await context();
  let providerCalls = 0;
  const response = await handleRequest(request(), ctx as never, {
    ...IDs,
    transcribe: async () => {
      providerCalls++;
      throw new Error("provider must not run");
    },
  });
  assertEquals(response.status, 503, "missing route status");
  assertEquals(await responseBody(response), {
    accepted: false, status: "disabled", reason: "SPEECH_ROUTE_NOT_CONFIGURED",
  }, "missing route response");
  assertEquals(calls.length, 0, "no route means no queue claim");
  assertEquals(providerCalls, 0, "no route means no provider call");
});

Deno.test("voice worker blocks unverified route evidence before claiming a job", async () => {
  const { ctx, calls } = await context();
  let providerCalls = 0;
  const invalidRoute = routeFixture();
  invalidRoute.legalEligibility.allowed = false;
  const response = await handleRequest(request(), ctx as never, {
    ...IDs,
    resolveRoute: () => invalidRoute,
    transcribe: async () => {
      providerCalls++;
      throw new Error("provider must not run");
    },
  });
  assertEquals(response.status, 503, "unverified route status");
  const body = await responseBody(response);
  assertEquals(body.reason, "SPEECH_LEGAL_ELIGIBILITY_NOT_VERIFIED", "legal eligibility gate");
  assertEquals(calls.length, 0, "unverified route does not claim");
  assertEquals(providerCalls, 0, "unverified route does not call provider");
});

Deno.test("voice worker verifies private bytes, records request start, and atomically completes Inbox", async () => {
  const { ctx, calls, blob } = await context();
  const providerInputs: Record<string, unknown>[] = [];
  const response = await handleRequest(request(), ctx as never, {
    ...IDs,
    resolveRoute: routeFixture,
    transcribe: async (input) => {
      providerInputs.push({
        mimeType: input.mimeType, providerId: input.providerId, modelId: input.modelId,
        adapterId: input.adapterId, inferenceRegion: input.inferenceRegion,
        audioSize: input.audio.size,
      });
      return {
        text: "Transcripción sintética de prueba.",
        providerId: "test-provider", modelId: "fixture-model", inferenceRegion: "us-west-2",
      };
    },
  });
  assertEquals(response.status, 200, "synthetic worker status");
  assertEquals(await responseBody(response), {
    accepted: true, status: "succeeded", assetId: ASSET,
    captureId: CAPTURE, processingRunId: RUN,
  }, "synthetic worker response");
  assertEquals(providerInputs, [{
    mimeType: "audio/webm", providerId: "test-provider", modelId: "fixture-model",
    adapterId: "fixture-adapter", inferenceRegion: "us-west-2", audioSize: blob.size,
  }], "provider fixture input");
  assertEquals(calls.map((call) => call.name), [
    "claim_inbox_voice_transcription_job",
    "mark_inbox_voice_transcription_request_started",
    "complete_inbox_voice_transcription_job",
  ], "voice RPC ordering");
  assertEquals(calls[1].args, {
    p_asset_id: ASSET, p_lease_token: LEASE,
    p_provider_id: "test-provider", p_model_id: "fixture-model",
    p_adapter_id: "fixture-adapter", p_inference_region: "us-west-2",
    p_policy_version: "inbox-speech-route-policy-v1",
    p_route_evidence: routeFixture().evidence,
  }, "route evidence before provider call");
  assertEquals(calls[2].args, {
    p_asset_id: ASSET, p_lease_token: LEASE,
    p_capture_id: CAPTURE, p_part_id: PART, p_processing_run_id: RUN,
    p_transcript_text: "Transcripción sintética de prueba.",
    p_provider_id: "test-provider", p_model_id: "fixture-model",
    p_inference_region: "us-west-2",
  }, "atomic completion arguments");
});

Deno.test("voice worker refuses a digest mismatch before request start or provider call", async () => {
  const { ctx, calls } = await context({ hash: "0".repeat(64) });
  let providerCalls = 0;
  const response = await handleRequest(request(), ctx as never, {
    ...IDs,
    resolveRoute: routeFixture,
    transcribe: async () => {
      providerCalls++;
      throw new Error("provider must not run");
    },
  });
  assertEquals(response.status, 422, "digest mismatch status");
  assertEquals(await responseBody(response), { error: "VOICE_INTEGRITY_CHECK_FAILED" }, "digest response");
  assertEquals(calls.map((call) => call.name), [
    "claim_inbox_voice_transcription_job", "fail_inbox_voice_transcription_job",
  ], "digest failure RPC ordering");
  assertEquals(providerCalls, 0, "digest mismatch never calls provider");
});

Deno.test("voice worker sends ambiguous provider outcomes to manual-review path without retries", async () => {
  const { ctx, calls } = await context();
  const response = await handleRequest(request(), ctx as never, {
    ...IDs,
    resolveRoute: routeFixture,
    transcribe: async () => { throw new Error("synthetic provider timeout"); },
  });
  assertEquals(response.status, 503, "provider timeout status");
  assertEquals(await responseBody(response), {
    error: "VOICE_PROVIDER_OUTCOME_AMBIGUOUS", status: "manual_review",
  }, "ambiguous outcome response");
  assertEquals(calls.map((call) => call.name), [
    "claim_inbox_voice_transcription_job",
    "mark_inbox_voice_transcription_request_started",
    "fail_inbox_voice_transcription_job",
  ], "provider timeout RPC ordering");
  assertEquals(calls[2].args.p_error_code, "VOICE_PROVIDER_OUTCOME_AMBIGUOUS", "manual review code");
  assertEquals(calls[2].args.p_retry_after_seconds, 0, "no provider retry delay");
});

Deno.test("voice worker rejects provider provenance mismatch after request start", async () => {
  const { ctx, calls } = await context();
  const response = await handleRequest(request(), ctx as never, {
    ...IDs,
    resolveRoute: routeFixture,
    transcribe: async () => ({
      text: "synthetic transcript", providerId: "other-provider",
      modelId: "fixture-model", inferenceRegion: "us-west-2",
    }),
  });
  assertEquals(response.status, 502, "provider provenance mismatch status");
  assertEquals(await responseBody(response), {
    error: "VOICE_PROVIDER_RESULT_INVALID", status: "manual_review",
  }, "provenance mismatch response");
  assertEquals(calls.map((call) => call.name), [
    "claim_inbox_voice_transcription_job",
    "mark_inbox_voice_transcription_request_started",
    "fail_inbox_voice_transcription_job",
  ], "provenance mismatch RPC ordering");
});

Deno.test("voice worker handles no-work and stale request-start leases without provider calls", async () => {
  const none = await context({
    rpcOverrides: { claim_inbox_voice_transcription_job: { data: [], error: null } },
  });
  let noWorkProviderCalls = 0;
  const noWorkResponse = await handleRequest(request(), none.ctx as never, {
    ...IDs, resolveRoute: routeFixture, transcribe: async () => {
      noWorkProviderCalls++;
      throw new Error("no-work provider must not run");
    },
  });
  assertEquals(noWorkResponse.status, 200, "no-work status");
  assertEquals(await responseBody(noWorkResponse), { accepted: false, status: "no_work" }, "no-work response");
  assertEquals(noWorkProviderCalls, 0, "no-work provider calls");

  const stale = await context({
    rpcOverrides: { mark_inbox_voice_transcription_request_started: { data: false, error: null } },
  });
  let staleProviderCalls = 0;
  const staleResponse = await handleRequest(request(), stale.ctx as never, {
    ...IDs, resolveRoute: routeFixture, transcribe: async () => {
      staleProviderCalls++;
      throw new Error("stale provider must not run");
    },
  });
  assertEquals(staleResponse.status, 409, "stale start status");
  assertEquals(staleProviderCalls, 0, "stale lease provider calls");
});
