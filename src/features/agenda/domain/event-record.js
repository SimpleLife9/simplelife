import {
  EVENT_CREATABLE_STATUSES,
  EVENT_LOCATION_KINDS,
} from './event.js';
import {
  createAllDayRange,
  parseCalendarDate,
  validateTimedRange,
} from './temporal.js';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;
const OFFSET_INSTANT_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;

/**
 * This serializer targets the proposed one-off public.calendar_event shape in
 * docs/PHASE_1_AGENDA_DATA_CONTRACT.md. It performs no I/O and does not grant
 * permission to create or apply a database migration.
 *
 * Call it only inside the authenticated server writer, after verifying the
 * caller JWT, resolving the profile, and generating eventId with the trusted
 * server-side UUIDv7 helper. Never pass identity values from caller JSON.
 */
function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function normalizeUuidV7(value, label) {
  assert(typeof value === 'string' && UUID_V7_PATTERN.test(value),
    label + ' must be a valid UUIDv7.');
  return value.toLowerCase();
}

function normalizeInstant(value, label) {
  assert(typeof value === 'string' && OFFSET_INSTANT_PATTERN.test(value),
    label + ' must include an explicit UTC offset or Z.');
  const epoch = Date.parse(value);
  assert(Number.isFinite(epoch), label + ' must be a valid instant.');
  return new Date(epoch).toISOString();
}

