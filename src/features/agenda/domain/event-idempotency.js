// Stable, server-recomputable request identity for one-off Event creation.
// This is not an Event ID and does not authorize a database write.

export const EVENT_CREATE_INTENT_VERSION = 'event-create-v1';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
const PROTECTED_TIME_DECISION_VERSION = 'protected-time-decision-v1';

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

/**
 * Validate and normalize the client-generated Idempotency-Key.
 *
 * The key is a separate UUIDv7 from the server-generated calendar_event.id.
 * Clients must persist it with the pending create operation and reuse it for
 * every retry until the outcome is known.
 */
export function normalizeEventIdempotencyKey(value) {
  assert(typeof value === 'string' && UUID_V7_PATTERN.test(value),
    'Idempotency-Key must be a UUIDv7.');
  return value.toLowerCase();
}

function assertOptionalText(value, label) {
  assert(value == null || typeof value === 'string',
    label + ' must be normalized text or null.');
}

function createIntentTuple(eventDraft) {
  assert(eventDraft && typeof eventDraft === 'object' && !Array.isArray(eventDraft),
    'A normalized Event draft is required.');
  assert(eventDraft.lifecycleState === 'active',
    'A new Event create intent must have active lifecycle state.');
  assert(typeof eventDraft.title === 'string' && eventDraft.title.length > 0,
    'A normalized Event title is required.');
  assertOptionalText(eventDraft.description, 'description');
  assertOptionalText(eventDraft.locationLabel, 'locationLabel');
  assert(eventDraft.locationKind == null || (
    eventDraft.locationKind === 'physical'
    || eventDraft.locationKind === 'online'
    || eventDraft.locationKind === 'other'
  ), 'locationKind is invalid.');
  assert(eventDraft.eventStatus === 'preparing'
    || eventDraft.eventStatus === 'proposed'
    || eventDraft.eventStatus === 'confirmed',
  'eventStatus is not valid for Event creation.');

  const temporal = eventDraft.temporal;
  assert(temporal && typeof temporal === 'object' && !Array.isArray(temporal),
    'A normalized Event temporal value is required.');

  const common = [
    EVENT_CREATE_INTENT_VERSION,
    eventDraft.title,
    eventDraft.description ?? null,
    eventDraft.locationLabel ?? null,
    eventDraft.locationKind ?? null,
    eventDraft.eventStatus,
  ];

  if (temporal.kind === 'all_day') {
    assert(typeof temporal.startDate === 'string' && typeof temporal.endDateExclusive === 'string',
      'An all-day Event requires a normalized date range.');
    return [
      ...common,
      'all_day',
      temporal.startDate,
      temporal.endDateExclusive,
    ];
  }

  if (temporal.kind === 'fixed_instant') {
    assert(typeof temporal.startsAt === 'string' && typeof temporal.endsAt === 'string',
      'A fixed-instant Event requires normalized UTC instants.');
    assert(temporal.sourceTimeZone == null || typeof temporal.sourceTimeZone === 'string',
      'sourceTimeZone must be text or null.');
    return [
      ...common,
      'fixed_instant',
      temporal.startsAt,
      temporal.endsAt,
      temporal.sourceTimeZone ?? null,
    ];
  }

  assert(temporal.kind === 'zoned_civil',
    'temporal.kind must be all_day, zoned_civil or fixed_instant.');
  assert(typeof temporal.timeZone === 'string' && temporal.timeZone.length > 0,
    'A zoned-civil Event requires its requested IANA timezone.');
  assert(typeof temporal.startLocalDateTime === 'string'
    && typeof temporal.endLocalDateTime === 'string',
  'A zoned-civil Event requires both normalized local date-times.');
  assert(temporal.startDisambiguation === 'earlier' || temporal.startDisambiguation === 'later',
    'startDisambiguation is invalid.');
  assert(temporal.endDisambiguation === 'earlier' || temporal.endDisambiguation === 'later',
    'endDisambiguation is invalid.');
  assert(temporal.startGapStrategy === 'next-valid' && temporal.endGapStrategy === 'next-valid',
    'Phase 1 zoned-civil gap strategies must be next-valid.');

  // Deliberately include only the original civil-time intent. Canonical UTC
  // instants, canonical timezone aliases and TZDB/resolver metadata are omitted.
  // A retry with the same user intent therefore replays the original result
  // even when timezone rules or resolver versions change between attempts.
  return [
    ...common,
    'zoned_civil',
    temporal.timeZone,
    temporal.startLocalDateTime,
    temporal.endLocalDateTime,
    temporal.startDisambiguation,
    temporal.endDisambiguation,
    temporal.startGapStrategy,
    temporal.endGapStrategy,
  ];
}

