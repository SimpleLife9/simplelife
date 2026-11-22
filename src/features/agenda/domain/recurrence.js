import { isSupportedTimeZone, parseCalendarDate } from './temporal.js';

export const RECURRENCE_RULE_VERSION = 1;
export const MATERIALIZATION_HORIZON_DAYS = 90;
export const MATERIALIZATION_BATCH_LIMIT = 500;
const MAX_SCAN_DAYS = 200_000;
const WEEKDAY_CODES = Object.freeze(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
const WEEKDAY_INDEX = Object.freeze({ SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 });
const LOCAL_TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const ALLOWED_RULE_KEYS = new Set([
  'version', 'frequency', 'interval', 'startDate', 'temporalKind', 'timeZone',
  'localTime', 'durationMinutes', 'byWeekday', 'byMonthDay',
  'byOrdinalWeekday', 'byMonth', 'count', 'until', 'excludedDates',
  'disambiguation', 'gapStrategy',
]);

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function dateEpochDay(value) {
  const { year, month, day } = parseCalendarDate(value);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 86_400_000);
}

function dateFromEpochDay(epochDay) {
  return new Date(epochDay * 86_400_000).toISOString().slice(0, 10);
}

function addCalendarDays(value, amount) {
  return dateFromEpochDay(dateEpochDay(value) + amount);
}

function daysInMonth(year, month) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCDate();
}

function weekdayForEpochDay(epochDay) {
  return new Date(epochDay * 86_400_000).getUTCDay();
}

function monthIndex(year, month) {
  return year * 12 + month - 1;
}

