export const INBOX_SPEECH_ROUTE_POLICY_VERSION = "inbox-speech-route-policy-v1";

const NON_REGIONAL_VALUES = new Set(["global", "unknown", "unspecified", "unverified", ""]);

type RouteRecord = Record<string, unknown>;
type SpeechRouteDecision =
  | { ok: false; reason: string }
  | {
    ok: true;
    policyVersion: string;
    providerId: string;
    modelId: string;
    adapterId: string;
    inferenceRegion: string;
    capabilityId: "speech_to_text";
    quotaUnit: string;
  };

function isRecord(value: unknown): value is RouteRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(reason: string): SpeechRouteDecision {
  return { ok: false, reason };
}

/**
 * Pure fail-closed gate for a future server-side speech-to-text adapter.
 *
 * This function performs no network calls and reads no secrets. The caller
 * must supply evidence-backed ARIA route metadata. A route is eligible only
 * when capability, adapter, account, processing region, privacy controls and
 * a currently valid zero-cost quota are all explicitly verified.
 *
 * This is a policy contract, not a provider integration. No current Inbox
 * worker invokes a provider through this module unless a resolver and adapter
 * are explicitly injected into the secret-only transcription worker.
 */
export function evaluateInboxSpeechRoute(
  route: unknown,
  now: number | Date = Date.now(),
): SpeechRouteDecision {
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(nowMs)) return fail("INVALID_CLOCK");
  if (!isRecord(route)) return fail("SPEECH_ROUTE_NOT_CONFIGURED");

  const capability = route.capability;
  if (!isRecord(capability)
    || capability.id !== "speech_to_text"
    || capability.status !== "verified") {
    return fail("SPEECH_CAPABILITY_NOT_VERIFIED");
  }

  const provider = route.provider;
  if (!isRecord(provider)
    || !hasText(provider.id)
    || provider.status !== "available") {
    return fail("SPEECH_PROVIDER_NOT_AVAILABLE");
  }
  const providerId = provider.id;

  const model = route.model;
  if (!isRecord(model)
    || !hasText(model.id)
    || model.status !== "available") {
    return fail("SPEECH_MODEL_NOT_AVAILABLE");
  }
  const modelId = model.id;

  const adapter = route.adapter;
  if (!isRecord(adapter)
    || !hasText(adapter.id)
    || adapter.status !== "verified") {
    return fail("SPEECH_ADAPTER_NOT_VERIFIED");
  }
  const adapterId = adapter.id;

  const account = route.account;
  if (!isRecord(account)
    || !hasText(account.id)
    || account.status !== "available"
    || account.enabled !== true) {
    return fail("SPEECH_ACCOUNT_NOT_AVAILABLE");
  }

  // The provider/account must also be legally eligible for this account,
  // deployment jurisdiction and specific API use case.
  const legalEligibility = route.legalEligibility;
  if (!isRecord(legalEligibility)
    || legalEligibility.status !== "verified"
    || legalEligibility.allowed !== true) {
    return fail("SPEECH_LEGAL_ELIGIBILITY_NOT_VERIFIED");
  }

  const region = route.inferenceRegion;
  if (!isRecord(region)
    || region.status !== "verified"
    || !hasText(region.value)
    || NON_REGIONAL_VALUES.has(region.value.trim().toLowerCase())) {
    return fail("SPEECH_INFERENCE_REGION_NOT_VERIFIED");
  }
  const inferenceRegion = region.value.trim();

  const privacy = route.privacy;
  if (!isRecord(privacy)
    || privacy.noTraining !== true
    || privacy.zeroRetention !== true
    || privacy.zeroRetentionEnabled !== true
    || privacy.retentionSeconds !== 0
    || privacy.requestLoggingDisabled !== true) {
    return fail("SPEECH_PRIVACY_CONTROLS_NOT_VERIFIED");
  }

  const billing = route.billing;
  if (!isRecord(billing)
    || billing.plan !== "free"
    || billing.maxBillableUsd !== 0
    || billing.paidFallbackEnabled !== false
    || billing.onQuotaExhausted !== "fail_closed") {
    return fail("SPEECH_ZERO_COST_GUARD_NOT_VERIFIED");
  }

  const quota = route.quota;
  if (!isRecord(quota)
    || typeof quota.remaining !== "number"
    || !Number.isFinite(quota.remaining)
    || quota.remaining <= 0
    || !hasText(quota.unit)) {
    return fail("SPEECH_FREE_QUOTA_UNAVAILABLE");
  }
  const quotaUnit = quota.unit;

  const checkedAt = typeof quota.checkedAt === "string" ? Date.parse(quota.checkedAt) : NaN;
  const validUntil = typeof quota.validUntil === "string" ? Date.parse(quota.validUntil) : NaN;
  if (!Number.isFinite(checkedAt) || checkedAt > nowMs
    || !Number.isFinite(validUntil) || validUntil <= nowMs
    || checkedAt >= validUntil) {
    return fail("SPEECH_FREE_QUOTA_EVIDENCE_STALE");
  }

  const evidence = route.evidence;
  const evidenceKeys = [
    "capability", "provider", "model", "adapter",
    "account", "legalEligibility", "region", "privacy", "quota",
  ];
  if (!isRecord(evidence) || evidenceKeys.some((key) => !hasText(evidence[key]))) {
    return fail("SPEECH_ROUTE_EVIDENCE_INCOMPLETE");
  }

  // Return only non-secret route identifiers. Never echo credentials or raw
  // configuration into logs, browser responses or persisted job metadata.
  return {
    ok: true,
    policyVersion: INBOX_SPEECH_ROUTE_POLICY_VERSION,
    providerId,
    modelId,
    adapterId,
    inferenceRegion,
    capabilityId: "speech_to_text",
    quotaUnit,
  };
}
