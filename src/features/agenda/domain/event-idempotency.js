import { EVENT_CREATABLE_STATUSES, EVENT_LOCATION_KINDS } from './event.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTENT_VERSION = 'simplelife.agenda.event.create.v1';

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

/**
 * Canonical user intent for one Event-create operation.
 * Excludes generated IDs, identity/timestamps and derived IANA/TZDB resolution.
 */
export function buildEventCreateIntent(eventDraft) {
  assert(eventDraft && typeof eventDraft === 'object' && !Array.isArray(eventDraft),
    'A normalized Event draft is required.');
  assert(typeof eventDraft.title === 'string' && eventDraft.title.length > 0,
    'A normalized Event title is required.');
  assert(EVENT_CREATABLE_STATUSES.includes(eventDraft.eventStatus),
    'A valid creation Event status is required.');
  assert(eventDraft.lifecycleState === 'active',
    'A new Event must start in the active lifecycle.');
  assert(eventDraft.description == null || typeof eventDraft.description === 'string',
    'Event description must be text or null.');
  assert(eventDraft.locationLabel == null || typeof eventDraft.locationLabel === 'string',
    'Event location must be text or null.');
  assert(eventDraft.locationKind == null || EVENT_LOCATION_KINDS.includes(eventDraft.locationKind),
    'Event location kind is invalid.');

  const temporal = eventDraft.temporal;
  assert(temporal && typeof temporal === 'object' && !Array.isArray(temporal),
    'A normalized Event temporal value is required.');

  let canonicalTemporal;
  if (temporal.kind === 'all_day') {
    assert(typeof temporal.startDate === 'string' && typeof temporal.endDateExclusive === 'string',
      'All-day Event dates are required.');
    canonicalTemporal = {
      kind: 'all_day',
      startDate: temporal.startDate,
      endDateExclusive: temporal.endDateExclusive,
    };
  } else if (temporal.kind === 'fixed_instant') {
    assert(typeof temporal.startsAt === 'string' && typeof temporal.endsAt === 'string',
      'Fixed-instant Event endpoints are required.');
    canonicalTemporal = {
      kind: 'fixed_instant',
      startsAt: temporal.startsAt,
      endsAt: temporal.endsAt,
      sourceTimeZone: temporal.sourceTimeZone ?? null,
    };
  } else if (temporal.kind === 'zoned_civil') {
    assert(typeof temporal.timeZone === 'string'
      && typeof temporal.startLocalDateTime === 'string'
      && typeof temporal.endLocalDateTime === 'string',
    'Zoned-civil Event timezone and local endpoints are required.');
    canonicalTemporal = {
      kind: 'zoned_civil',
      timeZone: temporal.timeZone,
      startLocalDateTime: temporal.startLocalDateTime,
      endLocalDateTime: temporal.endLocalDateTime,
      startDisambiguation: temporal.startDisambiguation,
      endDisambiguation: temporal.endDisambiguation,
      startGapStrategy: temporal.startGapStrategy,
      endGapStrategy: temporal.endGapStrategy,
    };
  } else {
    throw new RangeError('Event temporal kind is invalid.');
  }

  return Object.freeze({
    version: INTENT_VERSION,
    title: eventDraft.title,
    description: eventDraft.description ?? null,
    locationLabel: eventDraft.locationLabel ?? null,
    locationKind: eventDraft.locationKind ?? null,
    eventStatus: eventDraft.eventStatus,
    temporal: Object.freeze(canonicalTemporal),
  });
}

export function serializeEventCreateIntent(eventDraft) {
  return JSON.stringify(buildEventCreateIntent(eventDraft));
}

/** Compute SHA-256 on the trusted server; never accept a client-supplied hash. */
export async function createEventIdempotencyHash(eventDraft, cryptoProvider = globalThis.crypto) {
  assert(cryptoProvider?.subtle?.digest && typeof TextEncoder === 'function',
    'Web Crypto SHA-256 is unavailable.');
  const digest = await cryptoProvider.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serializeEventCreateIntent(eventDraft)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isEventIdempotencyKey(value) {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

/** Generate one UUIDv4 for a user intent and reuse it for transport retries. */
export function createEventIdempotencyKey(cryptoProvider = globalThis.crypto) {
  assert(typeof cryptoProvider?.randomUUID === 'function',
    'Secure UUIDv4 generation is unavailable.');
  const key = cryptoProvider.randomUUID();
  assert(isEventIdempotencyKey(key),
    'The cryptographic provider did not return a valid UUIDv4 idempotency key.');
  return key.toLowerCase();
}
