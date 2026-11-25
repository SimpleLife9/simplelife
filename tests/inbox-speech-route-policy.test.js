import test from "node:test";
import assert from "node:assert/strict";
import { evaluateInboxSpeechRoute } from "../supabase/functions/_shared/inbox-speech-route-policy.ts";

const NOW = Date.parse("2026-11-25T23:30:00.000Z");

function validRoute() {
  return {
    provider: { id: "example-provider", status: "available" },
    model: { id: "example-provider/whisper-turbo", status: "available" },
    capability: { id: "speech_to_text", status: "verified" },
    adapter: { id: "example-audio-transcriptions-v1", status: "verified" },
    account: { id: "account-free-1", status: "available", enabled: true },
    inferenceRegion: { value: "us-east-1", status: "verified" },
    privacy: {
      noTraining: true,
      zeroRetention: true,
      zeroRetentionEnabled: true,
      retentionSeconds: 0,
      requestLoggingDisabled: true,
    },
    billing: {
      plan: "free",
      maxBillableUsd: 0,
      paidFallbackEnabled: false,
      onQuotaExhausted: "fail_closed",
    },
    quota: {
      remaining: 120,
      unit: "audio_seconds",
      checkedAt: "2026-11-25T23:25:00.000Z",
      validUntil: "2026-11-25T23:35:00.000Z",
    },
    evidence: {
      capability: "aria-capability-record-1",
      provider: "provider-docs-1",
      model: "model-card-1",
      adapter: "adapter-smoke-1",
      account: "provider-account-1",
      region: "region-attestation-1",
      privacy: "privacy-terms-1",
      quota: "live-free-quota-probe-1",
    },
  };
}

test("speech route fails closed when no route is configured", () => {
  assert.deepEqual(evaluateInboxSpeechRoute(null, NOW), {
    ok: false,
    reason: "SPEECH_ROUTE_NOT_CONFIGURED",
  });
});

test("text generation capability cannot authorize speech transcription", () => {
  const route = validRoute();
  route.capability.id = "text_generation";
  assert.equal(evaluateInboxSpeechRoute(route, NOW).reason, "SPEECH_CAPABILITY_NOT_VERIFIED");
});

test("unverified capability, model, adapter or account is not selectable", () => {
  const cases = [
    ["capability", "status", "unknown", "SPEECH_CAPABILITY_NOT_VERIFIED"],
    ["model", "status", "unknown", "SPEECH_MODEL_NOT_AVAILABLE"],
    ["adapter", "status", "unknown", "SPEECH_ADAPTER_NOT_VERIFIED"],
    ["account", "enabled", false, "SPEECH_ACCOUNT_NOT_AVAILABLE"],
  ];
  for (const [section, key, value, expected] of cases) {
    const route = validRoute();
    route[section][key] = value;
    assert.equal(evaluateInboxSpeechRoute(route, NOW).reason, expected, section);
  }
});

test("global or unverified inference location is rejected", () => {
  const globalRoute = validRoute();
  globalRoute.inferenceRegion.value = "global";
  assert.equal(evaluateInboxSpeechRoute(globalRoute, NOW).reason,
    "SPEECH_INFERENCE_REGION_NOT_VERIFIED");

  const unknownRegion = validRoute();
  unknownRegion.inferenceRegion.status = "unknown";
  assert.equal(evaluateInboxSpeechRoute(unknownRegion, NOW).reason,
    "SPEECH_INFERENCE_REGION_NOT_VERIFIED");
});

test("missing no-training, enabled zero-retention or disabled request logging fails closed", () => {
  for (const [key, value] of [
    ["noTraining", false],
    ["zeroRetention", false],
    ["zeroRetentionEnabled", false],
    ["retentionSeconds", 30],
    ["requestLoggingDisabled", false],
  ]) {
    const route = validRoute();
    route.privacy[key] = value;
    assert.equal(evaluateInboxSpeechRoute(route, NOW).reason,
      "SPEECH_PRIVACY_CONTROLS_NOT_VERIFIED", key);
  }
});

test("paid fallback, billable allowance or non-Free plan is rejected", () => {
  for (const [key, value] of [
    ["plan", "paid"],
    ["maxBillableUsd", 0.01],
    ["paidFallbackEnabled", true],
    ["onQuotaExhausted", "fallback"],
  ]) {
    const route = validRoute();
    route.billing[key] = value;
    assert.equal(evaluateInboxSpeechRoute(route, NOW).reason,
      "SPEECH_ZERO_COST_GUARD_NOT_VERIFIED", key);
  }
});

test("empty or expired free quota is rejected", () => {
  const empty = validRoute();
  empty.quota.remaining = 0;
  assert.equal(evaluateInboxSpeechRoute(empty, NOW).reason, "SPEECH_FREE_QUOTA_UNAVAILABLE");

  const expired = validRoute();
  expired.quota.validUntil = "2026-11-25T23:29:59.999Z";
  assert.equal(evaluateInboxSpeechRoute(expired, NOW).reason, "SPEECH_FREE_QUOTA_EVIDENCE_STALE");
});

test("incomplete evidence cannot authorize a provider route", () => {
  const route = validRoute();
  delete route.evidence.region;
  assert.equal(evaluateInboxSpeechRoute(route, NOW).reason, "SPEECH_ROUTE_EVIDENCE_INCOMPLETE");
});

test("verified route returns only non-secret route identity and budget metadata", () => {
  const route = validRoute();
  route.account.apiKey = "must-not-be-returned";
  const result = evaluateInboxSpeechRoute(route, NOW);

  assert.equal(result.ok, true);
  assert.equal(result.capabilityId, "speech_to_text");
  assert.equal(result.providerId, "example-provider");
  assert.equal(result.modelId, "example-provider/whisper-turbo");
  assert.equal(result.inferenceRegion, "us-east-1");
  assert.equal("apiKey" in result, false);
  assert.equal(JSON.stringify(result).includes("must-not-be-returned"), false);
});

test("invalid clock input fails closed", () => {
  assert.equal(evaluateInboxSpeechRoute(validRoute(), Number.NaN).reason, "INVALID_CLOCK");
});