function normalizeLocalDateTime(value, label) {
  assert(typeof value === 'string', label + ' must be a local date-time.');
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  assert(match, label + ' must use YYYY-MM-DDTHH:mm:ss.SSS without an offset.');
  parseCalendarDate(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  assert(hour <= 23 && minute <= 59 && second <= 59,
    label + ' is outside the local clock range.');
  return value;
}

function normalizeTimestamp(value) {
  assert(typeof value === 'string', 'now must be an explicit ISO timestamp.');
  return normalizeInstant(value, 'now');
}

function assertTextOrNull(value, label) {
  assert(value == null || typeof value === 'string', label + ' must be text or null.');
}

function assertZonedResolution(temporal) {
  assert(temporal.resolutionState === 'authoritatively_resolved',
    'Zoned civil-time Events require an authoritative IANA resolution before persistence.');
  assert(typeof temporal.canonicalTimeZone === 'string' && temporal.canonicalTimeZone === temporal.timeZone,
    'The canonical timezone must match the requested Event timezone.');
  assert(typeof temporal.resolverMetadata === 'object' && temporal.resolverMetadata !== null,
    'Authoritative resolver metadata is required.');
  const metadata = temporal.resolverMetadata;
  assert(metadata.rulesSource === 'iana-tzdb',
    'Only the authoritative IANA TZDB resolver may authorize persistence.');
  assert(typeof metadata.rulesVersion === 'string' && metadata.rulesVersion.length > 0,
    'A TZDB rules version is required.');
  assert(typeof metadata.resolverVersion === 'string' && metadata.resolverVersion.length > 0,
    'A resolver version is required.');
  for (const [label, localDateTime] of [
    ['start', temporal.startLocalDateTime],
    ['end', temporal.endLocalDateTime],
  ]) {
    const endpoint = metadata[label];
    assert(endpoint && endpoint.authoritative === true && endpoint.rulesSource === 'iana-tzdb',
      label + ' resolver endpoint must be authoritative.');
    assert(endpoint.requestedLocalDateTime === localDateTime,
      label + ' resolver endpoint does not match the Event wall time.');
    assert(endpoint.rulesVersion === metadata.rulesVersion
      && endpoint.resolverVersion === metadata.resolverVersion,
    label + ' resolver version metadata is inconsistent.');
  }
}

function createCommonRecord({ eventDraft, eventId, ownerProfileId, timestamp }) {
  assert(eventDraft && typeof eventDraft === 'object' && !Array.isArray(eventDraft),
    'A normalized Event draft is required.');
  assert(EVENT_CREATABLE_STATUSES.includes(eventDraft.eventStatus),
    'Event status is not valid for creation.');
  assert(eventDraft.lifecycleState === 'active',
    'A newly created Event must begin in the active lifecycle.');
  assert(typeof eventDraft.title === 'string' && eventDraft.title.trim().length > 0,
    'A normalized Event title is required.');
  assertTextOrNull(eventDraft.description, 'description');
  assertTextOrNull(eventDraft.locationLabel, 'locationLabel');
  assert(eventDraft.locationKind == null || EVENT_LOCATION_KINDS.includes(eventDraft.locationKind),
    'locationKind must be physical, online or other.');

  return {
    id: normalizeUuidV7(eventId, 'eventId'),
    owner_user_id: normalizeUuidV7(ownerProfileId, 'ownerProfileId'),
    created_by_user_id: normalizeUuidV7(ownerProfileId, 'ownerProfileId'),
    updated_by_user_id: normalizeUuidV7(ownerProfileId, 'ownerProfileId'),
    title: eventDraft.title,
    description: eventDraft.description ?? null,
    location_label: eventDraft.locationLabel ?? null,
    location_kind: eventDraft.locationKind ?? null,
    event_status: eventDraft.eventStatus,
    temporal_kind: eventDraft.temporal.kind,
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Maps one validated one-off Event into the proposed database insert shape.
 *
 * ownerProfileId must come from the verified JWT -> user_profile lookup.
 * eventId must be generated server-side. The caller cannot supply either value
 * through the Event draft. This helper is a mapping guard, not an auth boundary.
 */
/**
 * @param {{
 *   eventDraft: any,
 *   eventId: string,
 *   ownerProfileId: string,
 *   now: string,
 *   protectedTimeDecisions?: readonly Record<string, unknown>[],
 *   protectedTimeSnapshot?: readonly { id: string; updated_at: string }[],
 * }} input
 */
export function buildEventInsertRecord({
  eventDraft,
  eventId,
  ownerProfileId,
  now,
  protectedTimeDecisions = /** @type {Record<string, unknown>[]} */ ([]),
  protectedTimeSnapshot = /** @type {{ id: string; updated_at: string }[]} */ ([]),
}) {
  const timestamp = normalizeTimestamp(now);
  const record = createCommonRecord({
    eventDraft,
    eventId,
    ownerProfileId,
    timestamp,
  });
  assert(Array.isArray(protectedTimeDecisions) && protectedTimeDecisions.length <= 500,
    'protectedTimeDecisions must be an array with at most 500 entries.');
  assert(protectedTimeDecisions.every((item) => item && typeof item === 'object' && !Array.isArray(item)),
    'Every protected-time decision must be an object.');
  assert(Array.isArray(protectedTimeSnapshot) && protectedTimeSnapshot.length <= 500,
    'protectedTimeSnapshot must be an array with at most 500 entries.');
  assert(protectedTimeSnapshot.every((item) => item && typeof item.id === 'string'
    && UUID_V7_PATTERN.test(item.id) && typeof item.updated_at === 'string'
    && Number.isFinite(Date.parse(item.updated_at))),
  'Every Protected Time snapshot entry must contain a UUIDv7 and updated_at timestamp.');
  record.protected_time_decisions = protectedTimeDecisions.map((item) => ({ ...item }));
  // Transient RPC evidence: the SQL writer compares this full owner snapshot after
  // acquiring the same advisory lock as Protected Time mutations. It is not stored.
  record.protected_time_snapshot = protectedTimeSnapshot.map((item) => ({
    id: item.id.toLowerCase(),
    updated_at: item.updated_at,
  }));
  const temporal = eventDraft.temporal;
  assert(temporal && typeof temporal === 'object', 'A normalized Event temporal value is required.');

  const emptyTemporalColumns = {
    start_date: null,
    end_date_exclusive: null,
    start_local: null,
    end_local: null,
    time_zone: null,
    starts_at: null,
    ends_at: null,
    start_disambiguation: null,
    end_disambiguation: null,
    start_gap_strategy: null,
    end_gap_strategy: null,
  };

  if (temporal.kind === 'all_day') {
    const range = createAllDayRange(temporal.startDate, temporal.endDateExclusive);
    return Object.freeze({
      ...record,
      ...emptyTemporalColumns,
      start_date: range.startDate,
      end_date_exclusive: range.endDateExclusive,
    });
  }

  if (temporal.kind === 'fixed_instant') {
    const range = validateTimedRange(
      normalizeInstant(temporal.startsAt, 'startsAt'),
      normalizeInstant(temporal.endsAt, 'endsAt'),
    );
    const sourceTimeZone = temporal.sourceTimeZone ?? null;
    assert(sourceTimeZone == null || (
      typeof sourceTimeZone === 'string' && sourceTimeZone.length > 0
    ), 'sourceTimeZone must be text or null.');
    return Object.freeze({
      ...record,
      ...emptyTemporalColumns,
      time_zone: sourceTimeZone,
      starts_at: range.startsAt,
      ends_at: range.endsAt,
    });
  }

  assert(temporal.kind === 'zoned_civil',
    'temporal.kind must be all_day, zoned_civil or fixed_instant.');
  assertZonedResolution(temporal);
  const startLocal = normalizeLocalDateTime(temporal.startLocalDateTime, 'startLocalDateTime');
  const endLocal = normalizeLocalDateTime(temporal.endLocalDateTime, 'endLocalDateTime');
  const range = validateTimedRange(
    normalizeInstant(temporal.startsAt, 'startsAt'),
    normalizeInstant(temporal.endsAt, 'endsAt'),
  );
  return Object.freeze({
    ...record,
    ...emptyTemporalColumns,
    start_local: startLocal,
    end_local: endLocal,
    time_zone: temporal.canonicalTimeZone,
    starts_at: range.startsAt,
    ends_at: range.endsAt,
    start_disambiguation: temporal.startDisambiguation,
    end_disambiguation: temporal.endDisambiguation,
    start_gap_strategy: temporal.startGapStrategy,
    end_gap_strategy: temporal.endGapStrategy,
  });
}