/**
/**
 * Normalize decisions into a stable positional representation. Empty decisions
 * intentionally preserve the legacy Event-create hash so old pending requests
 * without Protected Time conflicts can still replay across this upgrade.
 */
function protectedTimeDecisionTuple(value) {
  assert(Array.isArray(value) && value.length <= 500,
    'protectedTimeDecisions must be an array with at most 500 entries.');
  const normalized = value.map((item) => {
    assert(item && typeof item === 'object' && !Array.isArray(item),
      'Each Protected Time decision must be an object.');
    const allowed = ['blockId', 'blockUpdatedAt', 'occurrenceStartsAt', 'decision'];
    assert(Object.keys(item).length === 4 && Object.keys(item).every((key) => allowed.includes(key)),
      'Protected Time decision contains unsupported or missing fields.');
    assert(typeof item.blockId === 'string' && UUID_V7_PATTERN.test(item.blockId),
      'Protected Time decision blockId must be a UUIDv7.');
    assert(typeof item.blockUpdatedAt === 'string' && OFFSET_INSTANT_PATTERN.test(item.blockUpdatedAt)
      && Number.isFinite(Date.parse(item.blockUpdatedAt)),
    'Protected Time decision blockUpdatedAt must be an ISO timestamp with an explicit offset.');
    assert(typeof item.occurrenceStartsAt === 'string' && OFFSET_INSTANT_PATTERN.test(item.occurrenceStartsAt)
      && Number.isFinite(Date.parse(item.occurrenceStartsAt)),
    'Protected Time decision occurrenceStartsAt must be an ISO timestamp with an explicit offset.');
    assert(item.decision === 'override_hard' || item.decision === 'keep_flexible'
      || item.decision === 'keep_overlap',
      'Protected Time decision must be override_hard or keep_flexible.');
    return [
      item.blockId.toLowerCase(),
      item.blockUpdatedAt,
      new Date(Date.parse(item.occurrenceStartsAt)).toISOString(),
      item.decision,
    ];
  });
  normalized.sort((a, b) => String(a[0]).localeCompare(String(b[0]))
    || String(a[2]).localeCompare(String(b[2])));
  return normalized;
}

/**
 * Build a deterministic, versioned representation of the normalized user intent.
 *
 * A fixed positional JSON array avoids object-property ordering ambiguity.
 * The caller must first pass untrusted JSON through createEventDraft().
 * This function intentionally excludes owner/actor IDs, Event IDs, timestamps,
 * lifecycle columns, and authoritative resolver outputs. A non-empty Protected
 * Time consent set is bound to the same idempotency identity; an empty set keeps
 * the historical payload bytes unchanged for existing pending create retries.
 */
export function buildEventCreateIntent(eventDraft, protectedTimeDecisions = []) {
  const eventTuple = createIntentTuple(eventDraft);
  const decisions = protectedTimeDecisionTuple(protectedTimeDecisions);
  const canonicalPayload = JSON.stringify(decisions.length
    ? [...eventTuple, PROTECTED_TIME_DECISION_VERSION, decisions]
    : eventTuple);
  return Object.freeze({
    version: EVENT_CREATE_INTENT_VERSION,
    canonicalPayload,
  });
}

/**
 * Compute the server-recomputable SHA-256 hash for an Event create intent.
 * Uses the Web Crypto API available in browsers, Deno Edge Runtime and Node.
 */
export async function hashEventCreateIntent(
  eventDraft,
  cryptoProvider = globalThis.crypto,
  protectedTimeDecisions = [],
) {
  assert(cryptoProvider?.subtle?.digest, 'Web Crypto SHA-256 is unavailable.');
  const intent = buildEventCreateIntent(eventDraft, protectedTimeDecisions);
  const digest = await cryptoProvider.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(intent.canonicalPayload),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return Object.freeze({
    ...intent,
    hashAlgorithm: 'sha-256',
    payloadHash: hash,
  });
}
