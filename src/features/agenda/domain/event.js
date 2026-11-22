import {
  createAllDayRange,
  isSupportedTimeZone,
  parseCalendarDate,
  validateTimedRange,
} from './temporal.js';

export const EVENT_STATUSES = Object.freeze([
  'preparing',
  'proposed',
  'confirmed',
  'cancelled',
  'finished',
]);

export const EVENT_CREATABLE_STATUSES = Object.freeze(['preparing', 'proposed', 'confirmed']);

export const EVENT_LOCATION_KINDS = Object.freeze([
  'physical',
  'online',
  'other',
]);

export const EVENT_TITLE_MAX_LENGTH = 200;
export const EVENT_DESCRIPTION_MAX_LENGTH = 5000;
export const EVENT_LOCATION_MAX_LENGTH = 500;

const ALLOWED_EVENT_FIELDS = new Set([
  'title',
  'description',
  'locationLabel',
  'locationKind',
  'eventStatus',
  'temporalKind',
  'startDate',
  'endDateExclusive',
  'timeZone',
  'startLocalDateTime',
  'endLocalDateTime',
  'startDisambiguation',
  'endDisambiguation',
  'startGapStrategy',
  'endGapStrategy',
  'startsAt',
  'endsAt',
  'sourceTimeZone',
]);

const DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const OFFSET_INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function normalizeOptionalText(value, label, maxLength) {
  if (value == null) return null;
  assert(typeof value === 'string', label + ' must be text.');
  const normalized = value.trim();
  assert(normalized.length <= maxLength, label + ' exceeds the maximum length of ' + maxLength + '.');
  return normalized || null;
}

function normalizeLocalDateTime(value, label) {
  assert(typeof value === 'string', label + ' must be a local date-time string.');
  const match = DATE_TIME_PATTERN.exec(value);
  assert(match, label + ' must use YYYY-MM-DDTHH:mm[:ss[.SSS]] without an offset.');
  parseCalendarDate(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] ?? 0);
  assert(hour <= 23 && minute <= 59 && second <= 59, label + ' is outside the local clock range.');
  const milliseconds = (match[5] ?? '').padEnd(3, '0');
  return match[1] + 'T' + match[2] + ':' + match[3] + ':'
    + String(second).padStart(2, '0') + '.' + (milliseconds || '000');
}

function normalizeInstant(value, label) {
  assert(typeof value === 'string', label + ' must be an ISO date-time with an explicit UTC offset or Z.');
  const match = OFFSET_INSTANT_PATTERN.exec(value);
  assert(match, label + ' must be an ISO date-time with an explicit UTC offset or Z.');
  parseCalendarDate(match[1]);
  const epoch = Date.parse(value);
  assert(Number.isFinite(epoch), label + ' must be a valid instant.');
  return new Date(epoch).toISOString();
}

function normalizeDisambiguation(value, label) {
  const normalized = value ?? 'earlier';
  assert(normalized === 'earlier' || normalized === 'later',
    label + ' must be earlier or later.');
  return normalized;
}

function normalizeGapStrategy(value, label) {
  const normalized = value ?? 'next-valid';
  assert(normalized === 'next-valid', label + ' is fixed to next-valid in Phase 1.');
  return normalized;
}

function assertNoFields(input, fields, label) {
  for (const field of fields) {
    assert(input[field] == null, label + ' cannot include ' + field + '.');
  }
}

/**
 * Validates a user-authored one-off Event draft.
 *
 * This is a pure domain operation: it creates no IDs, owner fields, audit
 * metadata, database rows or UTC resolution for civil-time Events. Zoned civil
 * drafts must pass through the authenticated atomic IANA range resolver before
 * they may be treated as persistence-ready.
 */
