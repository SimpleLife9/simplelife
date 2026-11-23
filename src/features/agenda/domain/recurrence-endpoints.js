import { addRecurrenceCalendarDays, validateRecurrenceRule } from './recurrence.js';

const CLOCK = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:[.]([0-9]{1,3}))?)?$/;
const LOCAL_DATE_TIME = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:[.]([0-9]{1,3}))?)?$/;

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function normalizeClock(value, label) {
  assert(typeof value === 'string', label + ' must be a local clock time.');
  const match = CLOCK.exec(value);
  assert(match, label + ' must use HH:mm[:ss[.SSS]] without a timezone offset.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  assert(hour <= 23 && minute <= 59 && second <= 59, label + ' is outside the local clock range.');
  const milliseconds = (match[4] ?? '').padEnd(3, '0') || '000';
  return match[1] + ':' + match[2] + ':' + String(second).padStart(2, '0') + '.' + milliseconds;
}

function normalizeLocalDateTime(value, label) {
  assert(typeof value === 'string', label + ' must be a local date-time.');
  const match = LOCAL_DATE_TIME.exec(value);
  assert(match, label + ' must use YYYY-MM-DDTHH:mm[:ss[.SSS]] without a UTC offset.');
  const date = match[1];
  // The recurrence engine's date parser is authoritative for strict civil dates.
  const clock = normalizeClock(value.slice(11), label);
  const normalizedDate = addRecurrenceCalendarDays(date, 0);
  return normalizedDate + 'T' + clock;
}

function normalizeDayOffset(value) {
  const offset = value == null ? 0 : value;
  assert(Number.isInteger(offset) && offset >= 0 && offset <= 30,
    'endDayOffset must be an integer from 0 to 30 calendar days.');
  return offset;
}

function validateEndEndpoint(endpoint, startLocalDateTime, key, occurrence) {
  assert(endpoint && typeof endpoint === 'object' && !Array.isArray(endpoint),
    'Occurrence end override for ' + key + ' must be an object.');
  const allowed = new Set(['localDateTime', 'localTime', 'endDayOffset', 'disambiguation', 'gapStrategy']);
  assert(Object.keys(endpoint).every((field) => allowed.has(field)),
    'Occurrence end override for ' + key + ' contains unsupported fields.');
  assert(!(endpoint.localDateTime != null && (endpoint.localTime != null || endpoint.endDayOffset != null)),
    'Use either localDateTime or localTime/endDayOffset for occurrence ' + key + '.');

  const localDateTime = endpoint.localDateTime != null
    ? normalizeLocalDateTime(endpoint.localDateTime, 'end.localDateTime')
    : addRecurrenceCalendarDays(
      occurrence.actualLocalDate ?? occurrence.originalLocalDate,
      normalizeDayOffset(endpoint.endDayOffset),
    ) + 'T' + normalizeClock(endpoint.localTime, 'end.localTime');

  assert(localDateTime > startLocalDateTime,
    'Occurrence ' + key + ' must end after its effective local start.');
  const disambiguation = endpoint.disambiguation ?? occurrence.endDisambiguation ?? occurrence.disambiguation ?? 'earlier';
  const gapStrategy = endpoint.gapStrategy ?? occurrence.gapStrategy ?? 'next-valid';
  assert(disambiguation === 'earlier' || disambiguation === 'later',
    'End disambiguation must be earlier or later.');
  assert(gapStrategy === 'next-valid', 'Recurring end gap strategy is fixed to next-valid.');
  return Object.freeze({ localDateTime, disambiguation, gapStrategy });
}

/**
 * Builds the explicit civil-time end endpoints required by the atomic IANA
 * resolver. It deliberately never derives an end wall time from durationMinutes:
 * callers provide the series' local end clock and any per-occurrence exception.
 *
 * For normal occurrences, endLocalTime + endDayOffset describes the same local
 * calendar intent even when the real UTC elapsed duration changes at a DST
 * transition. The pinned resolver then resolves both endpoints atomically.
 */
export function buildRecurrenceEndEndpoints({
  occurrences,
  endLocalTime,
  endDayOffset = 0,
  occurrenceEndOverrides = {},
}) {
  assert(Array.isArray(occurrences), 'occurrences must be an array.');
  assert(occurrenceEndOverrides && typeof occurrenceEndOverrides === 'object'
    && !Array.isArray(occurrenceEndOverrides), 'occurrenceEndOverrides must be an object keyed by occurrenceKey.');
  const normalizedDefaultTime = endLocalTime == null ? null : normalizeClock(endLocalTime, 'endLocalTime');
  const normalizedOffset = normalizeDayOffset(endDayOffset);
  const result = {};
  const seen = new Set();

  for (const occurrence of occurrences) {
    assert(occurrence && typeof occurrence === 'object' && !Array.isArray(occurrence),
      'Each occurrence must be an object.');
    const key = occurrence.occurrenceKey;
    assert(typeof key === 'string' && key.trim().length > 0, 'Every occurrence requires a stable occurrenceKey.');
    assert(!seen.has(key), 'Duplicate occurrenceKey: ' + key);
    seen.add(key);
    if (occurrence.temporalKind === 'all_day') continue;
    assert(occurrence.temporalKind === 'zoned_civil', 'Occurrence temporalKind must be all_day or zoned_civil.');
    assert(occurrence.status == null || occurrence.status === 'scheduled',
      'Only scheduled future occurrences may be resolved.');
    const startDate = occurrence.actualLocalDate ?? occurrence.originalLocalDate;
    const startTime = normalizeClock(occurrence.actualLocalTime ?? occurrence.localTime, 'start.localTime');
    const startLocalDateTime = normalizeLocalDateTime(startDate + 'T' + startTime, 'start.localDateTime');
    const override = occurrenceEndOverrides[key];
    let endpoint;
    if (override != null) {
      endpoint = validateEndEndpoint(override, startLocalDateTime, key, occurrence);
    } else {
      assert(normalizedDefaultTime != null,
        'Missing explicit endLocalTime for timed recurrence occurrence ' + key + '.');
      const localDateTime = addRecurrenceCalendarDays(startDate, normalizedOffset) + 'T' + normalizedDefaultTime;
      endpoint = validateEndEndpoint({
        localDateTime,
        disambiguation: occurrence.endDisambiguation,
        gapStrategy: occurrence.gapStrategy,
      }, startLocalDateTime, key, occurrence);
    }
    result[key] = endpoint;
  }

  for (const key of Object.keys(occurrenceEndOverrides)) {
    assert(seen.has(key), 'End override supplied for unknown occurrenceKey: ' + key);
    assert(!occurrences.find((item) => item.occurrenceKey === key)?.temporalKind?.includes('all_day'),
      'All-day recurrence cannot have a timed end override.');
  }

  return Object.freeze(result);
}

/**
 * Validates that a persisted timed recurrence has both its original start and
 * explicit local end endpoint. durationMinutes remains metadata/override data,
 * not an implicit substitute for the end clock time.
 */
export function validatePersistableTimedRecurrence(ruleInput) {
  assert(ruleInput && typeof ruleInput === 'object' && typeof ruleInput.endLocalTime === 'string',
    'Timed recurrence requires an explicit endLocalTime.');
  const endLocalTime = normalizeClock(ruleInput.endLocalTime, 'endLocalTime');
  const rule = validateRecurrenceRule(ruleInput);
  assert(rule.temporalKind === 'zoned_civil', 'A timed recurrence rule is required.');
  const endDayOffset = normalizeDayOffset(ruleInput.endDayOffset);
  const startLocalDateTime = normalizeLocalDateTime(rule.startDate + 'T' + rule.localTime, 'start.localDateTime');
  const endLocalDateTime = addRecurrenceCalendarDays(rule.startDate, endDayOffset) + 'T' + endLocalTime;
  assert(endLocalDateTime > startLocalDateTime,
    'Timed recurrence endLocalTime/endDayOffset must be after its start.');
  return Object.freeze({ rule, endLocalTime, endDayOffset });
}
