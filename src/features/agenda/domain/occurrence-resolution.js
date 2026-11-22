import { parseCalendarDate } from './temporal.js';

export const IANA_RANGE_BATCH_LIMIT = 25;

const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function normalizeLocalDateTime(value, label) {
  assert(typeof value === 'string', `${label} must be a local date-time string.`);
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  assert(match, `${label} must use YYYY-MM-DDTHH:mm[:ss[.SSS]] without an offset.`);
  parseCalendarDate(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] ?? 0);
  assert(hour <= 23 && minute <= 59 && second <= 59, `${label} is outside the local clock range.`);
  const milliseconds = (match[5] ?? '').padEnd(3, '0');
  return `${match[1]}T${match[2]}:${match[3]}:${String(second).padStart(2, '0')}.${milliseconds || '000'}`;
}

function normalizeEndEndpoint(value, occurrence) {
  const endpoint = typeof value === 'string' ? { localDateTime: value } : value;
  assert(endpoint && typeof endpoint === 'object' && !Array.isArray(endpoint), 'Each timed occurrence requires an explicit end endpoint.');
  const allowed = new Set(['localDateTime', 'disambiguation', 'gapStrategy']);
  assert(Object.keys(endpoint).every((key) => allowed.has(key)), 'End endpoint contains unsupported fields.');
  const disambiguation = endpoint.disambiguation ?? occurrence.endDisambiguation ?? occurrence.disambiguation ?? 'earlier';
  const gapStrategy = endpoint.gapStrategy ?? occurrence.gapStrategy ?? 'next-valid';
  assert(disambiguation === 'earlier' || disambiguation === 'later', 'End endpoint disambiguation must be earlier or later.');
  assert(gapStrategy === 'next-valid', 'Recurring end endpoint gap strategy is fixed to next-valid.');
  return Object.freeze({
    localDateTime: normalizeLocalDateTime(endpoint.localDateTime, 'end.localDateTime'),
    disambiguation,
    gapStrategy,
  });
}

/**
 * Converts already-planned occurrences into ordered, bounded IANA resolver
 * requests. End wall times must be supplied explicitly by occurrenceKey:
 * this adapter deliberately does not infer elapsed-vs-civil duration semantics.
 * All-day occurrences are kept date-only and never enter a resolver batch.
 */
export function planOccurrenceResolutionBatches({
  occurrences,
  endByOccurrenceKey,
  maxRangesPerBatch = IANA_RANGE_BATCH_LIMIT,
}) {
  assert(Array.isArray(occurrences), 'occurrences must be an array.');
  assert(endByOccurrenceKey && typeof endByOccurrenceKey === 'object'
    && !Array.isArray(endByOccurrenceKey), 'endByOccurrenceKey must be an object keyed by occurrenceKey.');
  assert(Number.isInteger(maxRangesPerBatch)
    && maxRangesPerBatch >= 1
    && maxRangesPerBatch <= IANA_RANGE_BATCH_LIMIT,
  `maxRangesPerBatch must be from 1 to ${IANA_RANGE_BATCH_LIMIT}.`);

  const seen = new Set();
  const timed = [];
  const allDayOccurrences = [];

  for (const occurrence of occurrences) {
    assert(occurrence && typeof occurrence === 'object' && !Array.isArray(occurrence), 'Each occurrence must be an object.');
    const { occurrenceKey, temporalKind } = occurrence;
    assert(typeof occurrenceKey === 'string' && occurrenceKey.trim().length > 0, 'Every occurrence requires a stable occurrenceKey.');
    assert(!seen.has(occurrenceKey), 'Duplicate occurrenceKey in resolution plan: ' + occurrenceKey);
    seen.add(occurrenceKey);

    assert(occurrence.status == null || occurrence.status === 'scheduled', 'Only scheduled future occurrences may be sent for new time resolution.');
    const originalLocalDate = parseCalendarDate(occurrence.originalLocalDate).key;

    if (temporalKind === 'all_day') {
      const actualLocalDate = parseCalendarDate(occurrence.actualLocalDate ?? originalLocalDate).key;
      allDayOccurrences.push(Object.freeze({
        occurrenceKey,
        originalLocalDate,
        actualLocalDate,
        temporalKind: 'all_day',
        status: occurrence.status ?? 'scheduled',
      }));
      continue;
    }

    assert(temporalKind === 'zoned_civil', 'Occurrence temporalKind must be all_day or zoned_civil.');
    assert(typeof occurrence.timeZone === 'string' && occurrence.timeZone.trim().length > 0, 'Timed occurrence requires an IANA timeZone.');
    assert(Number.isInteger(occurrence.durationMinutes) && occurrence.durationMinutes > 0, 'Timed occurrence requires a positive durationMinutes.');
    const actualLocalDate = parseCalendarDate(occurrence.actualLocalDate ?? originalLocalDate).key;
    assert(typeof occurrence.actualLocalTime === 'string', 'Timed occurrence requires actualLocalTime.');
    const actualLocalTime = occurrence.actualLocalTime;
    const startLocalDateTime = normalizeLocalDateTime(`${actualLocalDate}T${actualLocalTime}`, 'start.localDateTime');
    const disambiguation = occurrence.disambiguation ?? 'earlier';
    const gapStrategy = occurrence.gapStrategy ?? 'next-valid';
    assert(disambiguation === 'earlier' || disambiguation === 'later', 'Start endpoint disambiguation must be earlier or later.');
    assert(gapStrategy === 'next-valid', 'Recurring start endpoint gap strategy is fixed to next-valid.');
    assert(Object.prototype.hasOwnProperty.call(endByOccurrenceKey, occurrenceKey),
      'Missing explicit end endpoint for occurrenceKey: ' + occurrenceKey);

    timed.push(Object.freeze({
      occurrenceKey,
      range: Object.freeze({
        timeZone: occurrence.timeZone,
        start: Object.freeze({ localDateTime: startLocalDateTime, disambiguation, gapStrategy }),
        end: normalizeEndEndpoint(endByOccurrenceKey[occurrenceKey], occurrence),
      }),
    }));
  }

  for (const key of Object.keys(endByOccurrenceKey)) {
    assert(timed.some((entry) => entry.occurrenceKey === key),
      'End endpoint supplied for an unknown or all-day occurrenceKey: ' + key);
  }

  const batches = [];
  for (let offset = 0; offset < timed.length; offset += maxRangesPerBatch) {
    const slice = timed.slice(offset, offset + maxRangesPerBatch);
    batches.push(Object.freeze({
      batchIndex: batches.length,
      occurrenceKeys: Object.freeze(slice.map((entry) => entry.occurrenceKey)),
      payload: Object.freeze({ ranges: Object.freeze(slice.map((entry) => entry.range)) }),
    }));
  }

  return Object.freeze({
    totalOccurrences: occurrences.length,
    timedOccurrenceCount: timed.length,
    allDayOccurrenceCount: allDayOccurrences.length,
    allDayOccurrences: Object.freeze(allDayOccurrences),
    batches: Object.freeze(batches),
  });
}

