import { formatInstantInTimeZone, parseCalendarDate } from './temporal.js';

const DAY_MS = 86_400_000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function epochDay(value) {
  const { year, month, day } = parseCalendarDate(value);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / DAY_MS);
}

function dateKeyFromEpochDay(value) {
  return new Date(value * DAY_MS).toISOString().slice(0, 10);
}

export function addCalendarDays(value, amount) {
  parseCalendarDate(value);
  assert(Number.isInteger(amount), 'Calendar day adjustment must be an integer.');
  return dateKeyFromEpochDay(epochDay(value) + amount);
}

export function startOfWeekMonday(value) {
  const day = new Date(epochDay(value) * DAY_MS).getUTCDay();
  return addCalendarDays(value, -((day + 6) % 7));
}

export function startOfMonth(value) {
  const { year, month } = parseCalendarDate(value);
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-01';
}

export function monthGridDays(value) {
  const first = startOfMonth(value);
  const firstGridDay = startOfWeekMonday(first);
  return Object.freeze(Array.from({ length: 42 }, (_, index) => addCalendarDays(firstGridDay, index)));
}

export function getCalendarWindow(view, value) {
  parseCalendarDate(value);
  if (view === 'day') return Object.freeze({ startDate: value, endDateExclusive: addCalendarDays(value, 1) });
  if (view === 'week') {
    const startDate = startOfWeekMonday(value);
    return Object.freeze({ startDate, endDateExclusive: addCalendarDays(startDate, 7) });
  }
  if (view === 'month') {
    const startDate = startOfMonth(value);
    const { year, month } = parseCalendarDate(startDate);
    const nextMonth = month === 12
      ? String(year + 1).padStart(4, '0') + '-01-01'
      : String(year).padStart(4, '0') + '-' + String(month + 1).padStart(2, '0') + '-01';
    return Object.freeze({ startDate, endDateExclusive: nextMonth });
  }
  throw new RangeError('Calendar view must be day, week or month.');
}

export function shiftCalendarPeriod(view, value, direction) {
  assert(direction === -1 || direction === 1, 'Calendar direction must be -1 or 1.');
  if (view === 'day') return addCalendarDays(value, direction);
  if (view === 'week') return addCalendarDays(value, direction * 7);
  if (view === 'month') {
    const { year, month } = parseCalendarDate(value);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1 + direction, 1);
    date.setUTCHours(0, 0, 0, 0);
    const targetYear = date.getUTCFullYear();
    const targetMonth = date.getUTCMonth() + 1;
    const day = parseCalendarDate(value).day;
    const maxDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return String(targetYear).padStart(4, '0') + '-'
      + String(targetMonth).padStart(2, '0') + '-'
      + String(Math.min(day, maxDay)).padStart(2, '0');
  }
  throw new RangeError('Calendar view must be day, week or month.');
}

function normalizeLocalDateTime(value, label) {
  assert(typeof value === 'string', label + ' is missing.');
  const normalized = value.replace(' ', 'T');
  assert(DATE_KEY_PATTERN.test(normalized.slice(0, 10)), label + ' has an invalid calendar date.');
  parseCalendarDate(normalized.slice(0, 10));
  const time = normalized.slice(11, 16);
  assert(/^\d{2}:\d{2}$/.test(time), label + ' has an invalid local time.');
  return Object.freeze({ date: normalized.slice(0, 10), time });
}

function endDateExclusive(endDateTime) {
  return endDateTime.time === '00:00'
    ? endDateTime.date
    : addCalendarDays(endDateTime.date, 1);
}

/**
 * Maps persisted one-off Event rows into the calendar's date-only overlap
 * model. All-day Events stay date-only. Zoned-civil Events retain their event
 * wall time and IANA zone. Fixed instants are rendered in the viewer's zone.
 */
export function getCalendarEventRange(event, viewerTimeZone) {
  assert(event && typeof event === 'object', 'An Event row is required.');
  if (event.temporal_kind === 'all_day') {
    const start = parseCalendarDate(event.start_date).key;
    const end = parseCalendarDate(event.end_date_exclusive).key;
    assert(end > start, 'All-day Event end must be exclusive and after start.');
    return Object.freeze({
      temporalKind: 'all_day',
      startDate: start,
      endDateExclusive: end,
      startTime: null,
      endTime: null,
      timeZone: null,
    });
  }

  let start;
  let end;
  let timeZone = viewerTimeZone;
  if (event.temporal_kind === 'zoned_civil') {
    start = normalizeLocalDateTime(event.start_local, 'Event start_local');
    end = normalizeLocalDateTime(event.end_local, 'Event end_local');
    timeZone = event.time_zone || viewerTimeZone;
  } else if (event.temporal_kind === 'fixed_instant') {
    assert(typeof viewerTimeZone === 'string' && viewerTimeZone.length > 0, 'Viewer timezone is required.');
    start = normalizeLocalDateTime(formatInstantInTimeZone(event.starts_at, viewerTimeZone), 'Event starts_at');
    end = normalizeLocalDateTime(formatInstantInTimeZone(event.ends_at, viewerTimeZone), 'Event ends_at');
  } else {
    throw new RangeError('Unsupported Event temporal kind: ' + String(event.temporal_kind));
  }

  const startsAt = Date.parse(event.starts_at);
  const endsAt = Date.parse(event.ends_at);
  assert(Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt > startsAt,
    'Timed Event must have a positive resolved UTC range.');
  const endExclusive = endDateExclusive(end);
  assert(endExclusive > start.date, 'Timed Event end must follow its start date.');

  return Object.freeze({
    temporalKind: 'timed',
    startDate: start.date,
    endDateExclusive: endExclusive,
    startTime: start.time,
    endTime: end.time,
    endDate: end.date,
    timeZone,
  });
}

export function eventOccursOnDate(event, date, viewerTimeZone) {
  parseCalendarDate(date);
  const range = getCalendarEventRange(event, viewerTimeZone);
  return range.startDate <= date && date < range.endDateExclusive;
}

export function sortEventsForCalendar(events, viewerTimeZone) {
  return [...events].sort((left, right) => {
    const a = getCalendarEventRange(left, viewerTimeZone);
    const b = getCalendarEventRange(right, viewerTimeZone);
    if (a.temporalKind !== b.temporalKind) return a.temporalKind === 'all_day' ? -1 : 1;
    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
    return String(a.startTime ?? '').localeCompare(String(b.startTime ?? ''));
  });
}

export function formatEventTime(event, viewerTimeZone) {
  const range = getCalendarEventRange(event, viewerTimeZone);
  if (range.temporalKind === 'all_day') return 'Todo el día';
  if (range.startDate === range.endDate) return range.startTime + ' – ' + range.endTime;
  return range.startTime + ' · hasta ' + range.endDate + ' ' + range.endTime;
}
