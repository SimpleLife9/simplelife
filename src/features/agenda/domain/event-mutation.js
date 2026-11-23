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

/**
 * @typedef {ReturnType<typeof import('./event.js').createEventDraft>} NormalizedEventDraft
 */

/**
 * @param {{
 *   eventId: unknown,
 *   expectedUpdatedAt: unknown,
 *   action: string,
 *   eventDraft?: NormalizedEventDraft | null,
 *   protectedTimeDecisions?: Record<string, unknown>[],
 *   taskScheduleDecisions?: Record<string, unknown>[]
 * }} input
 */
export function normalizeEventMutation({ eventId, expectedUpdatedAt, action, eventDraft = null, protectedTimeDecisions = /** @type {Record<string, unknown>[]} */ ([]), taskScheduleDecisions = /** @type {Record<string, unknown>[]} */ ([]) }) {
  const normalizedEventId = normalizeEventMutationId(eventId);
  const normalizedVersion = normalizeExpectedEventVersion(expectedUpdatedAt);
  assert(EVENT_MUTATION_ACTIONS.includes(action), 'Unsupported Event mutation action.');
  if (action === 'edit') {
    assert(eventDraft && typeof eventDraft === 'object' && !Array.isArray(eventDraft),
      'Event edit requires a normalized Event draft.');
  } else {
    assert(eventDraft == null, 'Only an Event edit may include an Event draft.');
  }
  assert(Array.isArray(protectedTimeDecisions) && protectedTimeDecisions.length <= 500,
    'protectedTimeDecisions must be an array with at most 500 entries.');
  assert(['edit', 'reopen', 'restore'].includes(action) || protectedTimeDecisions.length === 0,
    'Protected Time decisions are only valid for Event edit, reopen or restore.');
  assert(protectedTimeDecisions.every((item) => item && typeof item === 'object' && !Array.isArray(item)),
    'Every Protected Time decision must be an object.');
  assert(Array.isArray(taskScheduleDecisions) && taskScheduleDecisions.length <= 500,
    'taskScheduleDecisions must be an array with at most 500 entries.');
  assert(['edit', 'reopen', 'restore'].includes(action) || taskScheduleDecisions.length === 0,
    'TaskSchedule decisions are only valid for Event edit, reopen or restore.');
  assert(taskScheduleDecisions.every((item) => item && typeof item === 'object' && !Array.isArray(item)),
    'Every TaskSchedule decision must be an object.');
  for (const item of taskScheduleDecisions) {
    const keys = ['taskScheduleId', 'taskScheduleUpdatedAt', 'decision'];
    assert(Object.keys(item).length === 3 && Object.keys(item).every((key) => keys.includes(key)),
      'TaskSchedule decision contains unsupported or missing fields.');
    assert(typeof item.taskScheduleId === 'string' && UUID_V7_PATTERN.test(item.taskScheduleId),
      'TaskSchedule decision ID must be a UUIDv7.');
    assert(typeof item.taskScheduleUpdatedAt === 'string' && OFFSET_INSTANT_PATTERN.test(item.taskScheduleUpdatedAt)
      && Number.isFinite(Date.parse(item.taskScheduleUpdatedAt)),
    'TaskSchedule decision version must be an ISO timestamp with an explicit offset.');
    assert(item.decision === 'keep_overlap', 'TaskSchedule decision must be keep_overlap.');
  }
  assert(new Set(taskScheduleDecisions.map((item) => item.taskScheduleId.toLowerCase())).size === taskScheduleDecisions.length,
    'TaskSchedule decisions cannot contain duplicates.');
  return Object.freeze({
    eventId: normalizedEventId,
    expectedUpdatedAt: normalizedVersion,
    action,
    eventDraft,
    protectedTimeDecisions: Object.freeze(protectedTimeDecisions.map((item) => Object.freeze({ ...item }))),
    taskScheduleDecisions: Object.freeze(taskScheduleDecisions.map((item) => Object.freeze({ ...item }))),
  });
}

export function buildEventMutationIntent(mutation) {
  const normalized = normalizeEventMutation(mutation);
  const draftIntent = normalized.action === 'edit'
    ? buildEventCreateIntent(normalized.eventDraft).canonicalPayload
    : null;
  // Fixed positional tuple avoids object-property-order ambiguity.
  const canonicalTuple = [
    EVENT_MUTATION_INTENT_VERSION,
    normalized.eventId,
    normalized.expectedUpdatedAt,
    normalized.action,
    draftIntent,
    normalized.protectedTimeDecisions,
  ];
  const scheduleDecisions = normalized.taskScheduleDecisions
    .map((item) => [item.taskScheduleId.toLowerCase(), item.taskScheduleUpdatedAt, item.decision])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (scheduleDecisions.length) canonicalTuple.push('event-task-schedule-decision-v1', scheduleDecisions);
  const canonicalPayload = JSON.stringify(canonicalTuple);
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