export function createEventDraft(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input),
    'An Event draft object is required.');
  assert(Object.keys(input).every((key) => ALLOWED_EVENT_FIELDS.has(key)),
    'Event draft contains unsupported or server-owned fields.');

  const title = normalizeOptionalText(input.title, 'title', EVENT_TITLE_MAX_LENGTH);
  assert(title, 'Event title is required.');
  const description = normalizeOptionalText(input.description, 'description', EVENT_DESCRIPTION_MAX_LENGTH);
  const locationLabel = normalizeOptionalText(input.locationLabel, 'locationLabel', EVENT_LOCATION_MAX_LENGTH);
  const locationKind = input.locationKind ?? null;
  assert(locationKind == null || EVENT_LOCATION_KINDS.includes(locationKind),
    'locationKind must be physical, online or other.');
  const eventStatus = input.eventStatus ?? 'confirmed';
  assert(EVENT_CREATABLE_STATUSES.includes(eventStatus),
    'New Events may be preparing, proposed or confirmed; cancelled/finished are transitions, not creation states.');
  const temporalKind = input.temporalKind;
  assert(['all_day', 'zoned_civil', 'fixed_instant'].includes(temporalKind),
    'temporalKind must be all_day, zoned_civil or fixed_instant.');

  let temporal;
  if (temporalKind === 'all_day') {
    assertNoFields(input, [
      'timeZone', 'startLocalDateTime', 'endLocalDateTime',
      'startDisambiguation', 'endDisambiguation',
      'startGapStrategy', 'endGapStrategy', 'startsAt', 'endsAt', 'sourceTimeZone',
    ], 'An all-day Event');
    const range = createAllDayRange(input.startDate, input.endDateExclusive);
    temporal = Object.freeze({
      kind: 'all_day',
      startDate: range.startDate,
      endDateExclusive: range.endDateExclusive,
      dayCount: range.dayCount,
    });
  } else if (temporalKind === 'zoned_civil') {
    assertNoFields(input, [
      'startDate', 'endDateExclusive', 'startsAt', 'endsAt', 'sourceTimeZone',
    ], 'A zoned civil-time Event');
    assert(typeof input.timeZone === 'string' && isSupportedTimeZone(input.timeZone),
      'timeZone must be a supported IANA identifier.');
    const startLocalDateTime = normalizeLocalDateTime(input.startLocalDateTime, 'startLocalDateTime');
    const endLocalDateTime = normalizeLocalDateTime(input.endLocalDateTime, 'endLocalDateTime');
    const startDisambiguation = normalizeDisambiguation(input.startDisambiguation, 'startDisambiguation');
    const endDisambiguation = normalizeDisambiguation(input.endDisambiguation, 'endDisambiguation');
    const startGapStrategy = normalizeGapStrategy(input.startGapStrategy, 'startGapStrategy');
    const endGapStrategy = normalizeGapStrategy(input.endGapStrategy, 'endGapStrategy');
    temporal = Object.freeze({
      kind: 'zoned_civil',
      timeZone: input.timeZone,
      startLocalDateTime,
      endLocalDateTime,
      startDisambiguation,
      endDisambiguation,
      startGapStrategy,
      endGapStrategy,
      resolutionState: 'needs_authoritative_resolution',
    });
  } else {
    assertNoFields(input, [
      'startDate', 'endDateExclusive', 'timeZone',
      'startLocalDateTime', 'endLocalDateTime',
      'startDisambiguation', 'endDisambiguation',
      'startGapStrategy', 'endGapStrategy',
    ], 'A fixed-instant Event');
    const range = validateTimedRange(
      normalizeInstant(input.startsAt, 'startsAt'),
      normalizeInstant(input.endsAt, 'endsAt'),
    );
    const sourceTimeZone = input.sourceTimeZone ?? null;
    assert(sourceTimeZone == null || (
      typeof sourceTimeZone === 'string' && isSupportedTimeZone(sourceTimeZone)
    ), 'sourceTimeZone must be a supported IANA identifier when supplied.');
    temporal = Object.freeze({
      kind: 'fixed_instant',
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      sourceTimeZone,
    });
  }

  return Object.freeze({
    title,
    description,
    locationLabel,
    locationKind,
    eventStatus,
    lifecycleState: 'active',
    temporal,
  });
}

/**
 * Builds the authenticated Edge Function payload for one zoned civil Event.
 * All-day and fixed-instant Events do not use the IANA wall-time resolver.
 */