/**
 * Joins one authoritative resolver batch to the stable occurrence keys that
 * generated it. Count, ordering, TZDB/resolver identity and UTC intervals are
 * checked before any result is returned; mismatched/stale responses fail closed.
 */
export function joinOccurrenceResolutionBatch(batch, response) {
  assert(batch && typeof batch === 'object' && Array.isArray(batch.occurrenceKeys), 'A planned resolver batch is required.');
  assert(batch.payload && Array.isArray(batch.payload.ranges), 'Planned batch payload is missing.');
  assert(batch.payload.ranges.length === batch.occurrenceKeys.length, 'Planned batch keys and ranges must have the same length.');
  assert(response && typeof response === 'object' && !Array.isArray(response), 'Resolver response must be an object.');
  assert(response.authoritative === true, 'Resolver response must be authoritative.');
  assert(response.rulesSource === 'iana-tzdb', 'Resolver response must use the pinned IANA TZDB source.');
  assert(typeof response.rulesVersion === 'string' && response.rulesVersion.length > 0, 'Resolver response requires a TZDB version.');
  assert(typeof response.resolverVersion === 'string' && response.resolverVersion.length > 0, 'Resolver response requires a resolver version.');
  assert(Number.isInteger(response.count) && response.count === batch.occurrenceKeys.length, 'Resolver response count does not match the planned batch.');
  assert(Array.isArray(response.results) && response.results.length === batch.occurrenceKeys.length,
    'Resolver response results do not match the planned batch size.');

  const joined = response.results.map((result, index) => {
    const range = batch.payload.ranges[index];
    assert(result && typeof result === 'object', 'Resolver result must be an object.');
    assert(result.authoritative === true, 'Each resolver result must be authoritative.');
    assert(result.rulesSource === response.rulesSource, 'Resolver result rules source differs from batch metadata.');
    assert(result.rulesVersion === response.rulesVersion, 'Resolver result TZDB version differs from batch metadata.');
    assert(result.resolverVersion === response.resolverVersion, 'Resolver result resolver version differs from batch metadata.');
    assert(result.requestedTimeZone === range.timeZone, 'Resolver result timezone does not match its planned occurrence.');
    assert(result.start && result.end, 'Resolver result must include endpoint resolution metadata.');
    assert(result.start?.requestedLocalDateTime === range.start.localDateTime,
      'Resolver result start does not match the planned occurrence order.');
    assert(result.end?.requestedLocalDateTime === range.end.localDateTime,
      'Resolver result end does not match the planned occurrence order.');
    assert(result.start.rulesSource === response.rulesSource
      && result.end.rulesSource === response.rulesSource,
    'Resolver endpoint rules sources differ from batch metadata.');
    assert(result.start.rulesVersion === response.rulesVersion
      && result.end.rulesVersion === response.rulesVersion,
    'Resolver endpoint TZDB versions differ from batch metadata.');
    assert(result.start.resolverVersion === response.resolverVersion
      && result.end.resolverVersion === response.resolverVersion,
    'Resolver endpoint resolver versions differ from batch metadata.');
    assert(result.start.timeZone === result.timeZone && result.end.timeZone === result.timeZone,
      'Resolver endpoint canonical timezones differ from range metadata.');
    const startsAt = Date.parse(result.startsAt);
    const endsAt = Date.parse(result.endsAt);
    assert(Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt > startsAt,
      'Resolver result must contain a positive, valid UTC interval.');
    assert(result.start.instant === result.startsAt && result.end.instant === result.endsAt,
      'Resolver endpoint instants differ from the returned UTC interval.');

    return Object.freeze({
      occurrenceKey: batch.occurrenceKeys[index],
      requestedTimeZone: result.requestedTimeZone,
      timeZone: result.timeZone,
      startsAt: result.startsAt,
      endsAt: result.endsAt,
      startResolution: result.start,
      endResolution: result.end,
      rulesSource: response.rulesSource,
      rulesVersion: response.rulesVersion,
      resolverVersion: response.resolverVersion,
      authoritative: true,
    });
  });

  return Object.freeze(joined);
}