function normalizeLocalTime(value) {
  assert(typeof value === 'string', 'Timed recurrence requires localTime.');
  const match = LOCAL_TIME_PATTERN.exec(value);
  assert(match, 'localTime must use HH:mm, HH:mm:ss or HH:mm:ss.SSS.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  const millisecond = Number((match[4] ?? '').padEnd(3, '0') || 0);
  assert(hour <= 23 && minute <= 59 && second <= 59, 'localTime is outside the clock range.');
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(millisecond).padStart(3, '0')}`;
}

function normalizeOrdinalWeekday(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'byOrdinalWeekday must be an object.');
  assert(Object.keys(value).every((key) => ['ordinal', 'weekday'].includes(key)), 'byOrdinalWeekday contains unsupported fields.');
  const { ordinal, weekday } = value;
  assert(Number.isInteger(ordinal) && (ordinal === -1 || (ordinal >= 1 && ordinal <= 4)), 'ordinal must be -1 or an integer from 1 to 4.');
  assert(WEEKDAY_CODES.includes(weekday), 'weekday must be an ISO weekday code.');
  return Object.freeze({ ordinal, weekday });
}

function normalizeMonthDay(value) {
  if (value === 'LAST') return value;
  assert(Number.isInteger(value) && value >= 1 && value <= 31, 'byMonthDay must be 1..31 or LAST.');
  return value;
}

/**
 * Validates and freezes the deliberately bounded, versioned Agenda recurrence grammar.
 * COUNT counts rule-generated slots before EXDATE exclusions; UNTIL is inclusive.
 */
export function validateRecurrenceRule(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'A recurrence rule object is required.');
  assert(Object.keys(input).every((key) => ALLOWED_RULE_KEYS.has(key)), 'Recurrence rule contains unsupported fields.');
  assert(input.version === RECURRENCE_RULE_VERSION, `Only recurrence rule version ${RECURRENCE_RULE_VERSION} is supported.`);
  assert(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(input.frequency), 'frequency must be DAILY, WEEKLY, MONTHLY or YEARLY.');
  assert(input.temporalKind === 'all_day' || input.temporalKind === 'zoned_civil', 'temporalKind must be all_day or zoned_civil.');

  const startDate = parseCalendarDate(input.startDate).key;
  const interval = input.interval ?? 1;
  assert(Number.isInteger(interval) && interval >= 1 && interval <= 1000, 'interval must be an integer from 1 to 1000.');

  const count = input.count;
  const until = input.until == null ? null : parseCalendarDate(input.until).key;
  assert(count == null || (Number.isInteger(count) && count >= 1 && count <= 1_000_000), 'count must be an integer from 1 to 1000000.');
  assert(!(count != null && until != null), 'Use either count or until, not both.');
  assert(until == null || until >= startDate, 'until cannot be before startDate.');

  const excludedDates = input.excludedDates ?? [];
  assert(Array.isArray(excludedDates), 'excludedDates must be an array of calendar dates.');
  const normalizedExclusions = [...new Set(excludedDates.map((value) => parseCalendarDate(value).key))].sort();

  let localTime = null;
  let timeZone = null;
  let durationMinutes = null;
  let disambiguation = 'earlier';
  if (input.temporalKind === 'zoned_civil') {
    localTime = normalizeLocalTime(input.localTime);
    assert(typeof input.timeZone === 'string' && isSupportedTimeZone(input.timeZone), 'timeZone must be a supported IANA timezone.');
    timeZone = input.timeZone;
    durationMinutes = input.durationMinutes;
    assert(Number.isInteger(durationMinutes) && durationMinutes >= 1 && durationMinutes <= 43_200, 'durationMinutes must be an integer from 1 to 43200.');
    disambiguation = input.disambiguation ?? 'earlier';
    assert(disambiguation === 'earlier' || disambiguation === 'later', 'disambiguation must be earlier or later.');
    assert(input.gapStrategy == null || input.gapStrategy === 'next-valid', 'Recurring gapStrategy is fixed to next-valid in v1.');
  } else {
    assert(input.localTime == null && input.timeZone == null && input.durationMinutes == null, 'All-day recurrence is date-only and cannot include localTime, timeZone or durationMinutes.');
    assert(input.disambiguation == null && input.gapStrategy == null, 'All-day recurrence does not use DST settings.');
  }

  let byWeekday = null;
  let byMonthDay = null;
  let byOrdinalWeekday = null;
  let byMonth = null;

  if (input.frequency === 'DAILY') {
    assert(input.byWeekday == null && input.byMonthDay == null && input.byOrdinalWeekday == null && input.byMonth == null, 'DAILY does not accept weekday or month selectors.');
  } else if (input.frequency === 'WEEKLY') {
    assert(Array.isArray(input.byWeekday) && input.byWeekday.length > 0, 'WEEKLY requires a non-empty byWeekday array.');
    assert(input.byMonthDay == null && input.byOrdinalWeekday == null && input.byMonth == null, 'WEEKLY accepts only byWeekday.');
    assert(input.byWeekday.every((day) => WEEKDAY_CODES.includes(day)), 'byWeekday contains an invalid ISO weekday code.');
    byWeekday = Object.freeze([...new Set(input.byWeekday)].sort((a, b) => WEEKDAY_CODES.indexOf(a) - WEEKDAY_CODES.indexOf(b)));
  } else if (input.frequency === 'MONTHLY') {
    assert(input.byMonth == null, 'MONTHLY does not accept byMonth.');
    assert((input.byMonthDay == null) !== (input.byOrdinalWeekday == null), 'MONTHLY requires exactly one of byMonthDay or byOrdinalWeekday.');
    byMonthDay = input.byMonthDay == null ? null : normalizeMonthDay(input.byMonthDay);
    byOrdinalWeekday = input.byOrdinalWeekday == null ? null : normalizeOrdinalWeekday(input.byOrdinalWeekday);
  } else {
    assert(Number.isInteger(input.byMonth) && input.byMonth >= 1 && input.byMonth <= 12, 'YEARLY requires byMonth from 1 to 12.');
    assert((input.byMonthDay == null) !== (input.byOrdinalWeekday == null), 'YEARLY requires exactly one of byMonthDay or byOrdinalWeekday.');
    byMonth = input.byMonth;
    byMonthDay = input.byMonthDay == null ? null : normalizeMonthDay(input.byMonthDay);
    byOrdinalWeekday = input.byOrdinalWeekday == null ? null : normalizeOrdinalWeekday(input.byOrdinalWeekday);
  }

  return Object.freeze({
    version: RECURRENCE_RULE_VERSION,
    frequency: input.frequency,
    interval,
    startDate,
    temporalKind: input.temporalKind,
    ...(timeZone ? { timeZone, localTime, durationMinutes, disambiguation, gapStrategy: 'next-valid' } : {}),
    ...(byWeekday ? { byWeekday } : {}),
    ...(byMonthDay != null ? { byMonthDay } : {}),
    ...(byOrdinalWeekday ? { byOrdinalWeekday } : {}),
    ...(byMonth != null ? { byMonth } : {}),
    ...(count != null ? { count } : {}),
    ...(until ? { until } : {}),
    excludedDates: Object.freeze(normalizedExclusions),
  });
}

function matchesOrdinalWeekday(parts, selector) {
  const weekday = WEEKDAY_INDEX[selector.weekday];
  const currentWeekday = weekdayForEpochDay(dateEpochDay(`${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`));
  if (currentWeekday !== weekday) return false;
  if (selector.ordinal === -1) return parts.day + 7 > daysInMonth(parts.year, parts.month);
  return Math.floor((parts.day - 1) / 7) + 1 === selector.ordinal;
}

function matchesSelector(parts, rule) {
  if (rule.byMonthDay === 'LAST') return parts.day === daysInMonth(parts.year, parts.month);
  if (Number.isInteger(rule.byMonthDay)) return parts.day === rule.byMonthDay;
  return matchesOrdinalWeekday(parts, rule.byOrdinalWeekday);
}

function matchesRuleDate(value, rule, startEpochDay, epochDay) {
  const parts = parseCalendarDate(value);
  if (epochDay < startEpochDay) return false;

  if (rule.frequency === 'DAILY') {
    return (epochDay - startEpochDay) % rule.interval === 0;
  }
  if (rule.frequency === 'WEEKLY') {
    const startWeekday = weekdayForEpochDay(startEpochDay);
    const mondayOffset = (startWeekday + 6) % 7;
    const weekIndex = Math.floor((epochDay - (startEpochDay - mondayOffset)) / 7);
    return weekIndex % rule.interval === 0 && rule.byWeekday.includes(WEEKDAY_CODES[(weekdayForEpochDay(epochDay) + 6) % 7]);
  }
  if (rule.frequency === 'MONTHLY') {
    const monthDifference = monthIndex(parts.year, parts.month) - monthIndex(parseCalendarDate(rule.startDate).year, parseCalendarDate(rule.startDate).month);
    return monthDifference >= 0 && monthDifference % rule.interval === 0 && matchesSelector(parts, rule);
  }
  const yearDifference = parts.year - parseCalendarDate(rule.startDate).year;
  return yearDifference >= 0
    && yearDifference % rule.interval === 0
    && parts.month === rule.byMonth
    && matchesSelector(parts, rule);
}

/**
 * Expands one bounded calendar window into deterministic civil-date occurrences.
 * The result is preview/planning data only: this function performs no persistence,
 * does not resolve UTC instants and never treats runtime Intl data as authoritative.
 * rangeStart and rangeEnd are inclusive.
 */
export function expandRecurrenceDates({
  rule: inputRule,
  seriesId,
  rangeStart,
  rangeEnd,
  afterDate = null,
  maxOccurrences = MATERIALIZATION_BATCH_LIMIT,
  maxScannedDays = MAX_SCAN_DAYS,
}) {
  const rule = validateRecurrenceRule(inputRule);
  assert(typeof seriesId === 'string' && seriesId.trim().length > 0 && seriesId.length <= 128, 'seriesId must be a non-empty string up to 128 characters.');
  const firstDate = parseCalendarDate(rangeStart).key;
  const lastDate = parseCalendarDate(rangeEnd).key;
  assert(lastDate >= firstDate, 'rangeEnd must be on or after rangeStart.');
  const cursorDate = afterDate == null ? null : parseCalendarDate(afterDate).key;
  assert(Number.isInteger(maxOccurrences) && maxOccurrences >= 1 && maxOccurrences <= 5000, 'maxOccurrences must be from 1 to 5000.');
  assert(Number.isInteger(maxScannedDays) && maxScannedDays >= 1 && maxScannedDays <= MAX_SCAN_DAYS, `maxScannedDays must be from 1 to ${MAX_SCAN_DAYS}.`);

  const startEpochDay = dateEpochDay(rule.startDate);
  const endEpochDay = dateEpochDay(lastDate);
  const scanDays = endEpochDay - startEpochDay + 1;
  assert(scanDays <= maxScannedDays, 'Recurrence scan exceeds the safe expansion bound; split the requested range or materialize from a checkpoint.');
  const effectiveEndDate = rule.until && rule.until < lastDate ? rule.until : lastDate;
  const effectiveEndEpochDay = dateEpochDay(effectiveEndDate);
  const firstEpochDay = dateEpochDay(firstDate);
  if (effectiveEndEpochDay < firstEpochDay) return Object.freeze([]);

  const excluded = new Set(rule.excludedDates);
  const results = [];
  let sequence = 0;
  for (let epochDay = startEpochDay; epochDay <= effectiveEndEpochDay; epochDay += 1) {
    const date = dateFromEpochDay(epochDay);
    if (!matchesRuleDate(date, rule, startEpochDay, epochDay)) continue;
    sequence += 1;
    if (rule.count != null && sequence > rule.count) break;
    if (epochDay < firstEpochDay || (cursorDate && date <= cursorDate) || excluded.has(date)) continue;

    const timeKey = rule.temporalKind === 'all_day' ? 'ALL_DAY' : rule.localTime;
    const occurrenceKey = `v1:${encodeURIComponent(seriesId)}:${date}:${timeKey}`;
    results.push(Object.freeze({
      occurrenceKey,
      sequence,
      originalLocalDate: date,
      actualLocalDate: date,
      temporalKind: rule.temporalKind,
      ...(rule.temporalKind === 'zoned_civil' ? {
        localTime: rule.localTime,
        actualLocalTime: rule.localTime,
        timeZone: rule.timeZone,
        durationMinutes: rule.durationMinutes,
        disambiguation: rule.disambiguation,
        gapStrategy: 'next-valid',
      } : {}),
      status: 'scheduled',
    }));
    if (results.length > maxOccurrences) {
      throw new RangeError(`Recurrence expansion exceeds maxOccurrences (${maxOccurrences}). Use bounded batches.`);
    }
  }
  return Object.freeze(results);
}

/**
 * Applies a single occurrence override without changing its original civil identity.
 * A moved occurrence retains its original occurrenceKey.
 */
export function applyOccurrenceOverride(occurrence, override) {
  assert(occurrence && typeof occurrence === 'object', 'An occurrence descriptor is required.');
  assert(override && typeof override === 'object' && !Array.isArray(override), 'An occurrence override is required.');
  assert(override.occurrenceKey === occurrence.occurrenceKey, 'Override occurrenceKey does not match the original occurrence.');
  assert(['cancelled', 'moved', 'modified'].includes(override.kind), 'Override kind must be cancelled, moved or modified.');
  const allowed = new Set(['occurrenceKey', 'kind', 'actualLocalDate', 'actualLocalTime', 'durationMinutes']);
  assert(Object.keys(override).every((key) => allowed.has(key)), 'Occurrence override contains unsupported fields.');
  if (override.kind === 'cancelled') {
    assert(override.actualLocalDate == null && override.actualLocalTime == null && override.durationMinutes == null, 'A cancelled occurrence cannot carry time or duration overrides.');
    return Object.freeze({ ...occurrence, status: 'cancelled', overrideKind: 'cancelled' });
  }

  const actualLocalDate = override.actualLocalDate == null
    ? occurrence.actualLocalDate
    : parseCalendarDate(override.actualLocalDate).key;
  const actualLocalTime = override.actualLocalTime == null
    ? occurrence.actualLocalTime
    : normalizeLocalTime(override.actualLocalTime);
  const durationMinutes = override.durationMinutes == null
    ? occurrence.durationMinutes
    : override.durationMinutes;
  assert(occurrence.temporalKind === 'zoned_civil' || (override.actualLocalTime == null && override.durationMinutes == null), 'All-day occurrences cannot override clock time or duration.');
  if (occurrence.temporalKind === 'zoned_civil') {
    assert(Number.isInteger(durationMinutes) && durationMinutes >= 1 && durationMinutes <= 43_200, 'Occurrence duration must be an integer from 1 to 43200.');
  }
  if (override.kind === 'moved') {
    assert(actualLocalDate !== occurrence.actualLocalDate || actualLocalTime !== occurrence.actualLocalTime, 'A moved override must change the local date or time.');
  }
  if (override.kind === 'modified') {
    assert(actualLocalDate === occurrence.actualLocalDate && actualLocalTime === occurrence.actualLocalTime, 'A modified override cannot change the local date or time; use moved.');
    assert(durationMinutes !== occurrence.durationMinutes, 'A modified override must change the duration.');
  }

  return Object.freeze({
    ...occurrence,
    actualLocalDate,
    ...(occurrence.temporalKind === 'zoned_civil' ? { actualLocalTime, durationMinutes } : {}),
    status: 'scheduled',
    overrideKind: override.kind,
  });
}

/**
 * Plans one idempotent-sized materialization batch within the approved 90-day horizon.
 * Storage, locking, conflict handling and authenticated trigger wiring are separate services.
 */
export function planRecurrenceMaterializationBatch({
  rule,
  seriesId,
  anchorDate,
  afterDate = null,
  batchSize = MATERIALIZATION_BATCH_LIMIT,
}) {
  assert(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= MATERIALIZATION_BATCH_LIMIT, `batchSize must be from 1 to ${MATERIALIZATION_BATCH_LIMIT}.`);
  const startDate = parseCalendarDate(anchorDate).key;
  const endDate = addCalendarDays(startDate, MATERIALIZATION_HORIZON_DAYS - 1);
  const expanded = expandRecurrenceDates({
    rule,
    seriesId,
    rangeStart: startDate,
    rangeEnd: endDate,
    afterDate,
    maxOccurrences: batchSize + 1,
  });
  const hasMore = expanded.length > batchSize;
  const occurrences = Object.freeze(expanded.slice(0, batchSize));
  return Object.freeze({
    windowStart: startDate,
    windowEndInclusive: endDate,
    horizonDays: MATERIALIZATION_HORIZON_DAYS,
    batchSize,
    occurrences,
    hasMore,
    nextCursor: hasMore ? occurrences.at(-1).originalLocalDate : null,
  });
}

export function addRecurrenceCalendarDays(value, amount) {
  assert(Number.isInteger(amount), 'Calendar day adjustment must be an integer.');
  return addCalendarDays(parseCalendarDate(value).key, amount);
}
