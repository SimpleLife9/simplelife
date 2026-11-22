import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCalendarDays,
  eventOccursOnDate,
  formatEventTime,
  getCalendarEventRange,
  getCalendarWindow,
  monthGridDays,
  shiftCalendarPeriod,
  sortEventsForCalendar,
  startOfWeekMonday,
} from '../src/features/agenda/domain/calendar-view.js';

test('calendar week starts Monday and shifts dates without local-machine timezone dependence', () => {
  assert.equal(startOfWeekMonday('2026-11-22'), '2026-11-16');
  assert.equal(startOfWeekMonday('2026-11-23'), '2026-11-23');
  assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addCalendarDays('2026-01-01', -1), '2025-12-31');
});

test('month view produces a stable six-week Monday-first grid', () => {
  const days = monthGridDays('2026-11-22');
  assert.equal(days.length, 42);
  assert.equal(days[0], '2026-10-26');
  assert.equal(days[41], '2026-12-06');
  assert.deepEqual(getCalendarWindow('month', '2026-11-22'), {
    startDate: '2026-11-01',
    endDateExclusive: '2026-12-01',
  });
});

test('day and week windows use exclusive end dates', () => {
  assert.deepEqual(getCalendarWindow('day', '2026-11-22'), {
    startDate: '2026-11-22',
    endDateExclusive: '2026-11-23',
  });
  assert.deepEqual(getCalendarWindow('week', '2026-11-22'), {
    startDate: '2026-11-16',
    endDateExclusive: '2026-11-23',
  });
});

test('month navigation clamps dates such as January 31 to February end', () => {
  assert.equal(shiftCalendarPeriod('month', '2027-01-31', 1), '2027-02-28');
  assert.equal(shiftCalendarPeriod('month', '2027-03-31', -1), '2027-02-28');
});

test('all-day Event date ranges remain date-only and use the exclusive end', () => {
  const event = {
    temporal_kind: 'all_day',
    start_date: '2026-12-24',
    end_date_exclusive: '2026-12-27',
  };
  assert.equal(eventOccursOnDate(event, '2026-12-24', 'America/Havana'), true);
  assert.equal(eventOccursOnDate(event, '2026-12-26', 'America/Havana'), true);
  assert.equal(eventOccursOnDate(event, '2026-12-27', 'America/Havana'), false);
  assert.deepEqual(getCalendarEventRange(event, 'America/Havana'), {
    temporalKind: 'all_day',
    startDate: '2026-12-24',
    endDateExclusive: '2026-12-27',
    startTime: null,
    endTime: null,
    timeZone: null,
  });
});

test('zoned-civil multi-day Event keeps its original wall time and event timezone', () => {
  const event = {
    temporal_kind: 'zoned_civil',
    start_local: '2026-12-24T22:30:00',
    end_local: '2026-12-25T01:15:00',
    time_zone: 'America/New_York',
    starts_at: '2026-12-25T03:30:00.000Z',
    ends_at: '2026-12-25T06:15:00.000Z',
  };
  assert.equal(eventOccursOnDate(event, '2026-12-24', 'America/Havana'), true);
  assert.equal(eventOccursOnDate(event, '2026-12-25', 'America/Havana'), true);
  assert.equal(formatEventTime(event, 'America/Havana'), '22:30 · hasta 2026-12-25 01:15');
});

test('fixed-instant Event is rendered in the viewer timezone, not as a date-only value', () => {
  const event = {
    temporal_kind: 'fixed_instant',
    starts_at: '2026-12-01T14:00:00.000Z',
    ends_at: '2026-12-01T15:00:00.000Z',
    time_zone: null,
  };
  const range = getCalendarEventRange(event, 'America/Havana');
  assert.equal(range.startDate, '2026-12-01');
  assert.equal(range.startTime, '09:00');
  assert.equal(range.endTime, '10:00');
  assert.equal(formatEventTime(event, 'America/Havana'), '09:00 – 10:00');
});

test('DST repeated wall times use resolved UTC order instead of naive wall-clock order', () => {
  const event = {
    temporal_kind: 'zoned_civil',
    start_local: '2026-11-01T01:45:00',
    end_local: '2026-11-01T01:15:00',
    time_zone: 'America/New_York',
    starts_at: '2026-11-01T05:45:00.000Z',
    ends_at: '2026-11-01T06:15:00.000Z',
  };
  assert.equal(eventOccursOnDate(event, '2026-11-01', 'America/Havana'), true);
  assert.equal(formatEventTime(event, 'America/Havana'), '01:45 – 01:15');
});

test('calendar sorting puts all-day events first, then orders timed events by date and local time', () => {
  const events = [
    { id: 'late', temporal_kind: 'zoned_civil', start_local: '2026-12-02T15:00:00', end_local: '2026-12-02T16:00:00', time_zone: 'America/Havana', starts_at: '2026-12-02T20:00:00Z', ends_at: '2026-12-02T21:00:00Z' },
    { id: 'all-day', temporal_kind: 'all_day', start_date: '2026-12-02', end_date_exclusive: '2026-12-03' },
    { id: 'early', temporal_kind: 'zoned_civil', start_local: '2026-12-02T09:00:00', end_local: '2026-12-02T10:00:00', time_zone: 'America/Havana', starts_at: '2026-12-02T14:00:00Z', ends_at: '2026-12-02T15:00:00Z' },
  ];
  assert.deepEqual(sortEventsForCalendar(events, 'America/Havana').map((event) => event.id), ['all-day', 'early', 'late']);
});