export function buildEventTimeResolutionRequest(eventDraft) {
  assert(eventDraft && typeof eventDraft === 'object' && eventDraft.temporal,
    'A normalized Event draft is required.');
  assert(eventDraft.temporal.kind === 'zoned_civil',
    'Only zoned civil-time Events require IANA range resolution.');
  const temporal = eventDraft.temporal;
  return Object.freeze({
    timeZone: temporal.timeZone,
    start: Object.freeze({
      localDateTime: temporal.startLocalDateTime,
      disambiguation: temporal.startDisambiguation,
      gapStrategy: temporal.startGapStrategy,
    }),
    end: Object.freeze({
      localDateTime: temporal.endLocalDateTime,
      disambiguation: temporal.endDisambiguation,
      gapStrategy: temporal.endGapStrategy,
    }),
  });
}

/**
 * Attaches only a matching, authoritative atomic resolver result to a zoned
 * Event draft. A device Intl preview or a stale/mismatched endpoint cannot be
 * promoted to a canonical persisted interval.
 */
export function applyAuthoritativeEventResolution(eventDraft, response) {
  assert(eventDraft && typeof eventDraft === 'object' && eventDraft.temporal?.kind === 'zoned_civil',
    'A zoned civil-time Event draft is required.');
  assert(response && typeof response === 'object' && !Array.isArray(response),
    'An authoritative IANA resolver response is required.');
  const temporal = eventDraft.temporal;

  assert(response.authoritative === true && response.rulesSource === 'iana-tzdb',
    'Event resolution must come from the authoritative IANA TZDB resolver.');
  assert(response.requestedTimeZone === temporal.timeZone,
    'Resolver timezone does not match the Event draft.');
  assert(typeof response.timeZone === 'string' && response.timeZone.length > 0,
    'Resolver response must include its canonical timezone.');
  assert(typeof response.rulesVersion === 'string' && response.rulesVersion.length > 0,
    'Resolver response must include a TZDB version.');
  assert(typeof response.resolverVersion === 'string' && response.resolverVersion.length > 0,
    'Resolver response must include a resolver version.');
  assert(response.start && response.end, 'Resolver response must include both endpoint results.');

  for (const [label, endpoint, requested] of [
    ['start', response.start, temporal.startLocalDateTime],
    ['end', response.end, temporal.endLocalDateTime],
  ]) {
    assert(endpoint.authoritative === true && endpoint.rulesSource === response.rulesSource,
      label + ' endpoint is not authoritative.');
    assert(endpoint.requestedLocalDateTime === requested,
      label + ' endpoint does not match the requested Event wall time.');
    assert(endpoint.timeZone === response.timeZone,
      label + ' endpoint canonical timezone does not match the range.');
    assert(endpoint.rulesVersion === response.rulesVersion,
      label + ' endpoint TZDB version does not match the range.');
    assert(endpoint.resolverVersion === response.resolverVersion,
      label + ' endpoint resolver version does not match the range.');
    const requestedDisambiguation = temporal[label + 'Disambiguation'];
    if (endpoint.resolution === 'ambiguous-first') {
      assert(requestedDisambiguation === 'earlier',
        label + ' endpoint ignored the requested later fold choice.');
    }
    if (endpoint.resolution === 'ambiguous-later') {
      assert(requestedDisambiguation === 'later',
        label + ' endpoint ignored the requested earlier fold choice.');
    }
  }

  assert(response.start.instant === response.startsAt && response.end.instant === response.endsAt,
    'Resolver endpoint instants do not match the returned UTC range.');
  const range = validateTimedRange(response.startsAt, response.endsAt);

  const resolvedTemporal = Object.freeze({
    ...temporal,
    canonicalTimeZone: response.timeZone,
    startsAt: range.startsAt,
    endsAt: range.endsAt,
    resolutionState: 'authoritatively_resolved',
    resolverMetadata: Object.freeze({
      rulesSource: response.rulesSource,
      rulesVersion: response.rulesVersion,
      resolverVersion: response.resolverVersion,
      start: response.start,
      end: response.end,
    }),
  });

  return Object.freeze({
    ...eventDraft,
    temporal: resolvedTemporal,
  });
}
