const ISO_WEEKDAYS = Object.freeze(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function parseDateKey(value, label) {
  assert(typeof value === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(value),
    label + ' must use YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  assert(date.toISOString().slice(0, 10) === value, label + ' is not a valid calendar date.');
  return Math.floor(date.getTime() / 86_400_000);
}

function normalizeClock(value, label) {
  assert(typeof value === 'string', label + ' must be a local clock time.');
  const match = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\\.([0-9]{1,3}))?)?$/.exec(value);
  assert(match, label + ' must use HH:mm[:ss[.SSS]].');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  assert(hour <= 23 && minute <= 59 && second <= 59, label + ' is outside the local clock range.');
  const milliseconds = (match[4] ?? '').padEnd(3, '0') || '000';
  return match[1] + ':' + match[2] + ':' + String(second).padStart(2, '0') + '.' + milliseconds;
}

function weekdayForDate(value) {
  const epochDay = parseDateKey(value, 'startDate');
  const weekday = new Date(epochDay * 86_400_000).getUTCDay();
  return ISO_WEEKDAYS[weekday === 0 ? 6 : weekday - 1];
}

/**
 * Builds the approved recurrence v1 create request from a normalized Event.
 * The explicit end clock and calendar-day offset remain separate from duration:
 * durationMinutes is metadata describing the requested civil span and is never
 * used to synthesize the end wall time during DST resolution.
 */
export function buildRecurringEventCreatePayload({
  eventDraft,
  frequency,
  interval = 1,
  count = 12,
  weekdays = [],
}) {
  assert(eventDraft && typeof eventDraft === 'object' && eventDraft.temporal,
    'A normalized Event draft is required.');
  assert(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency),
    'A supported recurrence frequency is required.');
  assert(Number.isInteger(interval) && interval >= 1 && interval <= 1000,
    'Recurrence interval must be an integer from 1 to 1000.');
  assert(Number.isSafeInteger(count) && count >= 1,
    'Recurrence count must be a positive safe integer.');

  const temporal = eventDraft.temporal;
  const rule = {
    version: 1,
    frequency,
    interval,
    startDate: temporal.kind === 'all_day'
      ? temporal.startDate
      : temporal.kind === 'zoned_civil'
        ? temporal.startLocalDateTime.slice(0, 10)
        : null,
    temporalKind: temporal.kind,
    count,
  };
  assert(rule.startDate, 'Recurring Events do not support fixed instants.');

  if (frequency === 'WEEKLY') {
    const selected = Array.isArray(weekdays) && weekdays.length > 0
      ? [...weekdays]
      : [weekdayForDate(rule.startDate)];
    assert(selected.every((day) => ISO_WEEKDAYS.includes(day)),
      'Weekly recurrence weekdays must be ISO weekday codes.');
    assert(new Set(selected).size === selected.length,
      'Weekly recurrence weekdays cannot contain duplicates.');
    selected.sort((left, right) => ISO_WEEKDAYS.indexOf(left) - ISO_WEEKDAYS.indexOf(right));
    rule.byWeekday = selected;
  }

  if (frequency === 'MONTHLY' || frequency === 'YEARLY') {
    const day = Number(rule.startDate.slice(8, 10));
    rule.byMonthDay = day;
  }
  if (frequency === 'YEARLY') {
    rule.byMonth = Number(rule.startDate.slice(5, 7));
  }

  if (temporal.kind === 'all_day') {
    assert(typeof temporal.endDateExclusive === 'string', 'All-day recurrence requires an exclusive end date.');
    const offset = parseDateKey(temporal.endDateExclusive, 'endDateExclusive')
      - parseDateKey(temporal.startDate, 'startDate') - 1;
    assert(offset >= 0 && offset <= 30, 'All-day recurrence duration must be from 1 to 31 calendar days.');
    return Object.freeze({
      recurrenceRule: Object.freeze(rule),
      endDayOffset: offset,
      endLocalTime: null,
    });
  }

  assert(temporal.kind === 'zoned_civil', 'Recurring Events support only all-day and zoned-civil times.');
  const localStart = temporal.startLocalDateTime;
  const localEnd = temporal.endLocalDateTime;
  assert(typeof localStart === 'string' && typeof localEnd === 'string',
    'Timed recurrence requires both local endpoints.');
  const startDate = localStart.slice(0, 10);
  const endDate = localEnd.slice(0, 10);
  const startTime = normalizeClock(localStart.slice(11), 'startLocalDateTime');
  const endLocalTime = normalizeClock(localEnd.slice(11), 'endLocalDateTime');
  assert(startDate === rule.startDate, 'The recurrence anchor must match the Event start date.');
  rule.localTime = startTime.slice(0, 8) + (startTime.slice(9) === '000' ? '' : '.' + startTime.slice(9));
  rule.timeZone = temporal.timeZone;
  rule.durationMinutes = Math.round((
    (parseDateKey(endDate, 'endLocalDateTime') - parseDateKey(startDate, 'startLocalDateTime')) * 1440
    + (Number(endLocalTime.slice(0, 2)) * 60 + Number(endLocalTime.slice(3, 5)))
    - (Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5)))
  ));
  assert(rule.durationMinutes > 0,
    'The requested local end must be after the requested local start.');
  rule.disambiguation = temporal.startDisambiguation || 'earlier';
  rule.gapStrategy = temporal.startGapStrategy || 'next-valid';
  const endDayOffset = parseDateKey(endDate, 'endLocalDateTime')
    - parseDateKey(startDate, 'startLocalDateTime');
  assert(endDayOffset >= 0 && endDayOffset <= 30,
    'Timed recurrence endDayOffset must be from 0 to 30 calendar days.');

  return Object.freeze({
    recurrenceRule: Object.freeze(rule),
    endDayOffset,
    endLocalTime,
  });
}
