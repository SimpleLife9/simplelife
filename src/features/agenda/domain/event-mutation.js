import { buildEventCreateIntent } from './event-idempotency.js';

export const EVENT_MUTATION_INTENT_VERSION = 'event-mutation-v1';
export const EVENT_MUTATION_ACTIONS = Object.freeze([
  'edit',
  'cancel',
  'reopen',
  'finish',
  'archive',
  'restore',
  'trash',
]);

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

export function normalizeEventMutationId(value) {
  assert(typeof value === 'string' && UUID_V7_PATTERN.test(value),
    'eventId must be a valid UUIDv7.');
  return value.toLowerCase();
}

export function normalizeExpectedEventVersion(value) {
  assert(typeof value === 'string' && OFFSET_INSTANT_PATTERN.test(value),
    'expectedUpdatedAt must be an ISO timestamp with an explicit offset.');
  assert(Number.isFinite(Date.parse(value)),
    'expectedUpdatedAt must be a valid timestamp.');
  // Preserve the exact precision and offset received from PostgREST. Converting
  // through Date would truncate PostgreSQL microseconds to milliseconds.
  return value;
}

export function normalizeEventMutation({ eventId, expectedUpdatedAt, action, eventDraft = null }) {
  const normalizedEventId = normalizeEventMutationId(eventId);
  const normalizedVersion = normalizeExpectedEventVersion(expectedUpdatedAt);
  assert(EVENT_MUTATION_ACTIONS.includes(action), 'Unsupported Event mutation action.');
  if (action === 'edit') {
    assert(eventDraft && typeof eventDraft === 'object' && !Array.isArray(eventDraft),
      'Event edit requires a normalized Event draft.');
  } else {
    assert(eventDraft == null, 'Only an Event edit may include an Event draft.');
  }
  return Object.freeze({
    eventId: normalizedEventId,
    expectedUpdatedAt: normalizedVersion,
    action,
    eventDraft,
  });
}

export function buildEventMutationIntent(mutation) {
  const normalized = normalizeEventMutation(mutation);
  const draftIntent = normalized.action === 'edit'
    ? buildEventCreateIntent(normalized.eventDraft).canonicalPayload
    : null;
  // Fixed positional tuple avoids object-property-order ambiguity.
  const canonicalPayload = JSON.stringify([
    EVENT_MUTATION_INTENT_VERSION,
    normalized.eventId,
    normalized.expectedUpdatedAt,
    normalized.action,
    draftIntent,
  ]);
  return Object.freeze({
    version: EVENT_MUTATION_INTENT_VERSION,
    canonicalPayload,
  });
}

export async function hashEventMutationIntent(mutation, cryptoProvider = globalThis.crypto) {
  assert(cryptoProvider?.subtle?.digest, 'Web Crypto SHA-256 is unavailable.');
  const intent = buildEventMutationIntent(mutation);
  const digest = await cryptoProvider.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(intent.canonicalPayload),
  );
  const payloadHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return Object.freeze({
    ...intent,
    hashAlgorithm: 'sha-256',
    payloadHash,
  });
}
