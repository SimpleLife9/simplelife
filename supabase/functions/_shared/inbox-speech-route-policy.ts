export const INBOX_SPEECH_ROUTE_POLICY_VERSION = "inbox-speech-route-policy-v1";

const NON_REGIONAL_VALUES = new Set(["global", "unknown", "unspecified", "unverified", ""]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(reason) {
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
 * worker invokes a provider through this module.
 */
export function evaluateInboxSpeechRoute(route, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(nowMs)) return fail("INVALID_CLOCK");
  if (!isRecord(route)) return fail("SPEECH_ROUTE_NOT_CONFIGURED");

  if (!isRecord(route.capability)
    || route.capability.id !== "speech_to_text"
    || route.capability.status !== "verified") {
    return fail("SPEECH_CAPABILITY_NOT_VERIFIED");
  }

  if (!isRecord(route.provider)
    || !hasText(route.provider.id)
    || route.provider.status !== "available") {
    return fail("SPEECH_PROVIDER_NOT_AVAILABLE");
  }

  if (!isRecord(route.model)
    || !hasText(route.model.id)
    || route.model.status !== "available") {
    return fail("SPEECH_MODEL_NOT_AVAILABLE");
  }

  if (!isRecord(route.adapter)
    || !hasText(route.adapter.id)
    || route.adapter.status !== "verified") {
    return fail("SPEECH_ADAPTER_NOT_VERIFIED");
  }

  if (!isRecord(route.account)
    || !hasText(route.account.id)
    || route.account.status !== "available"
    || route.account.enabled !== true) {
    return fail("SPEECH_ACCOUNT_NOT_AVAILABLE");
  }

  const region = route.inferenceRegion;
  if (!isRecord(region)
    || region.status !== "verified"
    || !hasText(region.value)
    || NON_REGIONAL_VALUES.has(region.value.trim().toLowerCase())) {
    return fail("SPEECH_INFERENCE_REGION_NOT_VERIFIED");
  }

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
    || !Number.isFinite(quota.remaining)
    || quota.remaining <= 0
    || !hasText(quota.unit)) {
    return fail("SPEECH_FREE_QUOTA_UNAVAILABLE");
  }

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
    "account", "region", "privacy", "quota",
  ];
  if (!isRecord(evidence) || evidenceKeys.some((key) => !hasText(evidence[key]))) {
    return fail("SPEECH_ROUTE_EVIDENCE_INCOMPLETE");
  }

  // Return only non-secret route identifiers. Never echo credentials or raw
  // configuration into logs, browser responses or persisted job metadata.
  return {
    ok: true,
    policyVersion: INBOX_SPEECH_ROUTE_POLICY_VERSION,
    providerId: route.provider.id,
    modelId: route.model.id,
    adapterId: route.adapter.id,
    inferenceRegion: region.value.trim(),
    capabilityId: "speech_to_text",
    quotaUnit: quota.unit,
  };
}
